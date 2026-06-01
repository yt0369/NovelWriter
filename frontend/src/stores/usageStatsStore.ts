import { create } from 'zustand'

export interface UsageStat {
  date: string
  model: string
  task_type: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

interface UsageStatsStore {
  stats: UsageStat[]
  loading: boolean
  days: number

  fetchStats: (days?: number) => Promise<void>
  setDays: (days: number) => void
  getTotalTokens: () => number
  getStatsByModel: () => Record<string, number>
  getStatsByType: () => Record<string, number>
  getStatsByDay: () => Record<string, number>
}

export const useUsageStatsStore = create<UsageStatsStore>((set, get) => ({
  stats: [],
  loading: false,
  days: 30,

  fetchStats: async (days) => {
    const d = days || get().days
    set({ loading: true, days: d })
    try {
      const res = await fetch(`/api/settings/usage-stats?days=${d}`)
      if (res.ok) {
        const data = await res.json()
        set({ stats: data.stats || [] })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  setDays: (days) => set({ days }),

  getTotalTokens: () => {
    return get().stats.reduce((sum, s) => sum + s.total_tokens, 0)
  },

  getStatsByModel: () => {
    const result: Record<string, number> = {}
    for (const s of get().stats) {
      result[s.model] = (result[s.model] || 0) + s.total_tokens
    }
    return result
  },

  getStatsByType: () => {
    const result: Record<string, number> = {}
    for (const s of get().stats) {
      result[s.task_type] = (result[s.task_type] || 0) + s.total_tokens
    }
    return result
  },

  getStatsByDay: () => {
    const result: Record<string, number> = {}
    for (const s of get().stats) {
      result[s.date] = (result[s.date] || 0) + s.total_tokens
    }
    return result
  },
}))
