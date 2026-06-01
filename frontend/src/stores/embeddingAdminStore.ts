import { create } from 'zustand'

export interface EmbeddingStatus {
  total: number
  with_embedding: number
  missing_count: number
  missing_nodes?: { id: string; name: string }[]
  health: 'healthy' | 'degraded'
}

export interface RecallTestResult {
  query: string
  results: { id: string; name: string; score: number; wing: string }[]
  latency_ms: number
}

interface EmbeddingAdminStore {
  status: EmbeddingStatus | null
  testResults: RecallTestResult[]
  loading: boolean
  repairing: boolean

  fetchStatus: (projectId: string) => Promise<void>
  testRecall: (projectId: string, query: string) => Promise<void>
  repairEmbeddings: (projectId: string) => Promise<{ repaired: number; total: number } | null>
  clearTestResults: () => void
}

export const useEmbeddingAdminStore = create<EmbeddingAdminStore>((set, get) => ({
  status: null,
  testResults: [],
  loading: false,
  repairing: false,

  fetchStatus: async (projectId) => {
    set({ loading: true })
    try {
      const res = await fetch(`/api/memory/${projectId}/embedding-status`)
      if (res.ok) set({ status: await res.json() })
    } catch { /* ignore */ }
    set({ loading: false })
  },

  testRecall: async (projectId, query) => {
    try {
      const res = await fetch(`/api/memory/${projectId}/test-recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (res.ok) {
        const result = await res.json()
        set((s) => ({ testResults: [result, ...s.testResults].slice(0, 10) }))
      }
    } catch { /* ignore */ }
  },

  repairEmbeddings: async (projectId) => {
    set({ repairing: true })
    try {
      const res = await fetch(`/api/memory/${projectId}/embedding-repair`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        await get().fetchStatus(projectId)
        set({ repairing: false })
        return { repaired: data.repaired, total: data.total_missing }
      }
    } catch { /* ignore */ }
    set({ repairing: false })
    return null
  },

  clearTestResults: () => set({ testResults: [] }),
}))
