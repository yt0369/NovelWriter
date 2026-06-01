import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIStore {
  sidebarOpen: boolean
  sidebarWidth: number
  chatOpen: boolean
  chatWidth: number
  splitView: boolean
  showLineNumbers: boolean
  wordWrap: boolean
  debugMode: boolean
  tutorialSeen: boolean
  language: string
  theme: 'dark' | 'light'

  toggleSidebar: () => void
  setSidebarWidth: (w: number) => void
  toggleChat: () => void
  setChatWidth: (w: number) => void
  toggleSplitView: () => void
  toggleLineNumbers: () => void
  toggleWordWrap: () => void
  toggleDebugMode: () => void
  setTutorialSeen: () => void
  setLanguage: (lang: string) => void
  setTheme: (theme: 'dark' | 'light') => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 260,
      chatOpen: true,
      chatWidth: 380,
      splitView: false,
      showLineNumbers: true,
      wordWrap: true,
      debugMode: false,
      tutorialSeen: false,
      language: 'zh-CN',
      theme: 'dark',

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(200, Math.min(500, w)) }),
      toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
      setChatWidth: (w) => set({ chatWidth: Math.max(300, Math.min(600, w)) }),
      toggleSplitView: () => set((s) => ({ splitView: !s.splitView })),
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      toggleDebugMode: () => set((s) => ({ debugMode: !s.debugMode })),
      setTutorialSeen: () => set({ tutorialSeen: true }),
      setLanguage: (lang) => set({ language: lang }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'novelwriter-ui' }
  )
)
