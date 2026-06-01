import { create } from 'zustand'

// ============================================
// 类型定义
// ============================================

export type CategoryType = 'overwrite' | 'accumulate'

export interface SubCategoryEntry {
  id: string
  title: string
  content: string
  importance: 'low' | 'medium' | 'high' | 'critical'
  createdAt: number
  updatedAt?: number
  archivedAt?: number
}

export interface ProfileCategory {
  type: CategoryType
  subCategories: Record<string, SubCategoryEntry[]>
}

export interface CharacterProfileV2 {
  characterId: string
  characterName: string
  baseProfilePath?: string
  categories: Record<string, ProfileCategory>
  createdAt: number
  updatedAt: number
}

// 分类定义
export const CHARACTER_CATEGORIES: Record<string, CategoryType> = {
  '状态': 'overwrite',
  '属性': 'overwrite',
  '目标': 'overwrite',
  '技能': 'accumulate',
  '关系': 'accumulate',
  '经历': 'accumulate',
  '记忆': 'accumulate',
}

export const CATEGORY_ICONS: Record<string, string> = {
  '状态': '⚡',
  '属性': '💪',
  '目标': '🎯',
  '技能': '✨',
  '关系': '🤝',
  '经历': '📖',
  '记忆': '🧠',
}

export const CATEGORY_COLORS: Record<string, string> = {
  '状态': '#38bdf8',
  '属性': '#a78bfa',
  '目标': '#f59e0b',
  '技能': '#34d399',
  '关系': '#f472b6',
  '经历': '#60a5fa',
  '记忆': '#c084fc',
}

// ============================================
// Store 接口
// ============================================

interface CharacterProfileStore {
  profiles: CharacterProfileV2[]
  selectedProfile: CharacterProfileV2 | null
  loading: boolean

  // 数据加载
  loadProfiles: (projectId: string) => Promise<void>
  selectProfile: (characterId: string) => void

  // 档案操作
  initializeProfile: (characterName: string) => Promise<CharacterProfileV2 | null>
  deleteProfile: (characterId: string) => Promise<boolean>

  // 分类操作
  addSubCategory: (characterId: string, categoryName: string, subCategoryName: string) => void
  removeSubCategory: (characterId: string, categoryName: string, subCategoryName: string) => void

  // 条目操作
  addEntry: (characterId: string, categoryName: string, entry: Omit<SubCategoryEntry, 'id' | 'createdAt'>) => void
  updateEntry: (characterId: string, categoryName: string, entryId: string, updates: Partial<SubCategoryEntry>) => void
  deleteEntry: (characterId: string, categoryName: string, entryId: string) => void
  archiveEntry: (characterId: string, categoryName: string, entryId: string) => void
  unarchiveEntry: (characterId: string, categoryName: string, entryId: string) => void

  // 查询方法
  getActiveEntries: (characterId: string, categoryName: string) => SubCategoryEntry[]
  getArchivedEntries: (characterId: string, categoryName: string) => SubCategoryEntry[]
  getSubCategories: (characterId: string, categoryName: string) => string[]

  // 同步到后端
  syncToBackend: (projectId: string) => Promise<void>
}

// ============================================
// Store 实现
// ============================================

export const useCharacterProfileStore = create<CharacterProfileStore>((set, get) => ({
  profiles: [],
  selectedProfile: null,
  loading: false,

  loadProfiles: async (projectId) => {
    set({ loading: true })
    try {
      const res = await fetch(`/api/characters/${projectId}`)
      if (res.ok) {
        const characters = await res.json()
        const profiles: CharacterProfileV2[] = characters.map((c: any) => {
          const profileData = c.profile_data ? JSON.parse(c.profile_data) : {}
          return {
            characterId: c.id,
            characterName: c.name,
            baseProfilePath: c.file_path,
            categories: migrateProfileData(profileData),
            createdAt: c.created_at,
            updatedAt: c.last_modified,
          }
        })
        set({ profiles })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  selectProfile: (characterId) => {
    const profile = get().profiles.find(p => p.characterId === characterId)
    set({ selectedProfile: profile || null })
  },

  initializeProfile: async (characterName) => {
    try {
      const res = await fetch(`/api/characters/${get().profiles[0]?.characterId?.split('-')[0] || ''}/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: characterName }),
      })
      if (res.ok) {
        const data = await res.json()
        const newProfile: CharacterProfileV2 = {
          characterId: data.id,
          characterName: characterName,
          categories: createEmptyCategories(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((s) => ({ profiles: [...s.profiles, newProfile] }))
        return newProfile
      }
    } catch { /* ignore */ }
    return null
  },

  deleteProfile: async (characterId) => {
    try {
      const projectId = characterId.split('-')[0]
      await fetch(`/api/characters/${projectId}/${characterId}`, { method: 'DELETE' })
      set((s) => ({
        profiles: s.profiles.filter(p => p.characterId !== characterId),
        selectedProfile: s.selectedProfile?.characterId === characterId ? null : s.selectedProfile,
      }))
      return true
    } catch { /* ignore */ }
    return false
  },

  addSubCategory: (characterId, categoryName, subCategoryName) => {
    set((s) => ({
      profiles: s.profiles.map(p => {
        if (p.characterId !== characterId) return p
        const categories = { ...p.categories }
        if (!categories[categoryName]) {
          categories[categoryName] = { type: CHARACTER_CATEGORIES[categoryName] || 'overwrite', subCategories: {} }
        }
        categories[categoryName] = {
          ...categories[categoryName],
          subCategories: {
            ...categories[categoryName].subCategories,
            [subCategoryName]: [],
          },
        }
        return { ...p, categories, updatedAt: Date.now() }
      }),
    }))
  },

  removeSubCategory: (characterId, categoryName, subCategoryName) => {
    set((s) => ({
      profiles: s.profiles.map(p => {
        if (p.characterId !== characterId) return p
        const categories = { ...p.categories }
        if (categories[categoryName]) {
          const subCategories = { ...categories[categoryName].subCategories }
          delete subCategories[subCategoryName]
          categories[categoryName] = { ...categories[categoryName], subCategories }
        }
        return { ...p, categories, updatedAt: Date.now() }
      }),
    }))
  },

  addEntry: (characterId, categoryName, entry) => {
    const newEntry: SubCategoryEntry = {
      ...entry,
      id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      createdAt: Date.now(),
    }
    set((s) => ({
      profiles: s.profiles.map(p => {
        if (p.characterId !== characterId) return p
        const categories = { ...p.categories }
        if (!categories[categoryName]) {
          categories[categoryName] = { type: CHARACTER_CATEGORIES[categoryName] || 'overwrite', subCategories: { default: [] } }
        }
        const subCategories = { ...categories[categoryName].subCategories }
        const defaultKey = Object.keys(subCategories)[0] || 'default'
        subCategories[defaultKey] = [...(subCategories[defaultKey] || []), newEntry]
        categories[categoryName] = { ...categories[categoryName], subCategories }
        return { ...p, categories, updatedAt: Date.now() }
      }),
    }))
  },

  updateEntry: (characterId, categoryName, entryId, updates) => {
    set((s) => ({
      profiles: s.profiles.map(p => {
        if (p.characterId !== characterId) return p
        const categories = { ...p.categories }
        if (categories[categoryName]) {
          const subCategories = { ...categories[categoryName].subCategories }
          for (const [key, entries] of Object.entries(subCategories)) {
            subCategories[key] = entries.map(e => e.id === entryId ? { ...e, ...updates, updatedAt: Date.now() } : e)
          }
          categories[categoryName] = { ...categories[categoryName], subCategories }
        }
        return { ...p, categories, updatedAt: Date.now() }
      }),
    }))
  },

  deleteEntry: (characterId, categoryName, entryId) => {
    set((s) => ({
      profiles: s.profiles.map(p => {
        if (p.characterId !== characterId) return p
        const categories = { ...p.categories }
        if (categories[categoryName]) {
          const subCategories = { ...categories[categoryName].subCategories }
          for (const [key, entries] of Object.entries(subCategories)) {
            subCategories[key] = entries.filter(e => e.id !== entryId)
          }
          categories[categoryName] = { ...categories[categoryName], subCategories }
        }
        return { ...p, categories, updatedAt: Date.now() }
      }),
    }))
  },

  archiveEntry: (characterId, categoryName, entryId) => {
    set((s) => ({
      profiles: s.profiles.map(p => {
        if (p.characterId !== characterId) return p
        const categories = { ...p.categories }
        if (categories[categoryName]) {
          const subCategories = { ...categories[categoryName].subCategories }
          for (const [key, entries] of Object.entries(subCategories)) {
            subCategories[key] = entries.map(e =>
              e.id === entryId ? { ...e, archivedAt: Date.now() } : e
            )
          }
          categories[categoryName] = { ...categories[categoryName], subCategories }
        }
        return { ...p, categories, updatedAt: Date.now() }
      }),
    }))
  },

  unarchiveEntry: (characterId, categoryName, entryId) => {
    set((s) => ({
      profiles: s.profiles.map(p => {
        if (p.characterId !== characterId) return p
        const categories = { ...p.categories }
        if (categories[categoryName]) {
          const subCategories = { ...categories[categoryName].subCategories }
          for (const [key, entries] of Object.entries(subCategories)) {
            subCategories[key] = entries.map(e =>
              e.id === entryId ? { ...e, archivedAt: undefined } : e
            )
          }
          categories[categoryName] = { ...categories[categoryName], subCategories }
        }
        return { ...p, categories, updatedAt: Date.now() }
      }),
    }))
  },

  getActiveEntries: (characterId, categoryName) => {
    const profile = get().profiles.find(p => p.characterId === characterId)
    if (!profile?.categories[categoryName]) return []
    const subCategories = profile.categories[categoryName].subCategories
    return Object.values(subCategories).flat().filter(e => !e.archivedAt)
  },

  getArchivedEntries: (characterId, categoryName) => {
    const profile = get().profiles.find(p => p.characterId === characterId)
    if (!profile?.categories[categoryName]) return []
    const subCategories = profile.categories[categoryName].subCategories
    return Object.values(subCategories).flat().filter(e => e.archivedAt)
  },

  getSubCategories: (characterId, categoryName) => {
    const profile = get().profiles.find(p => p.characterId === characterId)
    if (!profile?.categories[categoryName]) return []
    return Object.keys(profile.categories[categoryName].subCategories)
  },

  syncToBackend: async (projectId) => {
    const { selectedProfile } = get()
    if (!selectedProfile) return
    try {
      await fetch(`/api/characters/${projectId}/${selectedProfile.characterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_data: JSON.stringify(selectedProfile.categories),
        }),
      })
    } catch { /* ignore */ }
  },
}))

// ============================================
// 辅助函数
// ============================================

function createEmptyCategories(): Record<string, ProfileCategory> {
  const categories: Record<string, ProfileCategory> = {}
  for (const [name, type] of Object.entries(CHARACTER_CATEGORIES)) {
    categories[name] = { type, subCategories: { default: [] } }
  }
  return categories
}

function migrateProfileData(profileData: any): Record<string, ProfileCategory> {
  // 如果已经是新格式，直接返回
  if (profileData && typeof profileData === 'object' && !Array.isArray(profileData)) {
    const firstKey = Object.keys(profileData)[0]
    if (firstKey && profileData[firstKey]?.type) {
      return profileData
    }
  }

  // 否则创建空分类并尝试迁移旧数据
  const categories = createEmptyCategories()

  // 迁移旧格式数据
  if (profileData && typeof profileData === 'object') {
    for (const [key, value] of Object.entries(profileData)) {
      if (CHARACTER_CATEGORIES[key]) {
        // 已有分类数据
        if (typeof value === 'object' && value !== null) {
          categories[key] = {
            type: CHARACTER_CATEGORIES[key],
            subCategories: { default: Array.isArray(value) ? value : [value] },
          }
        }
      }
    }
  }

  return categories
}
