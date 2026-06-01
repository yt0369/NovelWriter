import { create } from 'zustand'

export interface Relationship {
  id: string
  from_character_id: string
  to_character_id: string
  relation_type: string
  description?: string
  strength?: number
  created_at: number
  last_modified: number
}

export interface CharacterWithRelationships {
  id: string
  name: string
  role?: string
  relationships: Relationship[]
}

interface RelationshipStore {
  relationships: Relationship[]
  loading: boolean
  selectedRelationship: Relationship | null

  fetchRelationships: (projectId: string) => Promise<void>
  createRelationship: (projectId: string, data: Partial<Relationship>) => Promise<Relationship | null>
  updateRelationship: (projectId: string, relId: string, data: Partial<Relationship>) => Promise<boolean>
  deleteRelationship: (projectId: string, relId: string) => Promise<boolean>
  setSelectedRelationship: (rel: Relationship | null) => void
  getRelationshipsForCharacter: (characterId: string) => Relationship[]
  getCharacterMap: () => Map<string, CharacterWithRelationships>
  getRelationshipTypes: () => string[]
}

// 预设关系类型
export const PRESET_RELATION_TYPES = [
  '朋友', '恋人', '夫妻', '亲人', '师徒', '同事',
  '敌人', '对手', '盟友', '上下级', '保护者', '被保护者',
]

export const useRelationshipStore = create<RelationshipStore>((set, get) => ({
  relationships: [],
  loading: false,
  selectedRelationship: null,

  fetchRelationships: async (projectId) => {
    set({ loading: true })
    try {
      const res = await fetch(`/api/characters/${projectId}/relationships`)
      if (res.ok) set({ relationships: await res.json() })
    } catch { /* ignore */ }
    set({ loading: false })
  },

  createRelationship: async (projectId, data) => {
    try {
      const res = await fetch(`/api/characters/${projectId}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const rel = await res.json()
        set(state => ({ relationships: [...state.relationships, rel] }))
        return rel
      }
    } catch { /* ignore */ }
    return null
  },

  updateRelationship: async (projectId, relId, data) => {
    try {
      const res = await fetch(`/api/characters/${projectId}/relationships/${relId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const updated = await res.json()
        set(state => ({
          relationships: state.relationships.map(r => r.id === relId ? { ...r, ...updated } : r),
        }))
        return true
      }
    } catch { /* ignore */ }
    return false
  },

  deleteRelationship: async (projectId, relId) => {
    try {
      const res = await fetch(`/api/characters/${projectId}/relationships/${relId}`, { method: 'DELETE' })
      if (res.ok) {
        set(state => ({
          relationships: state.relationships.filter(r => r.id !== relId),
          selectedRelationship: state.selectedRelationship?.id === relId ? null : state.selectedRelationship,
        }))
        return true
      }
    } catch { /* ignore */ }
    return false
  },

  setSelectedRelationship: (rel) => set({ selectedRelationship: rel }),

  getRelationshipsForCharacter: (characterId) => {
    return get().relationships.filter(
      r => r.from_character_id === characterId || r.to_character_id === characterId
    )
  },

  getCharacterMap: () => {
    const { relationships } = get()
    const map = new Map<string, CharacterWithRelationships>()

    for (const rel of relationships) {
      if (!map.has(rel.from_character_id)) {
        map.set(rel.from_character_id, {
          id: rel.from_character_id,
          name: rel.from_character_id,
          relationships: [],
        })
      }
      if (!map.has(rel.to_character_id)) {
        map.set(rel.to_character_id, {
          id: rel.to_character_id,
          name: rel.to_character_id,
          relationships: [],
        })
      }
      map.get(rel.from_character_id)!.relationships.push(rel)
      map.get(rel.to_character_id)!.relationships.push(rel)
    }

    return map
  },

  getRelationshipTypes: () => {
    const types = new Set<string>()
    for (const rel of get().relationships) {
      if (rel.relation_type) types.add(rel.relation_type)
    }
    return [...types, ...PRESET_RELATION_TYPES.filter(t => !types.has(t))]
  },
}))
