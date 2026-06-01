import { create } from 'zustand'

// ============================================
// 类型定义
// ============================================

export interface ForeshadowingItem {
  id: string
  content: string
  type: 'planted' | 'resolved' | 'dangling'
  source: 'chapter_analysis' | 'manual' | 'timeline'
  sourceRef?: string
  plantedChapter?: number
  plannedChapter?: number
  hookType?: 'crisis' | 'mystery' | 'emotion' | 'choice' | 'desire'
  hookStrength?: 'weak' | 'medium' | 'strong'
  rewardScore?: number
  tags?: string[]
  notes?: string
  createdAt: number
}

export interface ChapterCharacterState {
  id: string
  characterName: string
  chapterRef: string
  chapterIndex?: number
  stateDescription?: string
  emotionalState?: string
  location?: string
  goal?: string
  health?: string
  abilities?: string
  relationships?: string
  changes?: string[]
  evidence?: string
  confidence?: number
  createdAt: number
}

export interface ChapterPlotKeyPoint {
  id: string
  chapterRef: string
  chapterIndex?: number
  description: string
  importance: 'low' | 'medium' | 'high' | 'critical'
  tags?: string[]
  relatedCharacters?: string[]
  createdAt: number
}

export interface ChapterAnalysisData {
  characterStates: ChapterCharacterState[]
  foreshadowing: ForeshadowingItem[]
  plotKeyPoints: ChapterPlotKeyPoint[]
  lastModified: number
}

// ============================================
// Store 接口
// ============================================

interface ChapterAnalysisStore {
  data: ChapterAnalysisData
  isExtracting: boolean
  extractionError: string | null

  // 数据加载
  loadProjectAnalyses: (projectId: string) => Promise<void>

  // 伏笔操作
  addForeshadowing: (item: Omit<ForeshadowingItem, 'id' | 'createdAt'>) => string
  updateForeshadowing: (id: string, updates: Partial<ForeshadowingItem>) => void
  deleteForeshadowing: (id: string) => void

  // 角色状态操作
  addCharacterState: (state: Omit<ChapterCharacterState, 'id' | 'createdAt'>) => string
  updateCharacterState: (id: string, updates: Partial<ChapterCharacterState>) => void
  deleteCharacterState: (id: string) => void

  // 剧情关键点操作
  addPlotKeyPoint: (point: Omit<ChapterPlotKeyPoint, 'id' | 'createdAt'>) => string
  updatePlotKeyPoint: (id: string, updates: Partial<ChapterPlotKeyPoint>) => void
  deletePlotKeyPoint: (id: string) => void

  // 查询方法
  getForeshadowingByChapter: (chapterRef: string) => ForeshadowingItem[]
  getUnresolvedForeshadowing: () => ForeshadowingItem[]
  getCharacterStatesByCharacter: (characterName: string) => ChapterCharacterState[]
  getCharacterStatesByChapter: (chapterRef: string) => ChapterCharacterState[]
  getPlotKeyPointsByChapter: (chapterRef: string) => ChapterPlotKeyPoint[]

  // 统计
  getStats: () => {
    totalForeshadowing: number
    unresolvedForeshadowing: number
    totalCharacterStates: number
    totalPlotKeyPoints: number
  }

  // 触发分析
  triggerExtraction: (chapterPath: string, projectId: string) => Promise<void>

  // 清空
  clearAll: () => void
}

// ============================================
// 初始状态
// ============================================

const initialState: ChapterAnalysisData = {
  characterStates: [],
  foreshadowing: [],
  plotKeyPoints: [],
  lastModified: Date.now(),
}

// ============================================
// Store 实现
// ============================================

export const useChapterAnalysisStore = create<ChapterAnalysisStore>((set, get) => ({
  data: initialState,
  isExtracting: false,
  extractionError: null,

  loadProjectAnalyses: async (projectId) => {
    try {
      const res = await fetch(`/api/timeline/${projectId}/chapter-analysis`)
      if (res.ok) {
        const data = await res.json()
        set({ data: { ...data, lastModified: Date.now() } })
      }
    } catch (error) {
      console.error('加载章节分析失败:', error)
    }
  },

  // ========== 伏笔操作 ==========

  addForeshadowing: (item) => {
    const id = `foreshadow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newItem: ForeshadowingItem = { ...item, id, createdAt: Date.now() }
    set((s) => ({
      data: {
        ...s.data,
        foreshadowing: [...s.data.foreshadowing, newItem],
        lastModified: Date.now(),
      },
    }))
    return id
  },

  updateForeshadowing: (id, updates) => {
    set((s) => ({
      data: {
        ...s.data,
        foreshadowing: s.data.foreshadowing.map((f) =>
          f.id === id ? { ...f, ...updates } : f
        ),
        lastModified: Date.now(),
      },
    }))
  },

  deleteForeshadowing: (id) => {
    set((s) => ({
      data: {
        ...s.data,
        foreshadowing: s.data.foreshadowing.filter((f) => f.id !== id),
        lastModified: Date.now(),
      },
    }))
  },

  // ========== 角色状态操作 ==========

  addCharacterState: (state) => {
    const id = `state-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newState: ChapterCharacterState = { ...state, id, createdAt: Date.now() }
    set((s) => ({
      data: {
        ...s.data,
        characterStates: [...s.data.characterStates, newState],
        lastModified: Date.now(),
      },
    }))
    return id
  },

  updateCharacterState: (id, updates) => {
    set((s) => ({
      data: {
        ...s.data,
        characterStates: s.data.characterStates.map((cs) =>
          cs.id === id ? { ...cs, ...updates } : cs
        ),
        lastModified: Date.now(),
      },
    }))
  },

  deleteCharacterState: (id) => {
    set((s) => ({
      data: {
        ...s.data,
        characterStates: s.data.characterStates.filter((cs) => cs.id !== id),
        lastModified: Date.now(),
      },
    }))
  },

  // ========== 剧情关键点操作 ==========

  addPlotKeyPoint: (point) => {
    const id = `plot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newPoint: ChapterPlotKeyPoint = { ...point, id, createdAt: Date.now() }
    set((s) => ({
      data: {
        ...s.data,
        plotKeyPoints: [...s.data.plotKeyPoints, newPoint],
        lastModified: Date.now(),
      },
    }))
    return id
  },

  updatePlotKeyPoint: (id, updates) => {
    set((s) => ({
      data: {
        ...s.data,
        plotKeyPoints: s.data.plotKeyPoints.map((pk) =>
          pk.id === id ? { ...pk, ...updates } : pk
        ),
        lastModified: Date.now(),
      },
    }))
  },

  deletePlotKeyPoint: (id) => {
    set((s) => ({
      data: {
        ...s.data,
        plotKeyPoints: s.data.plotKeyPoints.filter((pk) => pk.id !== id),
        lastModified: Date.now(),
      },
    }))
  },

  // ========== 查询方法 ==========

  getForeshadowingByChapter: (chapterRef) => {
    return get().data.foreshadowing.filter((f) => f.sourceRef === chapterRef)
  },

  getUnresolvedForeshadowing: () => {
    return get().data.foreshadowing.filter((f) => f.type !== 'resolved')
  },

  getCharacterStatesByCharacter: (characterName) => {
    return get().data.characterStates.filter((cs) => cs.characterName === characterName)
  },

  getCharacterStatesByChapter: (chapterRef) => {
    return get().data.characterStates.filter((cs) => cs.chapterRef === chapterRef)
  },

  getPlotKeyPointsByChapter: (chapterRef) => {
    return get().data.plotKeyPoints.filter((pk) => pk.chapterRef === chapterRef)
  },

  // ========== 统计 ==========

  getStats: () => {
    const { data } = get()
    return {
      totalForeshadowing: data.foreshadowing.length,
      unresolvedForeshadowing: data.foreshadowing.filter((f) => f.type !== 'resolved').length,
      totalCharacterStates: data.characterStates.length,
      totalPlotKeyPoints: data.plotKeyPoints.length,
    }
  },

  // ========== 触发分析 ==========

  triggerExtraction: async (chapterPath, projectId) => {
    set({ isExtracting: true, extractionError: null })
    try {
      const res = await fetch(`/api/timeline/${projectId}/analyze-chapter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterPath }),
      })
      if (res.ok) {
        const result = await res.json()
        // 合并分析结果
        set((s) => ({
          data: {
            characterStates: [...s.data.characterStates, ...(result.characterStates || [])],
            foreshadowing: [...s.data.foreshadowing, ...(result.foreshadowing || [])],
            plotKeyPoints: [...s.data.plotKeyPoints, ...(result.plotKeyPoints || [])],
            lastModified: Date.now(),
          },
          isExtracting: false,
        }))
      } else {
        set({ extractionError: '分析失败', isExtracting: false })
      }
    } catch (error) {
      set({ extractionError: String(error), isExtracting: false })
    }
  },

  // ========== 清空 ==========

  clearAll: () => set({ data: initialState }),
}))
