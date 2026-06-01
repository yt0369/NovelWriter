import { create } from 'zustand'

export interface TodoItem {
  id: string
  text: string
  done: boolean
  priority?: 'high' | 'normal' | 'low'
}

interface TodoStore {
  todos: TodoItem[]
  setTodos: (todos: TodoItem[]) => void
  toggleTodo: (id: string) => void
  addTodo: (item: TodoItem) => void
  removeTodo: (id: string) => void
}

export const useTodoStore = create<TodoStore>((set) => ({
  todos: [],
  setTodos: (todos) => set({ todos }),
  toggleTodo: (id) => set((state) => ({
    todos: state.todos.map(t => t.id === id ? { ...t, done: !t.done } : t),
  })),
  addTodo: (item) => set((state) => ({
    todos: [...state.todos, item],
  })),
  removeTodo: (id) => set((state) => ({
    todos: state.todos.filter(t => t.id !== id),
  })),
}))
