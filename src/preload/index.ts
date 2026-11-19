import { contextBridge, ipcRenderer } from 'electron'
import type { BridgeApi } from '@shared/ipc'

const api: BridgeApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  clearPat: () => ipcRenderer.invoke('settings:clearPat'),
  ado: (req) => ipcRenderer.invoke('ado:request', req),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (t) => ipcRenderer.invoke('templates:save', t),
    remove: (id) => ipcRenderer.invoke('templates:remove', id),
    openFolder: () => ipcRenderer.invoke('templates:openFolder')
  },
  watch: {
    load: (scope) => ipcRenderer.invoke('watch:load', scope),
    save: (scope, data) => ipcRenderer.invoke('watch:save', scope, data)
  },
  notify: (n) => ipcRenderer.invoke('notify:show', n),
  testNotification: () => ipcRenderer.invoke('notify:test'),
  openNotificationSettings: () => ipcRenderer.invoke('notify:settings'),
  onNotificationClick: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, tag: string) => cb(tag)
    ipcRenderer.on('notify:click', listener)
    return () => ipcRenderer.removeListener('notify:click', listener)
  },
  setBadge: (count) => ipcRenderer.invoke('app:badge', count),
  platform: process.platform
}

contextBridge.exposeInMainWorld('ado', api)
