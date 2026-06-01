import { useState, useEffect } from 'react'

interface KnowledgeNode {
  id: string
  name: string
  summary: string
  detail: string
  wing: string
  room: string
  category: string
  sub_category: string
  importance: string
  tags: string[]
  created_at: number
  last_modified: number
}

interface Props {
  projectId: string
  nodeId: string
  onClose: () => void
  onDeleted: () => void
}

export function NodeDetail({ projectId, nodeId, onClose, onDeleted }: Props) {
  const [node, setNode] = useState<KnowledgeNode | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<KnowledgeNode>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/memory/${projectId}/nodes/${nodeId}`)
      .then(r => r.json())
      .then(data => { setNode(data); setEditForm(data) })
      .catch(() => {})
  }, [projectId, nodeId])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/memory/${projectId}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      const data = await res.json()
      setNode(data)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('确定删除此节点？关联的关系也会被删除。')) return
    await fetch(`/api/memory/${projectId}/nodes/${nodeId}`, { method: 'DELETE' })
    onDeleted()
  }

  if (!node) return <div style={{ color: '#888', padding: 20 }}>加载中...</div>

  const importanceOptions = ['low', 'normal', 'high', 'critical']
  const wingOptions = ['世界', '角色', '剧情', '灵感', '设定', '物品']

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{editing ? '编辑节点' : node.name}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {!editing && <button style={styles.editBtn} onClick={() => setEditing(true)}>编辑</button>}
            <span onClick={onClose} style={styles.closeBtn}>&times;</span>
          </div>
        </div>

        <div style={styles.body}>
          {editing ? (
            <>
              <Field label="名称" value={editForm.name || ''} onChange={v => setEditForm({ ...editForm, name: v })} />
              <div style={styles.row}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>知识翼</label>
                  <select style={styles.input} value={editForm.wing || ''} onChange={e => setEditForm({ ...editForm, wing: e.target.value })}>
                    {wingOptions.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>重要性</label>
                  <select style={styles.input} value={editForm.importance || 'normal'} onChange={e => setEditForm({ ...editForm, importance: e.target.value })}>
                    {importanceOptions.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              </div>
              <Field label="分类" value={editForm.category || ''} onChange={v => setEditForm({ ...editForm, category: v })} />
              <Field label="摘要" value={editForm.summary || ''} onChange={v => setEditForm({ ...editForm, summary: v })} multiline />
              <Field label="详细" value={editForm.detail || ''} onChange={v => setEditForm({ ...editForm, detail: v })} multiline />
              <Field label="标签（逗号分隔）" value={(editForm.tags || []).join(', ')} onChange={v => setEditForm({ ...editForm, tags: v.split(',').map(t => t.trim()).filter(Boolean) })} />
            </>
          ) : (
            <>
              <InfoRow label="知识翼" value={node.wing} />
              <InfoRow label="分类" value={node.category || '-'} />
              <InfoRow label="重要性" value={node.importance} />
              {node.tags.length > 0 && <InfoRow label="标签" value={node.tags.join(', ')} />}
              {node.summary && (
                <div style={{ marginTop: 12 }}>
                  <div style={styles.label}>摘要</div>
                  <div style={styles.text}>{node.summary}</div>
                </div>
              )}
              {node.detail && (
                <div style={{ marginTop: 12 }}>
                  <div style={styles.label}>详细</div>
                  <div style={{ ...styles.text, whiteSpace: 'pre-wrap' }}>{node.detail}</div>
                </div>
              )}
              <div style={{ marginTop: 12, fontSize: 11, color: '#555' }}>
                创建: {new Date(node.created_at * 1000).toLocaleString()}
                {' | '}更新: {new Date(node.last_modified * 1000).toLocaleString()}
              </div>
            </>
          )}
        </div>

        <div style={styles.footer}>
          {editing ? (
            <>
              <button style={styles.cancelBtn} onClick={() => { setEditing(false); setEditForm(node) }}>取消</button>
              <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
            </>
          ) : (
            <button style={styles.deleteBtn} onClick={handleDelete}>删除节点</button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={styles.label}>{label}</label>
      {multiline ? (
        <textarea style={{ ...styles.input, minHeight: 60, resize: 'vertical' }} value={value} onChange={e => onChange(e.target.value)} />
      ) : (
        <input style={styles.input} value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 13 }}>
      <span style={{ color: '#888', minWidth: 60 }}>{label}</span>
      <span style={{ color: '#e0e0e0' }}>{value}</span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200,
  },
  modal: {
    background: '#1a1a2e', borderRadius: 12, width: 560, maxWidth: '90vw',
    maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    border: '1px solid #2a2a3e',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #2a2a3e',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#e0e0e0', margin: 0 },
  editBtn: {
    background: '#2a2a3e', border: '1px solid #3a3a5e', borderRadius: 6,
    padding: '4px 12px', color: '#a78bfa', fontSize: 12, cursor: 'pointer',
  },
  closeBtn: { cursor: 'pointer', fontSize: 20, color: '#888', marginLeft: 8 },
  body: { flex: 1, overflow: 'auto', padding: 20 },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4 },
  input: {
    width: '100%', background: '#2a2a3e', border: '1px solid #3a3a5e',
    borderRadius: 8, padding: '8px 10px', color: '#e0e0e0', fontSize: 13,
    outline: 'none', boxSizing: 'border-box',
  },
  row: { display: 'flex', gap: 12 },
  text: { fontSize: 13, color: '#ccc', lineHeight: 1.6 },
  footer: {
    padding: '12px 20px', borderTop: '1px solid #2a2a3e',
    display: 'flex', justifyContent: 'flex-end', gap: 12,
  },
  cancelBtn: {
    background: '#2a2a3e', color: '#ccc', border: '1px solid #3a3a5e',
    borderRadius: 8, padding: '8px 20px', cursor: 'pointer',
  },
  saveBtn: {
    background: '#4f46e5', color: '#fff', border: 'none',
    borderRadius: 8, padding: '8px 20px', cursor: 'pointer',
  },
  deleteBtn: {
    background: '#2a2a3e', color: '#ef4444', border: '1px solid #3a3a5e',
    borderRadius: 8, padding: '8px 20px', cursor: 'pointer',
  },
}
