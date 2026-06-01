import { create } from 'zustand'

interface GlobalSoulStore {
  soul: string
  loading: boolean

  loadSoul: () => Promise<void>
  saveSoul: (content: string) => Promise<void>
  resetSoul: () => Promise<void>
}

export const useGlobalSoulStore = create<GlobalSoulStore>((set) => ({
  soul: '',
  loading: false,

  loadSoul: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/soul/')
      if (res.ok) {
        const data = await res.json()
        set({ soul: data.content || data.soul || data.global_soul || '' })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  saveSoul: async (content) => {
    try {
      await fetch('/api/soul/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'content', value: content }),
      })
      set({ soul: content })
    } catch { /* ignore */ }
  },

  resetSoul: async () => {
    try {
      await fetch('/api/soul/content', { method: 'DELETE' })
      const res = await fetch('/api/soul/')
      if (res.ok) {
        const data = await res.json()
        set({ soul: data.content || data.soul || data.global_soul || '' })
      }
    } catch { /* ignore */ }
  },
}))
