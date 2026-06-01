import { create } from 'zustand'

export interface DiffSession {
  id: string
  fileId: string
  fileName: string
  oldContent: string
  newContent: string
  description?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
}

interface DiffStore {
  sessions: DiffSession[]
  activeSessionId: string | null

  createSession: (fileId: string, fileName: string, oldContent: string, newContent: string, description?: string) => string
  approveSession: (id: string) => void
  rejectSession: (id: string) => void
  clearSession: (id: string) => void
  clearAll: () => void
  setActiveSession: (id: string | null) => void
  getActiveSession: () => DiffSession | undefined
  getPendingSessions: () => DiffSession[]
}

export const useDiffStore = create<DiffStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  createSession: (fileId, fileName, oldContent, newContent, description) => {
    const id = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const session: DiffSession = {
      id, fileId, fileName, oldContent, newContent, description,
      status: 'pending', createdAt: Date.now(),
    }
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: id,
    }))
    return id
  },

  approveSession: (id) => {
    set((s) => ({
      sessions: s.sessions.map(sess =>
        sess.id === id ? { ...sess, status: 'approved' as const } : sess
      ),
    }))
  },

  rejectSession: (id) => {
    set((s) => ({
      sessions: s.sessions.map(sess =>
        sess.id === id ? { ...sess, status: 'rejected' as const } : sess
      ),
    }))
  },

  clearSession: (id) => {
    set((s) => ({
      sessions: s.sessions.filter(sess => sess.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    }))
  },

  clearAll: () => set({ sessions: [], activeSessionId: null }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  getActiveSession: () => {
    const { sessions, activeSessionId } = get()
    return sessions.find(s => s.id === activeSessionId)
  },

  getPendingSessions: () => {
    return get().sessions.filter(s => s.status === 'pending')
  },
}))
