import { create } from 'zustand'

export interface AgentMemory {
  id: string
  type: 'insight' | 'pattern' | 'correction' | 'workflow' | 'preference'
  content: string
  context?: string
  importance: 'low' | 'medium' | 'high' | 'critical'
  related_skills?: string[]
  access_count: number
  created_at: number
  accessed_at: number
}

interface AgentMemoryStore {
  memories: AgentMemory[]
  loading: boolean
  filterType: string | null
  filterImportance: string | null
  searchQuery: string

  fetchMemories: (projectId: string, action?: 'list' | 'recall', query?: string) => Promise<void>
  recordMemory: (projectId: string, action: 'record_insight' | 'record_pattern' | 'record_correction', content: string, context?: string, importance?: string) => Promise<boolean>
  setFilterType: (type: string | null) => void
  setFilterImportance: (importance: string | null) => void
  setSearchQuery: (query: string) => void
  getFilteredMemories: () => AgentMemory[]
  getStats: () => Record<string, number>
}

export const useAgentMemoryStore = create<AgentMemoryStore>((set, get) => ({
  memories: [],
  loading: false,
  filterType: null,
  filterImportance: null,
  searchQuery: '',

  fetchMemories: async (projectId, action = 'list', query) => {
    set({ loading: true })
    try {
      const params = new URLSearchParams({ action })
      if (query) params.set('query', query)
      if (get().filterType) params.set('type', get().filterType!)
      if (get().filterImportance) params.set('importance', get().filterImportance!)

      const res = await fetch(`/api/memory/${projectId}/evolution?${params}`)
      if (res.ok) {
        const data = await res.json()
        set({ memories: data.results || [] })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  recordMemory: async (projectId, action, content, context, importance) => {
    try {
      const res = await fetch(`/api/memory/${projectId}/evolution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, content, context, importance }),
      })
      if (res.ok) {
        get().fetchMemories(projectId)
        return true
      }
    } catch { /* ignore */ }
    return false
  },

  setFilterType: (type) => set({ filterType: type }),
  setFilterImportance: (importance) => set({ filterImportance: importance }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  getFilteredMemories: () => {
    const { memories, filterType, filterImportance, searchQuery } = get()
    let result = memories
    if (filterType) result = result.filter(m => m.type === filterType)
    if (filterImportance) result = result.filter(m => m.importance === filterImportance)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(m =>
        m.content.toLowerCase().includes(q) ||
        m.context?.toLowerCase().includes(q)
      )
    }
    return result
  },

  getStats: () => {
    const { memories } = get()
    const stats: Record<string, number> = {}
    for (const m of memories) {
      stats[m.type] = (stats[m.type] || 0) + 1
    }
    return stats
  },
}))
