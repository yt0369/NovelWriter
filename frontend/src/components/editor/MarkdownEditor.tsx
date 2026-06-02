import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { useEditorStore } from '../../stores/editorStore'
import { DiffViewer } from '../chat/DiffViewer'
import { VersionHistory } from './VersionHistory'
import { EditorToolbar } from './EditorToolbar'
import { EditorGutter } from './EditorGutter'
import { EditorSearchBar } from './EditorSearchBar'
import { emitFileUpdated, emitPendingUpdated, FILE_UPDATED_EVENT, refreshMatchesPath, WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'

interface Props {
  projectId: string
}

async function readApiError(res: Response, fallback: string) {
  try {
    const data = await res.json()
    return data.detail || data.error || fallback
  } catch {
    return fallback
  }
}

export function MarkdownEditor({ projectId }: Props) {
  const { activeFilePath, activeContent, isDirty, setActiveContent, setIsDirty, setActiveFile, diffMode, activePendingChange, setDiffMode } = useEditorStore()
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'waiting' | 'saving' | 'saved'>('idle')
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('edit')
  const [scrollTop, setScrollTop] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject' | null>(null)
  const [pendingActionMessage, setPendingActionMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContent = useRef<string>('')

  const wordCount = activeContent ? activeContent.replace(/\s/g, '').length : 0
  const lineCount = activeContent ? activeContent.split('\n').length : 0

  const notifyFileUpdated = useCallback((path: string | null) => {
    if (!path) return
    emitFileUpdated(path)
  }, [])

  const handleSave = useCallback(async () => {
    if (!activeFilePath || !isDirty) return
    setSaving(true)
    setAutoSaveStatus('saving')
    try {
      await fetch(`/api/files/${projectId}/write`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFilePath, content: activeContent }),
      })
      setIsDirty(false)
      lastSavedContent.current = activeContent
      setAutoSaveStatus('saved')
      notifyFileUpdated(activeFilePath)
      setTimeout(() => setAutoSaveStatus('idle'), 2000)
    } catch {
      setAutoSaveStatus('idle')
    } finally {
      setSaving(false)
    }
  }, [projectId, activeFilePath, activeContent, isDirty, notifyFileUpdated, setIsDirty])

  useEffect(() => {
    if (!isDirty || !activeFilePath) return
    if (activeContent === lastSavedContent.current) return
    setAutoSaveStatus('waiting')
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      if (!activeFilePath) return
      setAutoSaveStatus('saving')
      try {
        await fetch(`/api/files/${projectId}/write`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeFilePath, content: activeContent }),
        })
        setIsDirty(false)
        lastSavedContent.current = activeContent
        setAutoSaveStatus('saved')
        notifyFileUpdated(activeFilePath)
        setTimeout(() => setAutoSaveStatus('idle'), 2000)
      } catch {
        setAutoSaveStatus('idle')
      }
    }, 3000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [activeContent, isDirty, activeFilePath, projectId, notifyFileUpdated, setIsDirty])

  useEffect(() => {
    lastSavedContent.current = ''
    setAutoSaveStatus('idle')
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
  }, [activeFilePath])

  useEffect(() => {
    setPendingAction(null)
    setPendingActionMessage('')
  }, [activePendingChange?.id])

  useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (!activeFilePath) return
      if (!refreshMatchesPath(detail, activeFilePath)) return
      const res = await fetch(`/api/files/${projectId}/read?path=${encodeURIComponent(activeFilePath)}`)
      if (!res.ok) return
      const data = await res.json()
      setActiveContent(data.content)
      setIsDirty(false)
      lastSavedContent.current = data.content
    }
    window.addEventListener(FILE_UPDATED_EVENT, handler)
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => {
      window.removeEventListener(FILE_UPDATED_EVENT, handler)
      window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
    }
  }, [projectId, activeFilePath, setActiveContent, setIsDirty])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  const insertMarkdown = (prefix: string, suffix: string = '') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = activeContent.substring(start, end)
    const newText = activeContent.substring(0, start) + prefix + selected + suffix + activeContent.substring(end)
    setActiveContent(newText)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
    }, 0)
  }

  const handlePendingEditStatusChange = async (editId: string, status: 'accepted' | 'rejected' | 'pending') => {
    if (!activePendingChange) return
    const res = await fetch(`/api/agent/${projectId}/pending-changes/${activePendingChange.id}/edits/${editId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) return
    const updated = await res.json()
    setDiffMode(updated)
    emitPendingUpdated('pending-revised')
  }

  const handleApprovePendingChange = useCallback(async () => {
    if (!activePendingChange || pendingAction) return
    const change = activePendingChange
    setPendingAction('approve')
    setPendingActionMessage('正在批准并写入文件...')
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes/${change.id}/approve`, { method: 'POST' })
      if (res.ok || res.status === 404) {
        const data = res.ok ? await res.json().catch(() => ({})) : {}
        const filePath = (data.file_path as string) || change.file_path
        setPendingActionMessage('已批准，正在刷新文件...')
        emitFileUpdated(filePath)
        emitPendingUpdated('pending-approved')
        setDiffMode(null)
        setPendingAction(null)
        setPendingActionMessage('')
        return
      }
      const error = await readApiError(res, '未知错误')
      setPendingActionMessage(`批准失败: ${error}`)
    } catch {
      setPendingActionMessage('批准失败: 网络或后端异常')
    } finally {
      setPendingAction(null)
    }
  }, [activePendingChange, pendingAction, projectId, setDiffMode])

  const handleRejectPendingChange = useCallback(async () => {
    if (!activePendingChange || pendingAction) return
    const change = activePendingChange
    setPendingAction('reject')
    setPendingActionMessage('正在拒绝变更...')
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes/${change.id}/reject`, { method: 'POST' })
      if (res.ok || res.status === 404) {
        emitPendingUpdated('pending-rejected')
        setDiffMode(null)
        setPendingAction(null)
        setPendingActionMessage('')
        return
      }
      const error = await readApiError(res, '未知错误')
      setPendingActionMessage(`拒绝失败: ${error}`)
    } catch {
      setPendingActionMessage('拒绝失败: 网络或后端异常')
    } finally {
      setPendingAction(null)
    }
  }, [activePendingChange, pendingAction, projectId, setDiffMode])

  const fileName = activeFilePath?.split('/').pop() || activeFilePath || ''
  const chapterName = fileName.replace(/\.md$/, '')

  // Diff 模式：即使没有打开文件也显示 DiffViewer
  if (diffMode && activePendingChange) {
    return (
      <div style={styles.container}>
        <div style={styles.breadcrumb}>
          <span style={styles.breadcrumbItem}>审批变更</span>
          <span style={styles.breadcrumbSep}>/</span>
          <span style={styles.breadcrumbItemActive}>{activePendingChange.file_path}</span>
          <span style={styles.breadcrumbRight}>
            <button style={styles.closeDiffBtn} onClick={() => setDiffMode(null)} title="关闭审批">✕ 关闭</button>
          </span>
        </div>
        <div style={{ ...styles.body, position: 'relative', overflow: 'auto' }}>
          <DiffViewer
            diff={activePendingChange.diff}
            filePath={activePendingChange.file_path}
            edits={activePendingChange.metadata?.edits}
            actionBusy={!!pendingAction}
            actionMessage={pendingActionMessage}
            onEditStatusChange={handlePendingEditStatusChange}
            onApprove={handleApprovePendingChange}
            onReject={handleRejectPendingChange}
          />
        </div>
      </div>
    )
  }

  if (!activeFilePath) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>📝</div>
        <div style={styles.emptyText}>选择一个文件开始编辑</div>
        <div style={styles.emptyHint}>从左侧文件库中选择文件</div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <span style={styles.breadcrumbItem}>当前章节</span>
        <span style={styles.breadcrumbSep}>/</span>
        <span style={styles.breadcrumbItemActive}>{chapterName}</span>
        <span style={styles.breadcrumbSep}>/</span>
        <span style={styles.breadcrumbItemDim}>正在编辑</span>
        <span style={styles.breadcrumbRight}>
          {autoSaveStatus === 'saved' && <span style={styles.savedHint}>已自动保存</span>}
        </span>
      </div>

      {/* File Tab */}
      <div style={styles.tabBar}>
        <div style={styles.tabActive}>
          <span style={styles.tabIcon}>◉</span>
          <span style={styles.tabText}>{chapterName}</span>
          <button style={styles.tabClose} onClick={() => setActiveFile(null)}>✕</button>
        </div>
        <button style={styles.tabAdd}>+</button>
      </div>

      {/* Formatting Toolbar */}
      <EditorToolbar
        onInsert={insertMarkdown}
        viewMode={viewMode}
        setViewMode={setViewMode}
        wordCount={wordCount}
        lineCount={lineCount}
      />

      {/* Content Area */}
      <div style={{ ...styles.body, position: 'relative', overflow: diffMode ? 'hidden' : 'auto' }}>
        {/* Diff 模式：显示 DiffViewer 替代编辑器 */}
        {diffMode && activePendingChange && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
            <DiffViewer
              diff={activePendingChange.diff}
              filePath={activePendingChange.file_path}
              edits={activePendingChange.metadata?.edits}
              actionBusy={!!pendingAction}
              actionMessage={pendingActionMessage}
              onEditStatusChange={handlePendingEditStatusChange}
              onApprove={handleApprovePendingChange}
              onReject={handleRejectPendingChange}
          />
          </div>
        )}
        <EditorSearchBar
          visible={showSearch}
          onClose={() => setShowSearch(false)}
          textareaRef={textareaRef}
          content={activeContent}
          setContent={setActiveContent}
        />
        {viewMode !== 'preview' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <EditorGutter lineCount={lineCount} scrollTop={scrollTop} textareaRef={textareaRef} />
            <textarea
              ref={textareaRef}
              data-testid="editor-textarea"
              style={viewMode === 'split' ? styles.textareaSplit : styles.textarea}
              value={activeContent}
              onChange={e => setActiveContent(e.target.value)}
              onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
              placeholder="开始写作..."
              spellCheck={false}
            />
          </div>
        )}
        {viewMode !== 'edit' && (
          <div style={viewMode === 'split' ? styles.previewSplit : styles.previewFull}>
            <div style={styles.previewContent}>
              <ReactMarkdown
                components={{
                  h1: ({ children }) => <h1 style={previewStyles.h1}>{children}</h1>,
                  h2: ({ children }) => <h2 style={previewStyles.h2}>{children}</h2>,
                  h3: ({ children }) => <h3 style={previewStyles.h3}>{children}</h3>,
                  p: ({ children }) => <p style={previewStyles.p}>{children}</p>,
                  blockquote: ({ children }) => <blockquote style={previewStyles.blockquote}>{children}</blockquote>,
                  ul: ({ children }) => <ul style={previewStyles.ul}>{children}</ul>,
                  ol: ({ children }) => <ol style={previewStyles.ol}>{children}</ol>,
                  li: ({ children }) => <li style={previewStyles.li}>{children}</li>,
                  code: ({ children }) => <code style={previewStyles.code}>{children}</code>,
                  pre: ({ children }) => <pre style={previewStyles.pre}>{children}</pre>,
                  hr: () => <hr style={previewStyles.hr} />,
                  strong: ({ children }) => <strong style={previewStyles.strong}>{children}</strong>,
                  em: ({ children }) => <em style={previewStyles.em}>{children}</em>,
                }}
              >
                {activeContent || '*暂无内容*'}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {showVersionHistory && (
          <VersionHistory
            projectId={projectId}
            filePath={activeFilePath}
            onClose={() => setShowVersionHistory(false)}
          />
        )}
      </div>

      {/* Status Bar */}
      <div style={styles.statusBar}>
        <span style={styles.statusItem}>Markdown</span>
        <span style={styles.statusDivider}>|</span>
        <span style={styles.statusItem}>行 1, 列 1</span>
        <span style={styles.statusDivider}>|</span>
        <span style={styles.statusItem}>{wordCount.toLocaleString()} 字</span>
        <div style={{ flex: 1 }} />
        <span style={styles.statusItem}>拼写检查: 关闭</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', flex: 1, height: '100%',
    background: '#0d1117',
  },
  breadcrumb: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 16px', fontSize: 12, color: '#6b7280',
    background: '#111827', borderBottom: '1px solid #1f2937',
  },
  breadcrumbItem: { color: '#9ca3af' },
  breadcrumbItemActive: { color: '#e5e7eb', fontWeight: 600 },
  breadcrumbItemDim: { color: '#6b7280' },
  breadcrumbSep: { color: '#4b5563' },
  breadcrumbRight: { marginLeft: 'auto' },
  closeDiffBtn: {
    background: 'transparent',
    border: '1px solid #7f1d1d',
    borderRadius: 4,
    padding: '2px 8px',
    color: '#fca5a5',
    fontSize: 11,
    cursor: 'pointer',
  },

  body: {
    display: 'flex', flex: 1, overflow: 'hidden',
  },
  textarea: {
    flex: 1, background: '#0d1117', color: '#e5e7eb', border: 'none',
    padding: 24, fontSize: 15, lineHeight: 1.8, resize: 'none',
    fontFamily: "'Noto Serif SC', Georgia, serif", outline: 'none',
  },
  textareaSplit: {
    flex: 1, background: '#0d1117', color: '#e5e7eb', border: 'none',
    padding: 24, fontSize: 15, lineHeight: 1.8, resize: 'none',
    fontFamily: "'Noto Serif SC', Georgia, serif", outline: 'none',
    borderRight: '1px solid #1f2937',
  },
  previewFull: { flex: 1, overflow: 'auto', background: '#0d1117' },
  previewSplit: { flex: 1, overflow: 'auto', background: '#0d1117', borderLeft: '1px solid #1f2937' },
  previewContent: {
    padding: 24, color: '#e5e7eb', lineHeight: 1.8,
    fontFamily: "'Noto Serif SC', Georgia, serif",
  },

  statusBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 16px', background: '#111827', borderTop: '1px solid #1f2937',
    fontSize: 11, color: '#6b7280',
  },
  statusItem: {},
  statusDivider: { color: '#374151' },

  savedHint: { color: '#14b8a6', fontSize: 11 },

  empty: {
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    alignItems: 'center', flex: 1, color: '#4b5563',
    background: '#0d1117',
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { fontSize: 18, marginBottom: 8, color: '#6b7280' },
  emptyHint: { fontSize: 13, color: '#4b5563' },
}

const previewStyles: Record<string, React.CSSProperties> = {
  h1: { fontSize: 28, fontWeight: 700, marginTop: 24, marginBottom: 16, color: '#f3f4f6', borderBottom: '1px solid #1f2937', paddingBottom: 8 },
  h2: { fontSize: 22, fontWeight: 600, marginTop: 20, marginBottom: 12, color: '#f3f4f6' },
  h3: { fontSize: 18, fontWeight: 600, marginTop: 16, marginBottom: 8, color: '#e5e7eb' },
  p: { marginTop: 0, marginBottom: 12 },
  blockquote: { borderLeft: '3px solid #14b8a6', paddingLeft: 16, marginLeft: 0, marginRight: 0, color: '#9ca3af', fontStyle: 'italic', marginBottom: 12 },
  ul: { paddingLeft: 24, marginBottom: 12 },
  ol: { paddingLeft: 24, marginBottom: 12 },
  li: { marginBottom: 4 },
  code: { background: '#1f2937', padding: '2px 6px', borderRadius: 4, fontSize: 14, fontFamily: "'JetBrains Mono', monospace" },
  pre: { background: '#1f2937', padding: 16, borderRadius: 8, overflow: 'auto', marginBottom: 12 },
  hr: { border: 'none', borderTop: '1px solid #1f2937', margin: '24px 0' },
  strong: { fontWeight: 700, color: '#f3f4f6' },
  em: { fontStyle: 'italic' },
}
