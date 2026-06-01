import { create } from 'zustand'

export interface EntityVersion {
  id: number
  entity_type: string
  entity_id: string
  version: number
  snapshot: any
  change_summary: string
  created_at: number
}

interface EntityVersionStore {
  versions: EntityVersion[]
  selectedVersion: number | null
  fetchVersions: (entityType: string, entityId: string) => Promise<void>
  createSnapshot: (entityType: string, entityId: string, snapshot: any, summary: string) => Promise<void>
  restoreVersion: (entityType: string, entityId: string, version: number) => Promise<any>
  setSelectedVersion: (version: number | null) => void
}

export const useEntityVersionStore = create<EntityVersionStore>((set) => ({
  versions: [],
  selectedVersion: null,
  fetchVersions: async (entityType, entityId) => {
    try {
      const res = await fetch(`/api/entities/${entityType}/${entityId}/versions`)
      if (res.ok) set({ versions: await res.json() })
    } catch { /* ignore */ }
  },
  createSnapshot: async (entityType, entityId, snapshot, summary) => {
    try {
      await fetch(`/api/entities/${entityType}/${entityId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot, change_summary: summary }),
      })
    } catch { /* ignore */ }
  },
  restoreVersion: async (entityType, entityId, version) => {
    try {
      const res = await fetch(`/api/entities/${entityType}/${entityId}/versions/${version}/restore`, { method: 'POST' })
      if (res.ok) return (await res.json()).snapshot
    } catch { /* ignore */ }
    return null
  },
  setSelectedVersion: (version) => set({ selectedVersion: version }),
}))
