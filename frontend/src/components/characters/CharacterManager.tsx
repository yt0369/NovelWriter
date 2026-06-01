import { useState, useEffect, useMemo } from 'react'
import { WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'
import { EntityVersionHistory } from '../common/EntityVersionHistory'
import { CharacterProfileView } from './CharacterProfileView'
import { RelationshipManager } from './RelationshipManager'

interface Character {
  id: string; name: string; aliases: string; role: string;
  profile_data: Record<string, any>; file_path: string;
  created_at: number; last_modified: number
}

interface CharacterStateHistory {
  id: string
  character_id: string
  character_name: string
  source_file_path?: string
  chapter_index?: number
  state_summary?: string
  location?: string
  goal?: string
  emotion?: string
  health?: string
  abilities?: string
  relationships?: string
  evidence?: string
  confidence?: number
  created_at: number
}

interface Props { projectId: string; onClose: () => void }

// 角色档案分类
const PROFILE_CATEGORIES = [
  { key: 'current_state', label: '状态', icon: '⚡', color: '#38bdf8' },
  { key: 'location', label: '位置', icon: '📍', color: '#f59e0b' },
  { key: 'goal', label: '目标', icon: '🎯', color: '#f59e0b' },
  { key: 'health', label: '身体', icon: '💪', color: '#34d399' },
  { key: 'emotion', label: '情绪', icon: '💗', color: '#f472b6' },
  { key: 'abilities', label: '技能', icon: '✨', color: '#a78bfa' },
  { key: 'relationships', label: '关系', icon: '🤝', color: '#f472b6' },
  { key: 'background', label: '背景', icon: '📖', color: '#60a5fa' },
  { key: 'appearance', label: '外貌', icon: '👤', color: '#c084fc' },
  { key: 'personality', label: '性格', icon: '🧠', color: '#c084fc' },
]

export function CharacterManager({ projectId, onClose }: Props) {
  const [characters, setCharacters] = useState<Character[]>([])
  const [selected, setSelected] = useState<Character | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Character>>({})
  const [stateHistory, setStateHistory] = useState<CharacterStateHistory[]>([])
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [showProfileView, setShowProfileView] = useState(false)
  const [showRelationshipManager, setShowRelationshipManager] = useState(false)
  const [detailTab, setDetailTab] = useState<'info' | 'profile' | 'history'>('info')

  const fetchCharacters = async () => {
    const res = await fetch(`/api/characters/${projectId}`)
    const data = await res.json()
    setCharacters(Array.isArray(data) ? data : [])
  }

  useEffect(() => { fetchCharacters() }, [projectId])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (!detail?.sections || detail.sections.some(section => ['characters', 'knowledge'].includes(section))) {
        fetchCharacters()
        if (selected?.id) fetchStateHistory(selected.id)
      }
    }
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
  }, [projectId, selected?.id])

  const fetchStateHistory = async (characterId: string) => {
    const res = await fetch(`/api/characters/${projectId}/${characterId}/states?limit=20`)
    const data = await res.json()
    setStateHistory(Array.isArray(data) ? data : [])
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    await fetch(`/api/characters/${projectId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, role: newRole }),
    })
    setNewName(''); setNewRole(''); setShowCreate(false)
    fetchCharacters()
  }

  const handleSave = async () => {
    if (!selected) return
    await fetch(`/api/characters/${projectId}/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    setEditing(false)
    fetchCharacters()
    const res = await fetch(`/api/characters/${projectId}/${selected.id}`)
    setSelected(await res.json())
    fetchStateHistory(selected.id)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此角色？')) return
    await fetch(`/api/characters/${projectId}/${id}`, { method: 'DELETE' })
    setSelected(null)
    setStateHistory([])
    fetchCharacters()
  }

  const selectCharacter = async (c: Character) => {
    const res = await fetch(`/api/characters/${projectId}/${c.id}`)
    setSelected(await res.json())
    fetchStateHistory(c.id)
    setEditing(false)
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>角色档案</h2>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, color: '#6b7280' }}>&times;</span>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 左侧列表 */}
          <div style={styles.listPanel}>
            <button style={styles.addBtn} onClick={() => setShowCreate(true)}>+ 新角色</button>
            {showCreate && (
              <div style={styles.createCard}>
                <input style={styles.input} value={newName} onChange={e => setNewName(e.target.value)} placeholder="角色名" autoFocus />
                <input style={styles.input} value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="身份/角色" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={styles.saveBtn} onClick={handleCreate}>创建</button>
                  <button style={styles.cancelBtn} onClick={() => setShowCreate(false)}>取消</button>
                </div>
              </div>
            )}
            {characters.map(c => (
              <div key={c.id}
                style={{ ...styles.listItem, background: selected?.id === c.id ? '#1f2937' : 'transparent' }}
                onClick={() => selectCharacter(c)}>
                <div style={styles.charName}>{c.name}</div>
                {c.role && <div style={styles.charRole}>{c.role}</div>}
              </div>
            ))}
          </div>

          {/* 右侧详情 */}
          <div style={styles.detailPanel}>
            {selected ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, color: '#e5e7eb' }}>{selected.name}</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!editing && <button style={styles.editBtn} onClick={() => { setEditing(true); setEditForm(selected) }}>编辑</button>}
                    <button style={styles.deleteBtn} onClick={() => handleDelete(selected.id)}>删除</button>
                  </div>
                </div>

                {editing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Field label="名称" value={editForm.name || ''} onChange={v => setEditForm({ ...editForm, name: v })} />
                    <Field label="别名" value={editForm.aliases || ''} onChange={v => setEditForm({ ...editForm, aliases: v })} />
                    <Field label="身份/角色" value={editForm.role || ''} onChange={v => setEditForm({ ...editForm, role: v })} />
                    <Field label="关联文件" value={editForm.file_path || ''} onChange={v => setEditForm({ ...editForm, file_path: v })} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button style={styles.saveBtn} onClick={handleSave}>保存</button>
                      <button style={styles.cancelBtn} onClick={() => setEditing(false)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* 标签页 */}
                    <div style={styles.detailTabs}>
                      {([['info', '基本信息'], ['profile', '档案'], ['history', '状态历史']] as [typeof detailTab, string][]).map(([tab, label]) => (
                        <button
                          key={tab}
                          style={detailTab === tab ? styles.detailTabActive : styles.detailTab}
                          onClick={() => setDetailTab(tab)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {detailTab === 'info' && (
                      <div>
                        <InfoRow label="别名" value={selected.aliases || '-'} />
                        <InfoRow label="身份" value={selected.role || '-'} />
                        <InfoRow label="关联文件" value={selected.file_path || '-'} />
                        <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280' }}>
                          创建: {new Date(selected.created_at * 1000).toLocaleString()}
                          {' | '}更新: {new Date(selected.last_modified * 1000).toLocaleString()}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button style={styles.versionBtn} onClick={() => setShowVersionHistory(true)}>
                            📋 版本历史
                          </button>
                          <button style={styles.versionBtn} onClick={() => setShowProfileView(true)}>
                            📊 分类档案
                          </button>
                          <button style={styles.versionBtn} onClick={() => setShowRelationshipManager(true)}>
                            🤝 关系管理
                          </button>
                        </div>
                      </div>
                    )}

                    {detailTab === 'profile' && (
                      <ProfileDataView profileData={selected.profile_data} />
                    )}

                    {detailTab === 'history' && (
                      <StateHistoryList items={stateHistory} />
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#6b7280', textAlign: 'center', marginTop: 60 }}>选择一个角色查看详情</div>
            )}
          </div>
        </div>
      </div>

      {/* 版本历史弹窗 */}
      {showVersionHistory && selected && (
        <EntityVersionHistory
          entityType="character"
          entityId={selected.id}
          entityName={selected.name}
          onClose={() => setShowVersionHistory(false)}
        />
      )}

      {/* 分类档案弹窗 */}
      {showProfileView && selected && (
        <CharacterProfileView
          projectId={projectId}
          characterId={selected.id}
          visible={showProfileView}
          onClose={() => setShowProfileView(false)}
        />
      )}

      {/* 关系管理弹窗 */}
      {showRelationshipManager && (
        <RelationshipManager
          projectId={projectId}
          visible={showRelationshipManager}
          onClose={() => setShowRelationshipManager(false)}
        />
      )}
    </div>
  )
}

function StateHistoryList({ items }: { items: CharacterStateHistory[] }) {
  return (
    <div style={styles.stateBox}>
      <div style={styles.stateHeader}>
        <span>状态历史</span>
        <span>{items.length ? `最近 ${items.length} 条` : '暂无记录'}</span>
      </div>
      {items.length ? items.slice(0, 6).map(item => (
        <div key={item.id} style={styles.stateItem}>
          <div style={styles.stateTitle}>
            <span>{item.chapter_index ? `第${item.chapter_index}章` : '未绑定章节'}</span>
            {typeof item.confidence === 'number' && <span>置信度 {Math.round(item.confidence * 100)}%</span>}
          </div>
          <div style={styles.stateSummary}>{item.state_summary || '无状态摘要'}</div>
          {(item.location || item.goal || item.health) && (
            <div style={styles.stateMeta}>
              {[item.location && `位置：${item.location}`, item.goal && `目标：${item.goal}`, item.health && `身体：${item.health}`].filter(Boolean).join(' · ')}
            </div>
          )}
          {item.evidence && <div style={styles.stateEvidence}>证据：{item.evidence}</div>}
          {item.source_file_path && <div style={styles.stateSource}>{item.source_file_path}</div>}
        </div>
      )) : (
        <div style={styles.stateEmpty}>批准角色状态候选后，这里会记录每章的人物状态变化。</div>
      )}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' }}>{label}</label>
      <input style={styles.input} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function ProfileDataView({ profileData }: { profileData: Record<string, any> | undefined }) {
  if (!profileData || Object.keys(profileData).length === 0) {
    return <div style={{ color: '#6b7280', fontSize: 12, padding: '12px 0' }}>暂无档案数据</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {PROFILE_CATEGORIES.map(cat => {
        const value = profileData[cat.key]
        if (!value) return null
        return (
          <div key={cat.key} style={styles.profileCard}>
            <div style={styles.profileCardHeader}>
              <span style={styles.profileCardIcon}>{cat.icon}</span>
              <span style={styles.profileCardLabel}>{cat.label}</span>
            </div>
            <div style={styles.profileCardContent}>
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </div>
          </div>
        )
      })}
      {/* 显示未分类的字段 */}
      {Object.entries(profileData).filter(([key]) => !PROFILE_CATEGORIES.some(c => c.key === key)).map(([key, value]) => (
        <div key={key} style={styles.profileCard}>
          <div style={styles.profileCardHeader}>
            <span style={styles.profileCardIcon}>📋</span>
            <span style={styles.profileCardLabel}>{key}</span>
          </div>
          <div style={styles.profileCardContent}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </div>
        </div>
      ))}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 13 }}>
      <span style={{ color: '#6b7280', minWidth: 60 }}>{label}</span>
      <span style={{ color: '#e5e7eb' }}>{value}</span>
    </div>
  )
}

function textValue(value: unknown) {
  if (!value) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modal: { background: '#111827', borderRadius: 16, width: 700, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid #1f2937' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #1f2937' },
  listPanel: { width: 200, borderRight: '1px solid #1f2937', overflow: 'auto', padding: 12, flexShrink: 0 },
  detailPanel: { flex: 1, overflow: 'auto', padding: 20 },
  addBtn: { background: '#14b8a6', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, cursor: 'pointer', marginBottom: 12, width: '100%' },
  createCard: { background: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: 6 },
  input: { width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '8px 10px', color: '#e5e7eb', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  listItem: { padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4 },
  charName: { fontSize: 13, fontWeight: 600, color: '#e5e7eb' },
  charRole: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  stateBox: { marginTop: 14, background: '#1f2937', border: '1px solid #1f2937', borderRadius: 8, padding: 10 },
  stateHeader: { display: 'flex', justifyContent: 'space-between', gap: 8, color: '#93c5fd', fontSize: 12, fontWeight: 700, marginBottom: 8 },
  stateItem: { display: 'flex', flexDirection: 'column', gap: 4, background: '#1f2937', border: '1px solid #374151', borderRadius: 7, padding: 8, marginTop: 6 },
  stateTitle: { display: 'flex', justifyContent: 'space-between', gap: 8, color: '#93c5fd', fontSize: 11, fontWeight: 700 },
  stateSummary: { color: '#e5e7eb', fontSize: 12, lineHeight: 1.45 },
  stateMeta: { color: '#cbd5e1', fontSize: 11, lineHeight: 1.4 },
  stateEvidence: { color: '#fbbf24', fontSize: 11, lineHeight: 1.4 },
  stateSource: { color: '#6b7280', fontSize: 10 },
  stateEmpty: { color: '#6b7280', fontSize: 11, lineHeight: 1.45 },
  editBtn: { background: 'transparent', border: '1px solid #374151', borderRadius: 4, padding: '4px 12px', color: '#14b8a6', fontSize: 12, cursor: 'pointer' },
  deleteBtn: { background: 'transparent', border: '1px solid #374151', borderRadius: 4, padding: '4px 12px', color: '#dc2626', fontSize: 12, cursor: 'pointer' },
  saveBtn: { background: '#14b8a6', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontSize: 12, cursor: 'pointer' },
  cancelBtn: { background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '6px 14px', color: '#d1d5db', fontSize: 12, cursor: 'pointer' },
  versionBtn: {
    background: 'transparent', border: '1px solid #374151', borderRadius: 6,
    padding: '6px 12px', color: '#9ca3af', fontSize: 12, cursor: 'pointer',
  },
  detailTabs: {
    display: 'flex', gap: 2, marginBottom: 12, borderBottom: '1px solid #374151',
    paddingBottom: 8,
  },
  detailTab: {
    padding: '4px 10px', background: 'transparent', border: 'none',
    color: '#6b7280', fontSize: 12, cursor: 'pointer', borderRadius: 4,
  },
  detailTabActive: {
    padding: '4px 10px', background: '#1f2937', border: 'none',
    color: '#14b8a6', fontSize: 12, cursor: 'pointer', borderRadius: 4, fontWeight: 600,
  },
  profileCard: {
    background: '#1f2937', borderRadius: 8, padding: '8px 12px',
    border: '1px solid #374151',
  },
  profileCardHeader: {
    display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
  },
  profileCardIcon: { fontSize: 12 },
  profileCardLabel: { fontSize: 11, color: '#9ca3af', fontWeight: 600 },
  profileCardContent: { fontSize: 12, color: '#e5e7eb', lineHeight: 1.5 },
}
