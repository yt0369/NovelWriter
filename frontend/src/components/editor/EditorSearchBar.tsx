import { useState, useEffect, useRef, useCallback } from 'react'

interface Props {
  visible: boolean
  onClose: () => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  content: string
  setContent: (content: string) => void
}

export function EditorSearchBar({ visible, onClose, textareaRef, content, setContent }: Props) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatch, setCurrentMatch] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50)
      // 从选中文本填充搜索框
      const ta = textareaRef.current
      if (ta && ta.selectionStart !== ta.selectionEnd) {
        const selected = content.substring(ta.selectionStart, ta.selectionEnd)
        if (selected.length < 100) setQuery(selected)
      }
    }
  }, [visible])

  useEffect(() => {
    if (!query) { setMatchCount(0); setCurrentMatch(0); return }
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const matches = content.match(regex)
    setMatchCount(matches ? matches.length : 0)
    setCurrentMatch(matches && matches.length > 0 ? 1 : 0)
  }, [query, content])

  const findNext = useCallback(() => {
    if (!query || !textareaRef.current) return
    const ta = textareaRef.current
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const text = ta.value
    const start = ta.selectionEnd || 0
    const match = regex.exec(text.substring(start))
    if (match) {
      const pos = start + match.index
      ta.focus()
      ta.setSelectionRange(pos, pos + match[0].length)
      setCurrentMatch(prev => prev >= matchCount ? 1 : prev + 1)
    } else {
      // 循环回到开头
      const firstMatch = regex.exec(text)
      if (firstMatch) {
        ta.focus()
        ta.setSelectionRange(firstMatch.index, firstMatch.index + firstMatch[0].length)
        setCurrentMatch(1)
      }
    }
  }, [query, matchCount])

  const findPrev = useCallback(() => {
    if (!query || !textareaRef.current) return
    const ta = textareaRef.current
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const text = ta.value
    const start = ta.selectionStart || 0
    const before = text.substring(0, start)
    let lastMatch: RegExpExecArray | null = null
    let m: RegExpExecArray | null
    while ((m = regex.exec(before)) !== null) {
      lastMatch = m
    }
    if (lastMatch) {
      ta.focus()
      ta.setSelectionRange(lastMatch.index, lastMatch.index + lastMatch[0].length)
      setCurrentMatch(prev => prev <= 1 ? matchCount : prev - 1)
    } else {
      // 循环到末尾
      const allMatches = [...text.matchAll(regex)]
      if (allMatches.length > 0) {
        const last = allMatches[allMatches.length - 1]
        ta.focus()
        ta.setSelectionRange(last.index, last.index + last[0].length)
        setCurrentMatch(matchCount)
      }
    }
  }, [query, matchCount])

  const replaceCurrent = useCallback(() => {
    if (!query || !textareaRef.current) return
    const ta = textareaRef.current
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.substring(start, end)
    const regex = new RegExp(`^${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    if (regex.test(selected)) {
      const newContent = content.substring(0, start) + replace + content.substring(end)
      setContent(newContent)
      setTimeout(() => {
        ta.setSelectionRange(start, start + replace.length)
        findNext()
      }, 0)
    } else {
      findNext()
    }
  }, [query, replace, content, findNext])

  const replaceAll = useCallback(() => {
    if (!query) return
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const newContent = content.replace(regex, replace)
    setContent(newContent)
    setMatchCount(0)
    setCurrentMatch(0)
  }, [query, replace, content])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!visible) return
      if (e.key === 'Escape') { onClose(); e.preventDefault() }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); findNext() }
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); findPrev() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible, findNext, findPrev, onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        if (!visible) setShowReplace(false)
        // 由父组件控制 visible
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault()
        setShowReplace(true)
        // 由父组件控制 visible
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [visible])

  if (!visible) return null

  return (
    <div style={styles.container}>
      <div style={styles.row}>
        <input
          ref={inputRef}
          style={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索..."
        />
        <span style={styles.count}>{query ? `${currentMatch}/${matchCount}` : ''}</span>
        <button style={styles.btn} onClick={findPrev} title="上一个 (Shift+Enter)">▲</button>
        <button style={styles.btn} onClick={findNext} title="下一个 (Enter)">▼</button>
        <button style={styles.btn} onClick={() => setShowReplace(!showReplace)} title="替换">⇄</button>
        <button style={styles.btnClose} onClick={onClose} title="关闭 (Esc)">✕</button>
      </div>
      {showReplace && (
        <div style={styles.row}>
          <input
            style={styles.input}
            value={replace}
            onChange={e => setReplace(e.target.value)}
            placeholder="替换..."
          />
          <button style={styles.btn} onClick={replaceCurrent}>替换</button>
          <button style={styles.btn} onClick={replaceAll}>全部</button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute', top: 0, right: 8, zIndex: 20,
    background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)', padding: 6,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 4,
  },
  input: {
    width: 180, padding: '4px 8px', fontSize: 12,
    background: '#111827', color: '#e5e7eb', border: '1px solid #374151',
    borderRadius: 4, outline: 'none',
  },
  count: { fontSize: 11, color: '#6b7280', minWidth: 40, textAlign: 'center' },
  btn: {
    background: 'none', border: 'none', color: '#9ca3af', fontSize: 12,
    cursor: 'pointer', padding: '4px 6px', borderRadius: 3,
  },
  btnClose: {
    background: 'none', border: 'none', color: '#6b7280', fontSize: 12,
    cursor: 'pointer', padding: '4px 6px',
  },
}
