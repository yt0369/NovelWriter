import { create } from 'zustand'

export interface PendingChangeRef {
  id: string
  tool_name: string
  file_path: string
  description: string
  diff: string
  original_content: string
  new_content: string
}

interface EditorStore {
  activeFilePath: string | null
  activeContent: string
  isDirty: boolean
  diffMode: boolean
  activePendingChange: PendingChangeRef | null
  setActiveFile: (path: string | null) => void
  setActiveContent: (content: string) => void
  setIsDirty: (dirty: boolean) => void
  setDiffMode: (change: PendingChangeRef | null) => void
}

export const useEditorStore = create<EditorStore>((set) => ({
  activeFilePath: null,
  activeContent: '',
  isDirty: false,
  diffMode: false,
  activePendingChange: null,

  setActiveFile: (path) => set({ activeFilePath: path, isDirty: false, diffMode: false, activePendingChange: null }),
  setActiveContent: (content) => set({ activeContent: content, isDirty: true }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),
  setDiffMode: (change) => set({ diffMode: !!change, activePendingChange: change }),
}))
