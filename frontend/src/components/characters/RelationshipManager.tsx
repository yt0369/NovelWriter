import { useState, useEffect } from 'react'
import { useRelationshipStore, Relationship } from '../../stores/relationshipStore'

interface Character {
  id: string
  name: string
  role?: string
}

interface Props {
  projectId: string
  visible: boolean
  onClose: () => void
}

const PRESET_TYPES = [
  '朋友', '恋人', '夫妻', '亲人', '师徒', '同事',
  '敌人', '对手', '盟友', '上下级', '保护者', '被保护者',
]

const STRENGTH_OPTIONS = [
  { value: 3, label: '强', color: '#ef4444' },
  { value: 2, label: '中', color: '#f59e0b' },
  { value: 1, label: '弱', color: '#6b7280' },
]

export function RelationshipManager({ projectId, visible, onClose }: Props) {
  const { relationships, loading, fetchRelationships, createRelationship, deleteRelationship } = useRelationshipStore()
  const [characters, setCharacters] = useState<Character[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newRel, setNewRel] = useState({
    from_name: '', to_name: '', relation_type: '朋友', strength: 2, description: '',
  })

  useEffect(() => {
    if (visible) {
      fetchRelationships(projectId)
      fetch(`/api/characters/${projectId}`).then(r => r.json()).then(setCharacters).catch(() => {})
    }
  }, [projectId, visible])

  const handleCreate = async () => {
    if (!newRel.from_name || !newRel.to_name) return
    await createRelationship(projectId, {
      from_character_id: newRel.from_name,
      to_character_id: newRel.to_name,
      relation_type: newRel.relation_type,
      strength: newRel.strength,
      description: newRel.description,
    })
    setNewRel({ from_name: '', to_name: '', relation_type: '朋友', strength: 2, description: '' })
    setShowCreate(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此关系？')) return
    await deleteRelationship(projectId, id)
  }

  if (!visible) return null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: 16 }}>关系管理</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.addBtn} onClick={() => setShowCreate(true)}>+ 新建</button>
            <span style={styles.closeBtn} onClick={onClose}>&times;</span>
          </div>
        </div>

        <div style={styles.body}>
          {loading ? (
            <div style={styles.loading}>加载中...</div>
          ) : relationships.length === 0 ? (
            <div style={styles.empty}>暂无关系数据</div>
          ) : (
            <div style={styles.list}>
              {relationships.map(rel => (
                <div key={rel.id} style={styles.card}>
                  <div style={styles.cardHeader}>
                    <span style={styles.charName}>{rel.from_character_id}</span>
                    <span style={styles.arrow}>→</span>
                    <span style={styles.charName}>{rel.to_character_id}</span>
                    <span style={styles.relType}>{rel.relation_type}</span>
                    <span style={{
                      ...styles.strength,
                      color: STRENGTH_OPTIONS.find(s => s.value === rel.strength)?.color || '#6b7280',
                    }}>
                      {STRENGTH_OPTIONS.find(s => s.value === rel.strength)?.label || '中'}
                    </span>
                  </div>
                  {rel.description && (
                    <div style={styles.description}>{rel.description}</div>
                  )}
                  <button style={styles.deleteBtn} onClick={() => handleDelete(rel.id)}>删除</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {showCreate && (
          <div style={styles.overlay} onClick={() => setShowCreate(false)}>
            <div style={styles.createModal} onClick={e => e.stopPropagation()}>
              <h4 style={{ margin: '0 0 12px', color: '#e5e7eb' }}>新建关系</h4>
              <select
                style={styles.input}
                value={newRel.from_name}
                onChange={e => setNewRel({ ...newRel, from_name: e.target.value })}
              >
                <option value="">选择源角色</option>
                {characters.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <select
                style={styles.input}
                value={newRel.to_name}
                onChange={e => setNewRel({ ...newRel, to_name: e.target.value })}
              >
                <option value="">选择目标角色</option>
                {characters.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <select
                style={styles.input}
                value={newRel.relation_type}
                onChange={e => setNewRel({ ...newRel, relation_type: e.target.value })}
              >
                {PRESET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={styles.strengthSelect}>
                {STRENGTH_OPTIONS.map(s => (
                  <button
                    key={s.value}
                    style={{
                      ...styles.strengthBtn,
                      background: newRel.strength === s.value ? s.color : 'transparent',
                      color: newRel.strength === s.value ? '#fff' : s.color,
                      borderColor: s.color,
                    }}
                    onClick={() => setNewRel({ ...newRel, strength: s.value })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <textarea
                style={{ ...styles.input, minHeight: 60 }}
                placeholder="关系描述（可选）"
                value={newRel.description}
                onChange={e => setNewRel({ ...newRel, description: e.target.value })}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button style={styles.cancelBtn} onClick={() => setShowCreate(false)}>取消</button>
                <button
                  style={styles.confirmBtn}
                  onClick={handleCreate}
                  disabled={!newRel.from_name || !newRel.to_name}
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200,
  },
  modal: {
    background: '#111827', borderRadius: 12, width: 600, maxWidth: '90vw',
    maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    border: '1px solid #1f2937',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #1f2937',
  },
  closeBtn: { cursor: 'pointer', fontSize: 20, color: '#6b7280' },
  addBtn: {
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  },
  body: { flex: 1, padding: '12px 20px', overflow: 'auto' },
  loading: { color: '#6b7280', textAlign: 'center', padding: 40 },
  empty: { color: '#4b5563', textAlign: 'center', padding: 40, fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: {
    background: '#1f2937', borderRadius: 8, padding: 10,
    border: '1px solid #374151',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8 },
  charName: { fontSize: 13, fontWeight: 600, color: '#e5e7eb' },
  arrow: { color: '#6b7280' },
  relType: {
    fontSize: 11, color: '#14b8a6', background: '#0d3331',
    padding: '2px 6px', borderRadius: 4,
  },
  strength: { fontSize: 11, fontWeight: 600 },
  description: { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  deleteBtn: {
    background: 'transparent', border: 'none', color: '#ef4444',
    fontSize: 11, cursor: 'pointer', marginTop: 6, padding: 0,
  },
  createModal: {
    background: '#111827', borderRadius: 12, padding: 20, width: 360,
    border: '1px solid #1f2937',
  },
  input: {
    width: '100%', background: '#1f2937', border: '1px solid #374151',
    borderRadius: 6, padding: '8px 10px', color: '#e5e7eb', fontSize: 13,
    outline: 'none', marginBottom: 8, boxSizing: 'border-box',
  },
  strengthSelect: { display: 'flex', gap: 8, marginBottom: 8 },
  strengthBtn: {
    flex: 1, padding: '6px 12px', borderRadius: 6, border: '1px solid',
    fontSize: 12, cursor: 'pointer', background: 'transparent',
  },
  cancelBtn: {
    background: '#1f2937', color: '#d1d5db', border: '1px solid #374151',
    borderRadius: 6, padding: '6px 16px', cursor: 'pointer',
  },
  confirmBtn: {
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '6px 16px', cursor: 'pointer',
  },
}
