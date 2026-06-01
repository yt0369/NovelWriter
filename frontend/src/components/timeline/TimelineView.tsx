import { useState, useEffect, useMemo } from 'react'
import { WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'

interface Volume { id: string; name: string; description: string; sort_order: number }
interface Chapter { id: string; volume_id: string | null; name: string; summary: string; sort_order: number; file_path: string }
interface StoryLine { id: string; name: string; color: string; is_main: number }
interface TimelineEvent { id: string; chapter_id: string | null; name: string; description: string; day: number | null; hour: number | null; story_line_id: string | null; status: string }

interface Props { projectId: string; onClose: () => void }

export function TimelineView({ projectId, onClose }: Props) {
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [storylines, setStorylines] = useState<StoryLine[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [activeTab, setActiveTab] = useState<'volumes' | 'storylines' | 'events'>('volumes')
  const [editing, setEditing] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list')
  const [collapsedVolumes, setCollapsedVolumes] = useState<Set<string>>(new Set())
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set())

  const fetchAll = async () => {
    const [v, c, s, e] = await Promise.all([
      fetch(`/api/timeline/${projectId}/volumes`).then(r => r.json()),
      fetch(`/api/timeline/${projectId}/chapters`).then(r => r.json()),
      fetch(`/api/timeline/${projectId}/storylines`).then(r => r.json()),
      fetch(`/api/timeline/${projectId}/events`).then(r => r.json()),
    ])
    setVolumes(v); setChapters(c); setStorylines(s); setEvents(e)
  }

  useEffect(() => { fetchAll() }, [projectId])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (!detail?.sections || detail.sections.some(section => ['timeline', 'knowledge', 'files'].includes(section))) fetchAll()
    }
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
  }, [projectId])

  const handleCreate = async (type: string) => {
    const endpoints: Record<string, string> = {
      volumes: `/api/timeline/${projectId}/volumes`,
      chapters: `/api/timeline/${projectId}/chapters`,
      storylines: `/api/timeline/${projectId}/storylines`,
      events: `/api/timeline/${projectId}/events`,
    }
    const defaults: Record<string, any> = {
      volumes: { name: '新卷', sort_order: volumes.length },
      chapters: { name: '新章', sort_order: chapters.length },
      storylines: { name: '新故事线', color: '#14b8a6' },
      events: { name: '新事件', status: 'planned' },
    }
    await fetch(endpoints[type], {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaults[type]),
    })
    fetchAll()
  }

  const handleDelete = async (type: string, id: string) => {
    const endpoints: Record<string, string> = {
      volumes: `/api/timeline/${projectId}/volumes/${id}`,
      chapters: `/api/timeline/${projectId}/chapters/${id}`,
      storylines: `/api/timeline/${projectId}/storylines/${id}`,
      events: `/api/timeline/${projectId}/events/${id}`,
    }
    await fetch(endpoints[type], { method: 'DELETE' })
    fetchAll()
  }

  const handleSave = async (type: string, id: string) => {
    const endpoints: Record<string, string> = {
      volumes: `/api/timeline/${projectId}/volumes/${id}`,
      chapters: `/api/timeline/${projectId}/chapters/${id}`,
      storylines: `/api/timeline/${projectId}/storylines/${id}`,
      events: `/api/timeline/${projectId}/events/${id}`,
    }
    await fetch(endpoints[type], {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    setEditing(null); setEditForm({})
    fetchAll()
  }

  const toggleVolume = (id: string) => {
    setCollapsedVolumes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleChapter = (id: string) => {
    setCollapsedChapters(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const statusColors: Record<string, string> = {
    planned: '#6b7280', ongoing: '#f59e0b', done: '#22c55e',
    planted: '#60a5fa', developing: '#f59e0b', resolved: '#22c55e', expired: '#ef4444',
  }

  const timelineData = useMemo(() => {
    const sortedVolumes = [...volumes].sort((a, b) => a.sort_order - b.sort_order)
    const sortedChapters = [...chapters].sort((a, b) => a.sort_order - b.sort_order)

    const allDays = events.filter(e => e.day != null).map(e => e.day as number)
    const minDay = allDays.length > 0 ? Math.min(...allDays) : 0
    const maxDay = allDays.length > 0 ? Math.max(...allDays) : 10
    const dayRange = Math.max(maxDay - minDay + 1, 1)

    const volumeStructure = sortedVolumes.map(vol => {
      const volChapters = sortedChapters.filter(c => c.volume_id === vol.id)
      return {
        volume: vol,
        chapters: volChapters.map(ch => {
          const chEvents = events.filter(e => e.chapter_id === ch.id)
          return { chapter: ch, events: chEvents }
        }),
      }
    })

    const unassignedChapters = sortedChapters.filter(c => !c.volume_id)
    const unassignedEvents = events.filter(e => !e.chapter_id)

    return {
      sortedVolumes,
      sortedChapters,
      volumeStructure,
      unassignedChapters,
      unassignedEvents,
      minDay,
      maxDay,
      dayRange,
    }
  }, [volumes, chapters, events])

  const renderList = (items: any[], type: string, fields: { key: string; label: string }[]) => (
    <div style={{ padding: 12 }}>
      <button style={styles.addBtn} onClick={() => handleCreate(type)}>+ 新建</button>
      {items.map(item => (
        <div key={item.id} style={styles.itemCard}>
          {editing === item.id ? (
            <div>
              {fields.map(f => (
                <input key={f.key} style={styles.input} placeholder={f.label}
                  value={editForm[f.key] ?? item[f.key] ?? ''}
                  onChange={e => setEditForm({ ...editForm, [f.key]: e.target.value })} />
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button style={styles.saveBtn} onClick={() => handleSave(type, item.id)}>保存</button>
                <button style={styles.cancelBtn} onClick={() => { setEditing(null); setEditForm({}) }}>取消</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={styles.itemName}>{item.name}</div>
                {item.description && <div style={styles.itemDesc}>{item.description}</div>}
                {item.status && (
                  <span style={{ ...styles.statusTag, color: statusColors[item.status] || '#6b7280' }}>{item.status}</span>
                )}
                {item.color && <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: item.color, marginLeft: 8 }} />}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={styles.editBtn} onClick={() => { setEditing(item.id); setEditForm(item) }}>编辑</button>
                <button style={styles.deleteBtn} onClick={() => handleDelete(type, item.id)}>删除</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )

  const renderTimeline = () => {
    const { volumeStructure, unassignedChapters, unassignedEvents, minDay, dayRange } = timelineData
    const colWidth = 40
    const totalWidth = dayRange * colWidth

    const getEventLeft = (day: number | null) => {
      if (day == null) return 0
      return ((day - minDay) / dayRange) * 100
    }

    const getEventWidth = (startDay: number | null, endDay: number | null) => {
      if (startDay == null) return 8
      const end = endDay ?? startDay + 1
      return Math.max(((end - startDay) / dayRange) * 100, 3)
    }

    return (
      <div style={styles.timelineContainer}>
        <div style={styles.timelineScroll}>
          <div style={{ minWidth: Math.max(totalWidth + 200, 600) }}>
            {volumeStructure.map(vs => {
              const isVolCollapsed = collapsedVolumes.has(vs.volume.id)
              return (
                <div key={vs.volume.id}>
                  <div style={styles.volumeRow} onClick={() => toggleVolume(vs.volume.id)}>
                    <span style={styles.collapseIcon}>{isVolCollapsed ? '▶' : '▼'}</span>
                    <span style={styles.volumeName}>{vs.volume.name}</span>
                  </div>
                  {!isVolCollapsed && vs.chapters.map(chData => {
                    const isChCollapsed = collapsedChapters.has(chData.chapter.id)
                    return (
                      <div key={chData.chapter.id}>
                        <div style={styles.chapterRow} onClick={() => toggleChapter(chData.chapter.id)}>
                          <span style={styles.collapseIcon}>{isChCollapsed ? '▶' : '▼'}</span>
                          <span style={styles.chapterName}>{chData.chapter.name}</span>
                          <div style={styles.chapterBar}>
                            <div style={{
                              ...styles.chapterMarker,
                              left: `${getEventLeft(chData.chapter.sort_order)}%`,
                            }} />
                          </div>
                        </div>
                        {!isChCollapsed && storylines.map(sl => {
                          const slEvents = chData.events.filter(e => e.story_line_id === sl.id)
                          if (slEvents.length === 0) return null
                          return (
                            <div key={sl.id} style={styles.storyLineRow}>
                              <span style={{ ...styles.storyLineLabel, color: sl.color }}>{sl.name}</span>
                              <div style={styles.eventBar}>
                                {slEvents.map(ev => (
                                  <div key={ev.id} style={{
                                    ...styles.eventBlock,
                                    left: `${getEventLeft(ev.day)}%`,
                                    width: `${getEventWidth(ev.day, ev.day)}%`,
                                    background: sl.color + '44',
                                    borderLeft: `3px solid ${sl.color}`,
                                  }} title={`${ev.name}${ev.day != null ? ` (第${ev.day}天)` : ''}`}>
                                    <span style={styles.eventText}>{ev.name}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {unassignedChapters.length > 0 && (
              <div>
                <div style={styles.volumeRow}>
                  <span style={styles.volumeName}>未分配章节</span>
                </div>
                {unassignedChapters.map(ch => {
                  const chEvents = events.filter(e => e.chapter_id === ch.id)
                  const isChCollapsed = collapsedChapters.has(ch.id)
                  return (
                    <div key={ch.id}>
                      <div style={styles.chapterRow} onClick={() => toggleChapter(ch.id)}>
                        <span style={styles.collapseIcon}>{isChCollapsed ? '▶' : '▼'}</span>
                        <span style={styles.chapterName}>{ch.name}</span>
                      </div>
                      {!isChCollapsed && storylines.map(sl => {
                        const slEvents = chEvents.filter(e => e.story_line_id === sl.id)
                        if (slEvents.length === 0) return null
                        return (
                          <div key={sl.id} style={styles.storyLineRow}>
                            <span style={{ ...styles.storyLineLabel, color: sl.color }}>{sl.name}</span>
                            <div style={styles.eventBar}>
                              {slEvents.map(ev => (
                                <div key={ev.id} style={{
                                  ...styles.eventBlock,
                                  left: `${getEventLeft(ev.day)}%`,
                                  width: `${getEventWidth(ev.day, ev.day)}%`,
                                  background: sl.color + '44',
                                  borderLeft: `3px solid ${sl.color}`,
                                }} title={`${ev.name}${ev.day != null ? ` (第${ev.day}天)` : ''}`}>
                                  <span style={styles.eventText}>{ev.name}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}

            {unassignedEvents.length > 0 && (
              <div style={styles.storyLineRow}>
                <span style={{ ...styles.storyLineLabel, color: '#6b7280' }}>未分配事件</span>
                <div style={styles.eventBar}>
                  {unassignedEvents.map(ev => (
                    <div key={ev.id} style={{
                      ...styles.eventBlock,
                      left: `${getEventLeft(ev.day)}%`,
                      width: `${getEventWidth(ev.day, ev.day)}%`,
                      background: '#374151',
                      borderLeft: '3px solid #6b7280',
                    }} title={ev.name}>
                      <span style={styles.eventText}>{ev.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>时间线管理</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={styles.viewToggle}>
              <button
                style={viewMode === 'list' ? styles.viewToggleActive : styles.viewToggleBtn}
                onClick={() => setViewMode('list')}
              >
                列表视图
              </button>
              <button
                style={viewMode === 'timeline' ? styles.viewToggleActive : styles.viewToggleBtn}
                onClick={() => setViewMode('timeline')}
              >
                时间线视图
              </button>
            </div>
            <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, color: '#6b7280' }}>&times;</span>
          </div>
        </div>

        {viewMode === 'list' ? (
          <>
            <div style={styles.tabs}>
              {(['volumes', 'storylines', 'events'] as const).map(tab => (
                <button key={tab} style={activeTab === tab ? styles.tabActive : styles.tab}
                  onClick={() => setActiveTab(tab)}>
                  {{ volumes: '卷', storylines: '故事线', events: '事件' }[tab]}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {activeTab === 'volumes' && renderList(volumes, 'volumes', [{ key: 'name', label: '卷名' }, { key: 'description', label: '描述' }])}
              {activeTab === 'storylines' && renderList(storylines, 'storylines', [{ key: 'name', label: '名称' }, { key: 'color', label: '颜色' }])}
              {activeTab === 'events' && renderList(events, 'events', [{ key: 'name', label: '事件' }, { key: 'description', label: '描述' }])}
            </div>
          </>
        ) : (
          renderTimeline()
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modal: { background: '#111827', borderRadius: 16, width: 800, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid #1f2937' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #1f2937' },
  viewToggle: { display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #374151' },
  viewToggleBtn: { background: 'transparent', border: 'none', padding: '4px 12px', color: '#6b7280', fontSize: 12, cursor: 'pointer' },
  viewToggleActive: { background: '#374151', border: 'none', padding: '4px 12px', color: '#e5e7eb', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  tabs: { display: 'flex', borderBottom: '1px solid #1f2937' },
  tab: { flex: 1, padding: '10px 0', background: 'transparent', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActive: { flex: 1, padding: '10px 0', background: 'transparent', border: 'none', color: '#14b8a6', fontSize: 13, cursor: 'pointer', borderBottom: '2px solid #14b8a6', fontWeight: 600 },
  addBtn: { background: '#14b8a6', border: 'none', borderRadius: 8, padding: '8px 16px', color: '#fff', fontSize: 13, cursor: 'pointer', marginBottom: 12 },
  itemCard: { background: '#1f2937', borderRadius: 8, padding: '12px 16px', marginBottom: 8, border: '1px solid #1f2937' },
  itemName: { fontSize: 14, fontWeight: 600, color: '#e5e7eb' },
  itemDesc: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  statusTag: { fontSize: 11, fontWeight: 600, marginTop: 4, display: 'inline-block' },
  input: { width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '8px 10px', color: '#e5e7eb', fontSize: 13, outline: 'none', marginBottom: 6, boxSizing: 'border-box' },
  editBtn: { background: 'transparent', border: '1px solid #374151', borderRadius: 4, padding: '4px 10px', color: '#14b8a6', fontSize: 12, cursor: 'pointer' },
  deleteBtn: { background: 'transparent', border: '1px solid #374151', borderRadius: 4, padding: '4px 10px', color: '#dc2626', fontSize: 12, cursor: 'pointer' },
  saveBtn: { background: '#14b8a6', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontSize: 12, cursor: 'pointer' },
  cancelBtn: { background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '6px 14px', color: '#d1d5db', fontSize: 12, cursor: 'pointer' },
  timelineContainer: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  timelineScroll: { flex: 1, overflow: 'auto', padding: 16 },
  volumeRow: { display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#1f2937', borderRadius: 6, marginBottom: 2, cursor: 'pointer' },
  volumeName: { fontSize: 14, fontWeight: 700, color: '#14b8a6' },
  collapseIcon: { fontSize: 10, color: '#6b7280', marginRight: 8, width: 12 },
  chapterRow: { display: 'flex', alignItems: 'center', padding: '8px 12px 8px 32px', background: '#111827', borderRadius: 4, marginBottom: 2, cursor: 'pointer' },
  chapterName: { fontSize: 13, fontWeight: 600, color: '#e5e7eb', width: 120, flexShrink: 0 },
  chapterBar: { flex: 1, height: 4, background: '#1f2937', borderRadius: 2, position: 'relative', marginLeft: 12 },
  chapterMarker: { position: 'absolute', top: -2, width: 2, height: 8, background: '#14b8a6', borderRadius: 1 },
  storyLineRow: { display: 'flex', alignItems: 'center', padding: '4px 12px 4px 56px', minHeight: 32 },
  storyLineLabel: { fontSize: 11, fontWeight: 600, width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  eventBar: { flex: 1, position: 'relative', height: 24, marginLeft: 8 },
  eventBlock: { position: 'absolute', top: 2, height: 20, borderRadius: 3, display: 'flex', alignItems: 'center', overflow: 'hidden', cursor: 'default' },
  eventText: { fontSize: 10, color: '#e5e7eb', padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
}
