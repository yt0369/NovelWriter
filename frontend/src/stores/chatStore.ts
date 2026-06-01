import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'model' | 'system'
  content: string
  reasoning_content?: string
  reasoning_collapsed?: boolean
  metadata?: Record<string, unknown>
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  last_modified: number
}

interface ChatStore {
  sessionId: string | null
  sessions: ChatSession[]
  messages: ChatMessage[]
  isLoading: boolean
  setSessionId: (id: string | null) => void
  setSessions: (sessions: ChatSession[]) => void
  addSession: (session: ChatSession) => void
  removeSession: (id: string) => void
  updateSessionTitle: (id: string, title: string) => void
  setMessages: (messages: ChatMessage[]) => void
  addMessage: (msg: ChatMessage) => void
  removeMessage: (id: string) => void
  removeMessagesFrom: (id: string) => void
  updateLastModelMessage: (content: string) => void
  updateLastModelReasoning: (content: string) => void
  toggleReasoning: (id: string) => void
  setIsLoading: (loading: boolean) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatStore>((set) => ({
  sessionId: null,
  sessions: [],
  messages: [],
  isLoading: false,

  setSessionId: (id) => set({ sessionId: id }),
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions],
  })),
  removeSession: (id) => set((state) => ({
    sessions: state.sessions.filter(s => s.id !== id),
  })),
  updateSessionTitle: (id, title) => set((state) => ({
    sessions: state.sessions.map(s => s.id === id ? { ...s, title } : s),
  })),

  setMessages: (messages) => set({ messages }),
  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, msg],
  })),

  removeMessage: (id) => set((state) => ({
    messages: state.messages.filter(m => m.id !== id),
  })),

  removeMessagesFrom: (id) => set((state) => {
    const idx = state.messages.findIndex(m => m.id === id)
    if (idx === -1) return state
    return { messages: state.messages.slice(0, idx) }
  }),

  updateLastModelMessage: (content) => set((state) => {
    const msgs = [...state.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'model') {
      msgs[msgs.length - 1] = { ...last, content }
    }
    return { messages: msgs }
  }),

  updateLastModelReasoning: (content) => set((state) => {
    const msgs = [...state.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'model') {
      msgs[msgs.length - 1] = {
        ...last,
        reasoning_content: `${last.reasoning_content || ''}${content}`,
        reasoning_collapsed: last.reasoning_collapsed ?? true,
      }
    }
    return { messages: msgs }
  }),

  toggleReasoning: (id) => set((state) => ({
    messages: state.messages.map(msg => (
      msg.id === id ? { ...msg, reasoning_collapsed: !(msg.reasoning_collapsed ?? true) } : msg
    )),
  })),

  setIsLoading: (loading) => set({ isLoading: loading }),
  clearMessages: () => set({ messages: [] }),
}))
