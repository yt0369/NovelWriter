import { useState, useEffect, useMemo, useCallback } from 'react'
import { OutlineNode } from './OutlineNode'

interface Props {
  projectId: string
}

interface TimelineData {
  volumes: any[]
  chapters: any[]
  events: any[]
}

interface TreeNode {
  id: string
  name: string
  type: 'volume' | 'chapter' | 'event'
  children?: TreeNode[]
  status?: string
  summary?: string
  file_path?: string
  day?: number
  hour?: number
  description?: string
  story_line_id?: string
}

type ViewMode = 'tree' | 'timeline' | 'stats'

export function OutlineViewer({ projectId }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [showCreateEvent, setShowCreateEvent] = useState(false)
  const [createEventChapter, setCreateEventChapter] = useState<string>('')
  const [newEventName, setNewEventName] = useState('')
  const [newEventDesc, setNewEventDesc] = useState('')
  const [newEventDay, setNewEventDay] = useState<number>(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)

  const fetchTimeline = useCallback(async () => {
    try {
      const [volRes, chapRes, evtRes] = await Promise.all([
        fetch(`/api/timeline/${projectId}/volumes`),
        fetch(`/api/timeline/${projectId}/chapters`),
        fetch(`/api/timeline/${projectId}/events`),
      ])
      const volumes = volRes.ok ? await volRes.json() : []
      const chapters = chapRes.ok ? await chapRes.json() : []
      const events = evtRes.ok ? await evtRes.json() : []

      // Build tree
      const chapterMap = new Map<string, TreeNode[]>()
      for (const ch of chapters) {
        const volId = ch.volume_id || '__root__'
        if (!chapterMap.has(volId)) chapterMap.set(volId, [])
        chapterMap.get(volId)!.push({
          id: ch.id, name: ch.name, type: 'chapter',
          status: ch.summary ? 'completed' : 'planned',
          file_path: ch.file_path, summary: ch.summary,
        })
      }

      const eventMap = new Map<string, TreeNode[]>()
      for (const evt of events) {
        const chId = evt.chapter_id || '__root__'
        if (!eventMap.has(chId)) eventMap.set(chId, [])
        eventMap.get(chId)!.push({
          id: evt.id, name: evt.name, type: 'event',
          status: evt.status || 'planned',
          day: evt.day, hour: evt.hour,
          description: evt.description,
          story_line_id: evt.story_line_id,
        })
      }

      // Attach events to chapters
      for (const [, chNodes] of chapterMap) {
        for (const ch of chNodes) {
          const evts = eventMap.get(ch.id)
          if (evts?.length) ch.children = evts
        }
      }

      // Build volume nodes
      const treeNodes: TreeNode[] = volumes.map((v: any) => ({
        id: v.id, name: v.name, type: 'volume' as const,
        children: chapterMap.get(v.id) || [],
      }))

      // Add orphan chapters (no volume)
      const orphans = chapterMap.get('__root__')
      if (orphans?.length) {
        treeNodes.push({ id: '__root__', name: '未分卷章节', type: 'volume', children: orphans })
      }

      setTree(treeNodes)
    } catch {
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchTimeline() }, [fetchTimeline])

  const handleNodeClick = (node: TreeNode) => {
    setSelectedNode(node)
    if (node.type === 'chapter' && node.file_path) {
      window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: { type: 'file', path: node.file_path } }))
    }
  }

  const handleCreateEvent = async () => {
    if (!newEventName.trim() || !createEventChapter) return
    try {
      await fetch(`/api/timeline/${projectId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newEventName,
          description: newEventDesc,
          chapter_id: createEventChapter,
          day: newEventDay,
        }),
      })
      setNewEventName('')
      setNewEventDesc('')
      setNewEventDay(0)
      setShowCreateEvent(false)
      fetchTimeline()
    } catch {}
  }

  // 统计数据
  const stats = useMemo(() => {
    let totalVolumes = 0
    let totalChapters = 0
    let totalEvents = 0
    let completedChapters = 0
    let plannedEvents = 0
    let completedEvents = 0

    for (const vol of tree) {
      totalVolumes++
      for (const ch of (vol.children || [])) {
        totalChapters++
        if (ch.status === 'completed') completedChapters++
        for (const evt of (ch.children || [])) {
          totalEvents++
          if (evt.status === 'completed') completedEvents++
          else plannedEvents++
        }
      }
    }

    return { totalVolumes, totalChapters, totalEvents, completedChapters, plannedEvents, completedEvents }
  }, [tree])

  // 搜索过滤
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree
    const q = searchQuery.toLowerCase()
    const filterNode = (node: TreeNode): TreeNode | null => {
      const nameMatch = node.name.toLowerCase().includes(q)
      const descMatch = node.description?.toLowerCase().includes(q)
      const filteredChildren = (node.children || []).map(filterNode).filter(Boolean) as TreeNode[]
      if (nameMatch || descMatch || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children }
      }
      return null
    }
    return tree.map(filterNode).filter(Boolean) as TreeNode[]
  }, [tree, searchQuery])

  // 获取所有章节（用于事件创建表单）
  const allChapters = useMemo(() => {
    const chapters: { id: string; name: string; volumeId: string }[] = []
    for (const vol of tree) {
      for (const ch of (vol.children || [])) {
        if (ch.type === 'chapter') {
          chapters.push({ id: ch.id, name: ch.name, volumeId: vol.id })
        }
      }
    }
    return chapters
  }, [tree])

  if (loading) return <div style={styles.loading}>加载中...</div>

  return (
    <div style={styles.container}>
      {/* 头部工具栏 */}
      <div style={styles.toolbar}>
        <div style={styles.viewTabs}>
          {([['tree', '树形'], ['timeline', '时间线'], ['stats', '统计']] as [ViewMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              style={viewMode === mode ? styles.tabActive : styles.tab}
              onClick={() => setViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <button style={styles.addBtn} onClick={() => setShowCreateEvent(true)}>
          + 事件
        </button>
      </div>

      {/* 搜索栏 */}
      <div style={styles.searchBar}>
        <input
          style={styles.searchInput}
          placeholder="搜索章节/事件..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 统计概览 */}
      <div style={styles.statsRow}>
        <span style={styles.statItem}>📁 {stats.totalVolumes}卷</span>
        <span style={styles.statItem}>📄 {stats.totalChapters}章</span>
        <span style={styles.statItem}>📌 {stats.totalEvents}事件</span>
        <span style={styles.statItem}>✅ {stats.completedChapters}已完成</span>
      </div>

      {/* 主内容区 */}
      <div style={styles.content}>
        {viewMode === 'tree' && (
          <div style={styles.tree}>
            {filteredTree.length === 0 ? (
              <div style={styles.empty}>暂无大纲数据</div>
            ) : (
              filteredTree.map(node => (
                <OutlineNode key={node.id} node={node} level={0} onNodeClick={handleNodeClick} />
              ))
            )}
          </div>
        )}

        {viewMode === 'timeline' && (
          <TimelineView tree={tree} projectId={projectId} onUpdated={fetchTimeline} />
        )}

        {viewMode === 'stats' && (
          <StatsView stats={stats} tree={tree} />
        )}
      </div>

      {/* 选中节点详情 */}
      {selectedNode && (
        <div style={styles.detailPanel}>
          <div style={styles.detailHeader}>
            <span style={styles.detailTitle}>{selectedNode.name}</span>
            <span style={styles.detailClose} onClick={() => setSelectedNode(null)}>&times;</span>
          </div>
          <div style={styles.detailBody}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>类型</span>
              <span style={styles.detailValue}>
                {selectedNode.type === 'volume' ? '卷' : selectedNode.type === 'chapter' ? '章节' : '事件'}
              </span>
            </div>
            {selectedNode.status && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>状态</span>
                <span style={{ ...styles.detailValue, color: selectedNode.status === 'completed' ? '#14b8a6' : '#f59e0b' }}>
                  {selectedNode.status === 'completed' ? '已完成' : '计划中'}
                </span>
              </div>
            )}
            {selectedNode.day !== undefined && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>时间</span>
                <span style={styles.detailValue}>第{selectedNode.day}天 {selectedNode.hour !== undefined ? `${selectedNode.hour}时` : ''}</span>
              </div>
            )}
            {selectedNode.summary && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>摘要</span>
                <span style={styles.detailValue}>{selectedNode.summary}</span>
              </div>
            )}
            {selectedNode.description && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>描述</span>
                <span style={styles.detailValue}>{selectedNode.description}</span>
              </div>
            )}
            {selectedNode.children && selectedNode.children.length > 0 && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>子项</span>
                <span style={styles.detailValue}>{selectedNode.children.length} 个</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 创建事件弹窗 */}
      {showCreateEvent && (
        <div style={styles.overlay} onClick={() => setShowCreateEvent(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 12px', color: '#e5e7eb' }}>创建事件</h4>
            <select
              style={styles.input}
              value={createEventChapter}
              onChange={e => setCreateEventChapter(e.target.value)}
            >
              <option value="">选择章节</option>
              {allChapters.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
            <input
              style={styles.input}
              placeholder="事件名称"
              value={newEventName}
              onChange={e => setNewEventName(e.target.value)}
              autoFocus
            />
            <textarea
              style={{ ...styles.input, minHeight: 60, resize: 'vertical' }}
              placeholder="事件描述（可选）"
              value={newEventDesc}
              onChange={e => setNewEventDesc(e.target.value)}
            />
            <input
              style={styles.input}
              type="number"
              placeholder="天数"
              value={newEventDay}
              onChange={e => setNewEventDay(Number(e.target.value))}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={styles.cancelBtn} onClick={() => setShowCreateEvent(false)}>取消</button>
              <button style={styles.confirmBtn} onClick={handleCreateEvent} disabled={!newEventName.trim() || !createEventChapter}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 时间线视图 ─────────────────────────────────────────

function TimelineView({ tree, projectId, onUpdated }: { tree: TreeNode[]; projectId: string; onUpdated: () => void }) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'planned' | 'completed'>('all')

  const events = useMemo(() => {
    const allEvents: (TreeNode & { chapterName: string; volumeName: string })[] = []
    for (const vol of tree) {
      for (const ch of (vol.children || [])) {
        for (const evt of (ch.children || [])) {
          allEvents.push({ ...evt, chapterName: ch.name, volumeName: vol.name })
        }
      }
    }
    return allEvents
      .filter(evt => statusFilter === 'all' || (evt.status || 'planned') === statusFilter)
      .sort((a, b) => (a.day || 0) - (b.day || 0) || (a.hour || 0) - (b.hour || 0))
  }, [tree, statusFilter])

  const toggleEventStatus = async (eventId: string, currentStatus?: string) => {
    const nextStatus = currentStatus === 'completed' ? 'planned' : 'completed'
    await fetch(`/api/timeline/${projectId}/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    onUpdated()
  }

  if (events.length === 0) {
    return (
      <div>
        <TimelineFilters value={statusFilter} onChange={setStatusFilter} />
        <div style={styles.empty}>暂无事件数据</div>
      </div>
    )
  }

  return (
    <div>
      <TimelineFilters value={statusFilter} onChange={setStatusFilter} />
      <div style={styles.timeline}>
      {events.map((evt) => (
        <div key={evt.id} style={styles.timelineItem}>
          <div style={styles.timelineDot} />
          <div style={styles.timelineContent}>
            <div style={styles.timelineHeader}>
              <span style={styles.timelineTitle}>{evt.name}</span>
              <div style={styles.timelineActions}>
                {evt.day !== undefined && (
                  <span style={styles.timelineDay}>第{evt.day}天</span>
                )}
                <button
                  style={evt.status === 'completed' ? styles.eventDoneBtn : styles.eventPlanBtn}
                  onClick={() => toggleEventStatus(evt.id, evt.status)}
                >
                  {evt.status === 'completed' ? '已完成' : '计划中'}
                </button>
              </div>
            </div>
            <div style={styles.timelineMeta}>
              <span style={styles.timelineChapter}>{evt.chapterName}</span>
              <span style={styles.timelineVolume}>{evt.volumeName}</span>
            </div>
            {evt.description && (
              <div style={styles.timelineDesc}>{evt.description}</div>
            )}
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

function TimelineFilters({ value, onChange }: { value: 'all' | 'planned' | 'completed'; onChange: (value: 'all' | 'planned' | 'completed') => void }) {
  return (
    <div style={styles.timelineFilters}>
      {([
        ['all', '全部'],
        ['planned', '计划中'],
        ['completed', '已完成'],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          style={value === key ? styles.filterActive : styles.filterBtn}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ─── 统计视图 ─────────────────────────────────────────

function StatsView({ stats, tree }: { stats: any; tree: TreeNode[] }) {
  const completionRate = stats.totalChapters > 0
    ? Math.round((stats.completedChapters / stats.totalChapters) * 100)
    : 0

  const eventRate = stats.totalEvents > 0
    ? Math.round((stats.completedEvents / stats.totalEvents) * 100)
    : 0

  return (
    <div style={styles.statsView}>
      <div style={styles.statsCard}>
        <div style={styles.statsCardTitle}>完成进度</div>
        <div style={styles.statsCardGrid}>
          <div style={styles.statsCardItem}>
            <div style={styles.statsCardValue}>{completionRate}%</div>
            <div style={styles.statsCardLabel}>章节完成率</div>
          </div>
          <div style={styles.statsCardItem}>
            <div style={styles.statsCardValue}>{eventRate}%</div>
            <div style={styles.statsCardLabel}>事件完成率</div>
          </div>
        </div>
      </div>

      <div style={styles.statsCard}>
        <div style={styles.statsCardTitle}>各卷概览</div>
        {tree.map(vol => {
          const chapters = vol.children || []
          const completed = chapters.filter(ch => ch.status === 'completed').length
          const total = chapters.length
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0
          return (
            <div key={vol.id} style={styles.statsVolRow}>
              <div style={styles.statsVolName}>{vol.name}</div>
              <div style={styles.statsVolBar}>
                <div style={{ ...styles.statsVolProgress, width: `${pct}%` }} />
              </div>
              <div style={styles.statsVolCount}>{completed}/{total}</div>
            </div>
          )
        })}
      </div>

      <div style={styles.statsCard}>
        <div style={styles.statsCardTitle}>事件分布</div>
        {tree.map(vol => {
          const events = (vol.children || []).reduce((acc, ch) => acc + (ch.children?.length || 0), 0)
          if (events === 0) return null
          return (
            <div key={vol.id} style={styles.statsVolRow}>
              <div style={styles.statsVolName}>{vol.name}</div>
              <div style={styles.statsVolCount}>{events} 事件</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 样式 ─────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#111827' },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', borderBottom: '1px solid #1f2937',
  },
  viewTabs: { display: 'flex', gap: 2 },
  tab: {
    padding: '4px 10px', background: 'transparent', border: 'none',
    color: '#6b7280', fontSize: 12, cursor: 'pointer', borderRadius: 4,
  },
  tabActive: {
    padding: '4px 10px', background: '#1f2937', border: 'none',
    color: '#14b8a6', fontSize: 12, cursor: 'pointer', borderRadius: 4, fontWeight: 600,
  },
  addBtn: {
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  },
  searchBar: { padding: '8px 12px', borderBottom: '1px solid #1f2937' },
  searchInput: {
    width: '100%', background: '#1f2937', border: '1px solid #374151',
    borderRadius: 6, padding: '6px 10px', color: '#e5e7eb', fontSize: 12,
    outline: 'none', boxSizing: 'border-box',
  },
  statsRow: {
    display: 'flex', gap: 12, padding: '8px 12px', borderBottom: '1px solid #1f2937',
    fontSize: 11, color: '#9ca3af',
  },
  statItem: { display: 'flex', alignItems: 'center', gap: 4 },
  content: { flex: 1, overflow: 'auto' },
  tree: { padding: '4px 0' },
  empty: { color: '#4b5563', fontSize: 13, textAlign: 'center', padding: 40 },
  loading: { padding: 16, color: '#6b7280', fontSize: 13, textAlign: 'center' },

  // 详情面板
  detailPanel: {
    borderTop: '1px solid #1f2937', padding: '10px 12px',
    maxHeight: 200, overflow: 'auto',
  },
  detailHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  detailTitle: { fontSize: 13, fontWeight: 600, color: '#e5e7eb' },
  detailClose: { cursor: 'pointer', fontSize: 16, color: '#6b7280' },
  detailBody: { display: 'flex', flexDirection: 'column', gap: 4 },
  detailRow: { display: 'flex', gap: 8, fontSize: 12 },
  detailLabel: { color: '#6b7280', minWidth: 40 },
  detailValue: { color: '#d1d5db', flex: 1 },

  // 时间线视图
  timeline: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 0 },
  timelineFilters: {
    display: 'flex', gap: 6, padding: '10px 16px 0',
  },
  filterBtn: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    color: '#9ca3af', fontSize: 12, padding: '4px 10px', cursor: 'pointer',
  },
  filterActive: {
    background: '#0d3331', border: '1px solid #14b8a6', borderRadius: 6,
    color: '#14b8a6', fontSize: 12, padding: '4px 10px', cursor: 'pointer',
  },
  timelineItem: { display: 'flex', gap: 12, position: 'relative', paddingBottom: 16 },
  timelineDot: {
    width: 10, height: 10, borderRadius: '50%', background: '#14b8a6',
    marginTop: 4, flexShrink: 0, zIndex: 1,
  },
  timelineContent: {
    flex: 1, background: '#1f2937', borderRadius: 8, padding: '8px 12px',
    border: '1px solid #374151',
  },
  timelineHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  timelineTitle: { fontSize: 13, fontWeight: 600, color: '#e5e7eb' },
  timelineActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  timelineDay: { fontSize: 11, color: '#14b8a6', background: '#0d3331', padding: '1px 6px', borderRadius: 4 },
  eventPlanBtn: {
    background: '#2a2115', border: '1px solid #4a3418', color: '#f59e0b',
    borderRadius: 4, fontSize: 11, padding: '2px 6px', cursor: 'pointer',
  },
  eventDoneBtn: {
    background: '#0d3331', border: '1px solid #145c55', color: '#14b8a6',
    borderRadius: 4, fontSize: 11, padding: '2px 6px', cursor: 'pointer',
  },
  timelineMeta: { display: 'flex', gap: 8, marginTop: 4, fontSize: 11, color: '#6b7280' },
  timelineChapter: {},
  timelineVolume: {},
  timelineDesc: { marginTop: 4, fontSize: 12, color: '#9ca3af', lineHeight: 1.4 },

  // 统计视图
  statsView: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
  statsCard: {
    background: '#1f2937', borderRadius: 8, padding: '12px 16px',
    border: '1px solid #374151',
  },
  statsCardTitle: { fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 10 },
  statsCardGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  statsCardItem: { textAlign: 'center' },
  statsCardValue: { fontSize: 24, fontWeight: 700, color: '#14b8a6' },
  statsCardLabel: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  statsVolRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 0', borderBottom: '1px solid #374151',
  },
  statsVolName: { fontSize: 12, color: '#d1d5db', minWidth: 80 },
  statsVolBar: {
    flex: 1, height: 6, background: '#374151', borderRadius: 3, overflow: 'hidden',
  },
  statsVolProgress: { height: '100%', background: '#14b8a6', borderRadius: 3, transition: 'width 0.3s' },
  statsVolCount: { fontSize: 11, color: '#6b7280', minWidth: 30, textAlign: 'right' },

  // 弹窗
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 150,
  },
  modal: {
    background: '#111827', borderRadius: 12, padding: 20, width: 360,
    border: '1px solid #1f2937',
  },
  input: {
    width: '100%', background: '#1f2937', border: '1px solid #374151',
    borderRadius: 8, padding: '8px 10px', color: '#e5e7eb', fontSize: 13,
    outline: 'none', marginBottom: 8, boxSizing: 'border-box',
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
