import { app, BrowserWindow, ipcMain, nativeTheme, Notification, protocol, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'node:path'
import type { AdoRequest, DescriptionTemplate, NotificationTest, SaveSettingsInput, SystemNotification } from '@shared/ipc'
import { adoRequest, fetchAsset } from './ado'
import { clearPat, settingsState, writeConnection, writePat } from './settings'
import { listTemplates, removeTemplate, saveTemplate, seedTemplates } from './templates'
import { loadWatch, saveWatch } from './watch'

protocol.registerSchemesAsPrivileged([
  { scheme: 'ado-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null
// Notifications are kept referenced until dismissed; otherwise GC can drop them and their click handler.
const shown = new Set<Notification>()

function showNotification({ title, body, tag }: SystemNotification): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: String(title).slice(0, 200), body: String(body).slice(0, 500) })
  const release = () => shown.delete(n)
  n.on('click', () => {
    release()
    const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('notify:click', String(tag))
  })
  n.on('close', release)
  shown.add(n)
  n.show()
}

/** Resolves once macOS has accepted (or refused) the notification; waits for the permission dialog. */
function testNotification(): Promise<NotificationTest> {
  if (!Notification.isSupported()) return Promise.resolve({ status: 'unsupported' })
  return new Promise((resolve) => {
    const n = new Notification({ title: 'Notifications are on', body: 'You’ll be notified when someone changes an item you follow.' })
    const done = (r: NotificationTest) => {
      clearTimeout(timer)
      resolve(r)
    }
    // The permission dialog waits for the user; give up after a while rather than hang the UI.
    const timer = setTimeout(() => done({ status: 'timeout' }), 120_000)
    n.once('show', () => done({ status: 'shown' }))
    n.once('failed', (_e, error) => {
      shown.delete(n)
      done({ status: 'failed', error })
    })
    n.on('close', () => shown.delete(n))
    shown.add(n)
    n.show()
  })
}

function openNotificationSettings(): Promise<void> {
  if (process.platform === 'darwin') return shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')
  if (process.platform === 'win32') return shell.openExternal('ms-settings:notifications')
  return Promise.resolve()
}

/** Checks GitHub Releases now and every few hours; a downloaded update installs on quit. Packaged builds only. */
function startUpdateChecks(): void {
  if (!app.isPackaged) return
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch((e) => console.warn('Update check failed:', e))
  void check()
  setInterval(check, 6 * 60 * 60 * 1000)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'ADO Board',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f7f8fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.once('ready-to-show', () => win.show())

  // Links never navigate the app window; they open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  }

  protocol.handle('ado-asset', (request) => {
    const target = new URL(request.url).searchParams.get('u') ?? ''
    return fetchAsset(target)
  })

  ipcMain.handle('settings:get', () => settingsState())
  ipcMain.handle('settings:save', (_e, input: SaveSettingsInput) => {
    writeConnection(input.connection)
    if (input.pat) writePat(input.pat)
    return settingsState()
  })
  ipcMain.handle('settings:clearPat', () => {
    clearPat()
    return settingsState()
  })
  ipcMain.handle('ado:request', (_e, req: AdoRequest) => adoRequest(req))
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https:\/\//i.test(url)) return shell.openExternal(url)
  })

  const templatesDir = join(app.getPath('userData'), 'templates')
  seedTemplates(templatesDir)
  ipcMain.handle('templates:list', () => listTemplates(templatesDir))
  ipcMain.handle('templates:save', (_e, t: Omit<DescriptionTemplate, 'id'> & { id?: string }) => saveTemplate(templatesDir, t))
  ipcMain.handle('templates:remove', (_e, id: string) => removeTemplate(templatesDir, id))
  ipcMain.handle('templates:openFolder', () => shell.openPath(templatesDir).then(() => undefined))

  const dataDir = app.getPath('userData')
  ipcMain.handle('watch:load', (_e, scope: unknown) => loadWatch(dataDir, scope))
  ipcMain.handle('watch:save', (_e, scope: unknown, data: unknown) => saveWatch(dataDir, scope, data))
  ipcMain.handle('notify:show', (_e, n: SystemNotification) => showNotification(n))
  ipcMain.handle('notify:test', () => testNotification())
  ipcMain.handle('notify:settings', () => openNotificationSettings())
  ipcMain.handle('app:badge', (_e, count: number) => {
    app.setBadgeCount(Number.isInteger(count) && count > 0 ? count : 0)
  })

  createWindow()
  startUpdateChecks()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
