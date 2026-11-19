import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
  detail?: string
  action?: { label: string; run(): void }
}

interface ToastState {
  toasts: Toast[]
  push(t: Omit<Toast, 'id'>, ttlMs?: number): number
  dismiss(id: number): void
}

let seq = 0

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t, ttlMs = t.kind === 'error' ? 9000 : 5000) => {
    const id = ++seq
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
    setTimeout(() => get().dismiss(id), ttlMs)
    return id
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

export const toast = (t: Omit<Toast, 'id'>, ttlMs?: number) => useToasts.getState().push(t, ttlMs)
