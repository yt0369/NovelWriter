import { useState, useEffect } from 'react'
import { ui } from '../../styles/ui'

interface PlanNote {
  id: string
  title: string
  content: string
  status: string
  created_at: number
  updated_at: number
}

interface Props {
  projectId: string
  isOpen: boolean
  onClose: () => void
}

export function PlanNoteViewer({ projectId, isOpen, onClose }: Props) {
  const [notes, setNotes] = useState<PlanNote[]>([])
  const [selectedNote, setSelectedNote] = useState<PlanNote | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    fetch(`/api/plan-notes/${projectId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setNotes(data)
          if (data.length > 0) setSelectedNote(data[0])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, isOpen])

  const handleSave = async () => {
    if (!selectedNote) return
    try {
      await fetch(`/api/plan-notes/${projectId}/${selectedNote.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      })
      const updated = { ...selectedNote, title: editTitle, content: editContent }
      setSelectedNote(updated)
      setNotes(prev => prev.map(n => n.id === updated.id ? updated : n))
      setEditing(false)
    } catch {}
  }

  const handleCreate = async () => {
    try {
      const res = await fetch(`/api/plan-notes/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新计划', content: '' }),
      })
      const note = await res.json()
      setNotes(prev => [note, ...prev])
      setSelectedNote(note)
      setEditing(true)
      setEditTitle('新计划')
      setEditContent('')
    } catch {}
  }

  if (!isOpen) return null

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <h2 style={s.title}>📋 计划笔记</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.addBtn} onClick={handleCreate}>+ 新建</button>
            <button style={s.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        <div style={s.body}>
          {/* 左侧列表 */}
          <div style={s.sidebar}>
            {loading ? (
              <div style={s.loading}>加载中...</div>
            ) : notes.length === 0 ? (
              <div style={s.empty}>暂无计划笔记</div>
            ) : (
              notes.map(note => (
                <div
                  key={note.id}
                  style={{
                    ...s.noteItem,
                    ...(selectedNote?.id === note.id ? s.noteItemActive : {}),
                  }}
                  onClick={() => { setSelectedNote(note); setEditing(false) }}
                >
                  <div style={s.noteTitle}>{note.title}</div>
                  <div style={s.notePreview}>
                    {note.content?.slice(0, 50) || '空内容'}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 右侧详情 */}
          <div style={s.content}>
            {selectedNote ? (
              editing ? (
                <div style={s.editArea}>
                  <input
                    style={s.editTitle}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="标题"
                  />
                  <textarea
                    style={s.editContent}
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    placeholder="内容..."
                  />
                  <div style={s.editActions}>
                    <button style={s.cancelBtn} onClick={() => setEditing(false)}>取消</button>
                    <button style={s.saveBtn} onClick={handleSave}>保存</button>
                  </div>
                </div>
              ) : (
                <div style={s.viewArea}>
                  <div style={s.viewHeader}>
                    <h3 style={s.viewTitle}>{selectedNote.title}</h3>
                    <button
                      style={s.editBtn}
                      onClick={() => {
                        setEditTitle(selectedNote.title)
                        setEditContent(selectedNote.content || '')
                        setEditing(true)
                      }}
                    >
                      编辑
                    </button>
                  </div>
                  <div style={s.viewContent}>
                    {selectedNote.content || '空内容'}
                  </div>
                </div>
              )
            ) : (
              <div style={s.empty}>选择一个计划笔记查看</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  modal: {
    background: ui.color.panel, borderRadius: 12, width: '90%', maxWidth: 800,
    maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    border: `1px solid ${ui.color.borderStrong}`,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: `1px solid ${ui.color.border}`,
  },
  title: { fontSize: 16, fontWeight: 700, color: ui.color.text, margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: ui.color.faint,
    fontSize: 18, cursor: 'pointer', padding: '4px 8px',
  },
  addBtn: {
    background: ui.color.primary, border: 'none', borderRadius: 6,
    padding: '4px 12px', color: '#fff', fontSize: 12, cursor: 'pointer',
  },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  sidebar: {
    width: 240, borderRight: `1px solid ${ui.color.border}`,
    overflow: 'auto', padding: '8px 0',
  },
  content: { flex: 1, overflow: 'auto' },
  loading: { padding: 20, textAlign: 'center' as const, color: ui.color.faint },
  empty: { padding: 20, textAlign: 'center' as const, color: ui.color.faint, fontSize: 13 },
  noteItem: {
    padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${ui.color.border}`,
  },
  noteItemActive: {
    background: ui.color.panelSoft,
  },
  noteTitle: { fontSize: 13, fontWeight: 600, color: ui.color.text, marginBottom: 4 },
  notePreview: { fontSize: 11, color: ui.color.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  editArea: { padding: 16, display: 'flex', flexDirection: 'column' as const, gap: 12 },
  editTitle: {
    width: '100%', background: ui.color.bg, border: `1px solid ${ui.color.border}`,
    borderRadius: 6, padding: '8px 12px', color: ui.color.text, fontSize: 14,
    outline: 'none',
  },
  editContent: {
    width: '100%', flex: 1, minHeight: 200, background: ui.color.bg,
    border: `1px solid ${ui.color.border}`, borderRadius: 6, padding: '8px 12px',
    color: ui.color.text, fontSize: 13, outline: 'none', resize: 'vertical' as const,
  },
  editActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: {
    background: ui.color.panelAlt, border: `1px solid ${ui.color.border}`,
    borderRadius: 6, padding: '6px 16px', color: ui.color.muted,
    fontSize: 12, cursor: 'pointer',
  },
  saveBtn: {
    background: ui.color.primary, border: 'none', borderRadius: 6,
    padding: '6px 16px', color: '#fff', fontSize: 12, cursor: 'pointer',
  },
  viewArea: { padding: 16 },
  viewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  viewTitle: { fontSize: 18, fontWeight: 700, color: ui.color.text, margin: 0 },
  editBtn: {
    background: 'transparent', border: `1px solid ${ui.color.border}`,
    borderRadius: 6, padding: '4px 12px', color: ui.color.muted,
    fontSize: 12, cursor: 'pointer',
  },
  viewContent: { fontSize: 14, color: ui.color.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
}
