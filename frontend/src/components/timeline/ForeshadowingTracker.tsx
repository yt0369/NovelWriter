import { useState, useEffect, useMemo } from 'react'
import { WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'

interface Foreshadowing {
  id: string; name: string; description: string;
  plant_chapter_id: string | null; resolve_chapter_id: string | null;
  status: string; created_at: number
}

interface Chapter {
  id: string; volume_id: string | null; name: string;
  summary: string; sort_order: number; file_path: string
}

interface Props { projectId: string; onClose: () => void }

const STATUSES = [
  { value: 'planted', label: '已埋设', color: '#60a5fa' },
  { value: 'developing', label: '发展中', color: '#f59e0b' },
  { value: 'resolved', label: '已回收', color: '#22c55e' },
  { value: 'expired', label: '已过期', color: '#ef4444' },
]

export function ForeshadowingTracker({ projectId, onClose }: Props) {
  const [items, setItems] = useState<Foreshadowing[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [filter, setFilter] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const fetchItems = async () => {
    const url = filter
      ? `/api/foreshadowing/${projectId}?status=${filter}`
      : `/api/foreshadowing/${projectId}`
    const res = await fetch(url)
    setItems(await res.json())
  }

  const fetchChapters = async () => {
    try {
      const res = await fetch(`/api/timeline/${projectId}/chapters`)
      setChapters(await res.json())
    } catch {}
  }

  useEffect(() => { fetchItems(); fetchChapters() }, [projectId, filter])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (!detail?.sections || detail.sections.some(section => ['foreshadowing', 'knowledge', 'timeline'].includes(section))) {
        fetchItems()
        fetchChapters()
      }
    }
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
  }, [projectId, filter])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await fetch(`/api/foreshadowing/${projectId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, description: newDesc }),
    })
    setNewName(''); setNewDesc(''); setShowCreate(false)
    fetchItems()
  }

  const handleStatusChange = async (id: string, status: string) => {
    await fetch(`/api/foreshadowing/${projectId}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchItems()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/foreshadowing/${projectId}/${id}`, { method: 'DELETE' })
    fetchItems()
  }

  const statusColor = (s: string) => STATUSES.find(st => st.value === s)?.color || '#888'

  const stats = useMemo(() => {
    const planted = items.filter(i => i.status === 'planted').length
    const developing = items.filter(i => i.status === 'developing').length
    const resolved = items.filter(i => i.status === 'resolved').length
    const expired = items.filter(i => i.status === 'expired').length

    const maxSortOrder = chapters.length > 0
      ? Math.max(...chapters.map(c => c.sort_order))
      : 0

    const overdueItems = items.filter(item => {
      if (item.status !== 'planted' && item.status !== 'developing') return false
      if (!item.plant_chapter_id) return false
      const plantChapter = chapters.find(c => c.id === item.plant_chapter_id)
      if (!plantChapter) return false
      const gap = maxSortOrder - plantChapter.sort_order
      return gap > 5
    })

    return {
      total: items.length,
      planted,
      developing,
      resolved,
      expired,
      overdue_warning: overdueItems.length,
      overdueItems,
    }
  }, [items, chapters])

  const flowSteps = [
    { value: 'planted', label: '已埋设', color: '#60a5fa' },
    { value: 'developing', label: '发展中', color: '#f59e0b' },
    { value: 'resolved', label: '已回收', color: '#22c55e' },
    { value: 'expired', label: '已过期', color: '#ef4444' },
  ]

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>伏笔追踪</h2>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, color: '#6b7280' }}>&times;</span>
        </div>

        <div style={styles.statsBar}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{stats.total}</span>
            <span style={styles.statLabel}>总计</span>
          </div>
          <div style={styles.statItem}>
            <span style={{ ...styles.statValue, color: '#60a5fa' }}>{stats.planted}</span>
            <span style={styles.statLabel}>已埋设</span>
          </div>
          <div style={styles.statItem}>
            <span style={{ ...styles.statValue, color: '#f59e0b' }}>{stats.developing}</span>
            <span style={styles.statLabel}>发展中</span>
          </div>
          <div style={styles.statItem}>
            <span style={{ ...styles.statValue, color: '#22c55e' }}>{stats.resolved}</span>
            <span style={styles.statLabel}>已回收</span>
          </div>
          <div style={styles.statItem}>
            <span style={{ ...styles.statValue, color: '#ef4444' }}>{stats.expired}</span>
            <span style={styles.statLabel}>已过期</span>
          </div>
          <div style={styles.statItem}>
            <span style={{ ...styles.statValue, color: stats.overdue_warning > 0 ? '#dc2626' : '#6b7280' }}>{stats.overdue_warning}</span>
            <span style={styles.statLabel}>遗漏预警</span>
          </div>
        </div>

        <div style={styles.flowContainer}>
          {flowSteps.map((step, i) => (
            <div key={step.value} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                ...styles.flowStep,
                borderColor: step.color,
                background: items.some(it => it.status === step.value) ? step.color + '22' : 'transparent',
              }}>
                <span style={{ color: step.color, fontWeight: 600, fontSize: 12 }}>{step.label}</span>
                <span style={{ color: step.color, fontSize: 11, marginLeft: 4 }}>
                  {items.filter(it => it.status === step.value).length}
                </span>
              </div>
              {i < flowSteps.length - 1 && (
                <span style={styles.flowArrow}>→</span>
              )}
            </div>
          ))}
        </div>

        {stats.overdue_warning > 0 && (
          <div style={styles.warningSection}>
            <div style={styles.warningTitle}>遗漏预警</div>
            {stats.overdueItems.map(item => (
              <div key={item.id} style={styles.warningItem}>
                <span style={styles.warningIcon}>⚠</span>
                <span style={styles.warningName}>{item.name}</span>
                <span style={styles.warningStatus}>{item.status === 'planted' ? '已埋设' : '发展中'}</span>
              </div>
            ))}
          </div>
        )}

        <div style={styles.filterBar}>
          <button style={!filter ? styles.filterActive : styles.filter} onClick={() => setFilter(null)}>全部</button>
          {STATUSES.map(s => (
            <button key={s.value} style={filter === s.value ? { ...styles.filterActive, color: s.color } : styles.filter}
              onClick={() => setFilter(s.value)}>{s.label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <button style={styles.addBtn} onClick={() => setShowCreate(true)}>+ 新建伏笔</button>

          {showCreate && (
            <div style={styles.createCard}>
              <input style={styles.input} value={newName} onChange={e => setNewName(e.target.value)} placeholder="伏笔名称" autoFocus />
              <textarea style={{ ...styles.input, minHeight: 60 }} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="描述" />
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={styles.saveBtn} onClick={handleCreate}>创建</button>
                <button style={styles.cancelBtn} onClick={() => setShowCreate(false)}>取消</button>
              </div>
            </div>
          )}

          {items.map(item => {
            const isOverdue = stats.overdueItems.some(oi => oi.id === item.id)
            return (
              <div key={item.id} style={{
                ...styles.itemCard,
                ...(isOverdue ? styles.itemCardOverdue : {}),
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={styles.itemName}>
                      {isOverdue && <span style={{ color: '#ff4444', marginRight: 6 }}>⚠</span>}
                      {item.name}
                    </div>
                    {item.description && <div style={styles.itemDesc}>{item.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={styles.deleteBtn} onClick={() => handleDelete(item.id)}>删除</button>
                  </div>
                </div>
                <div style={styles.statusBar}>
                  {STATUSES.map(s => (
                    <button key={s.value}
                      style={{
                        ...styles.statusBtn,
                        background: item.status === s.value ? s.color + '22' : 'transparent',
                        color: item.status === s.value ? s.color : '#666',
                        borderColor: item.status === s.value ? s.color : '#2a2a3e',
                      }}
                      onClick={() => handleStatusChange(item.id, s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modal: { background: '#111827', borderRadius: 16, width: 640, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid #1f2937' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #1f2937' },
  statsBar: { display: 'flex', gap: 0, padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#1f2937' },
  statItem: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  statValue: { fontSize: 18, fontWeight: 700, color: '#e5e7eb' },
  statLabel: { fontSize: 10, color: '#6b7280' },
  flowContainer: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 16px', borderBottom: '1px solid #1f2937', gap: 4 },
  flowStep: { display: 'flex', alignItems: 'center', padding: '6px 14px', borderRadius: 16, border: '1px solid' },
  flowArrow: { color: '#6b7280', fontSize: 16, margin: '0 4px' },
  warningSection: { padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#2a1a1a' },
  warningTitle: { fontSize: 12, fontWeight: 600, color: '#dc2626', marginBottom: 8 },
  warningItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' },
  warningIcon: { fontSize: 12, color: '#dc2626' },
  warningName: { fontSize: 13, color: '#fca5a5', fontWeight: 600 },
  warningStatus: { fontSize: 11, color: '#6b7280', marginLeft: 'auto' },
  filterBar: { display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid #1f2937' },
  filter: { background: 'transparent', border: '1px solid #1f2937', borderRadius: 16, padding: '4px 12px', color: '#6b7280', fontSize: 12, cursor: 'pointer' },
  filterActive: { background: '#1f2937', border: '1px solid #374151', borderRadius: 16, padding: '4px 12px', color: '#14b8a6', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  addBtn: { background: '#14b8a6', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, cursor: 'pointer', marginBottom: 12 },
  createCard: { background: '#1f2937', borderRadius: 8, padding: 16, marginBottom: 12, border: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: 8 },
  input: { width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '8px 10px', color: '#e5e7eb', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical' as const },
  itemCard: { background: '#1f2937', borderRadius: 8, padding: '12px 16px', marginBottom: 8, border: '1px solid #1f2937' },
  itemCardOverdue: { borderColor: '#dc2626', background: '#2a1a1a' },
  itemName: { fontSize: 14, fontWeight: 600, color: '#e5e7eb' },
  itemDesc: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  statusBar: { display: 'flex', gap: 4, marginTop: 10 },
  statusBtn: { border: '1px solid', borderRadius: 12, padding: '3px 10px', fontSize: 11, cursor: 'pointer', background: 'transparent' },
  deleteBtn: { background: 'transparent', border: '1px solid #374151', borderRadius: 4, padding: '4px 10px', color: '#dc2626', fontSize: 12, cursor: 'pointer' },
  saveBtn: { background: '#14b8a6', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontSize: 12, cursor: 'pointer' },
  cancelBtn: { background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '6px 14px', color: '#d1d5db', fontSize: 12, cursor: 'pointer' },
}
