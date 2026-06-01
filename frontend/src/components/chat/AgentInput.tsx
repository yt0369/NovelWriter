import type { CSSProperties } from 'react'
import { AgentTodoList } from './AgentTodoList'

interface TodoItem {
  id: string
  text: string
  done: boolean
  priority?: string
}

interface Props {
  input: string
  todoItems: TodoItem[]
  isLoading: boolean
  onInput: (value: string) => void
  onSend: () => void
  onCancel: () => void
}

export function AgentInput({ input, todoItems, isLoading, onInput, onSend, onCancel }: Props) {
  return (
    <div style={styles.inputArea}>
      {todoItems.length > 0 && <AgentTodoList items={todoItems} />}
      <div style={styles.inputWrapper}>
        <textarea
          style={styles.input}
          value={input}
          onChange={e => onInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder="输入消息..."
          rows={1}
        />
        <div style={styles.inputToolbar}>
          <div style={styles.toolbarLeft}>
            <button style={styles.toolbarBtn} title="附件" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button style={styles.toolbarBtn} title="@ 提及" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
              </svg>
            </button>
            <button style={styles.toolbarBtn} title="标签" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </button>
          </div>
          {isLoading ? (
            <button style={{ ...styles.sendBtn, background: '#ef4444' }} onClick={onCancel} type="button">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button style={styles.sendBtn} onClick={onSend} disabled={!input.trim()} type="button">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  inputArea: { padding: '12px 16px', borderTop: '1px solid #1f2937' },
  inputWrapper: {
    background: '#111827', border: '1px solid #374151',
    borderRadius: 8, overflow: 'hidden',
  },
  input: {
    width: '100%', background: 'transparent', border: 'none',
    color: '#e5e7eb', fontSize: 14, resize: 'none', outline: 'none',
    padding: '10px 12px', minHeight: 42, maxHeight: 160, boxSizing: 'border-box',
  },
  inputToolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 8px', borderTop: '1px solid #1f2937',
  },
  toolbarLeft: { display: 'flex', gap: 4 },
  toolbarBtn: {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', borderRadius: 4,
  },
  sendBtn: {
    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#14b8a6', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 6,
  },
}
