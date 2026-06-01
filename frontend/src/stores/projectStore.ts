import { create } from 'zustand'

interface Project {
  id: string
  name: string
  description: string | null
  genre: string | null
  words_per_chapter?: number
  target_chapters?: number | null
  chapters_per_volume?: number
  preset_id?: string | null
  created_at?: number
  last_modified?: number
}

interface ProjectStore {
  currentProject: Project | null
  projects: Project[]
  setProjects: (projects: Project[]) => void
  setCurrentProject: (project: Project | null) => void
  fetchProjects: () => Promise<void>
  initFromUrl: () => Promise<boolean>
  deleteProject: (id: string) => Promise<void>
  updateProject: (id: string, data: Partial<Project>) => Promise<Project | null>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  currentProject: null,
  projects: [],

  setProjects: (projects) => set({ projects }),

  setCurrentProject: (project) => {
    set({ currentProject: project })
  },

  fetchProjects: async () => {
    const res = await fetch('/api/projects/')
    const data = await res.json()
    set({ projects: data })
  },

  initFromUrl: async () => {
    const match = window.location.pathname.match(/^\/project\/([^/]+)$/)
    if (!match) return false
    const projectId = match[1]
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) return false
      const project = await res.json()
      set({ currentProject: project })
      return true
    } catch {
      return false
    }
  },

  deleteProject: async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (res.ok || res.status === 404) {
        const { projects, currentProject } = get()
        set({ projects: projects.filter(p => p.id !== id) })
        if (currentProject?.id === id) {
          set({ currentProject: null })
        }
      }
    } catch {
      // 删除失败时也从列表移除
      const { projects, currentProject } = get()
      set({ projects: projects.filter(p => p.id !== id) })
      if (currentProject?.id === id) {
        set({ currentProject: null })
      }
    }
  },

  updateProject: async (id: string, data: Partial<Project>) => {
    const existing = get().projects.find(p => p.id === id)
    if (!existing) return null
    const merged = { ...existing, ...data }
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: merged.name,
        description: merged.description,
        genre: merged.genre,
        words_per_chapter: merged.words_per_chapter ?? 3000,
        target_chapters: merged.target_chapters ?? null,
        chapters_per_volume: merged.chapters_per_volume ?? 10,
        preset_id: merged.preset_id ?? null,
      }),
    })
    if (res.ok) {
      const updated = await res.json()
      const { projects, currentProject } = get()
      set({ projects: projects.map(p => p.id === id ? updated : p) })
      if (currentProject?.id === id) {
        set({ currentProject: updated })
      }
      return updated
    }
    return null
  },
}))
