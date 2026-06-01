import { useState, useEffect } from 'react'
import { useAgentMemoryStore, AgentMemory } from '../../stores/agentMemoryStore'

interface Props {
  projectId: string
  visible: boolean
}

const TYPE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  insight: { label: '洞察', color: '#14b8a6', icon: '💡' },
  pattern: { label: '范式', color: '#3b82f6', icon: '📋' },
  correction: { label: '纠正', color: '#f59e0b', icon: '⚠️' },
  workflow: { label: '工作流', color: '#a78bfa', icon: '🔄' },
  preference: { label: '偏好', color: '#f472b6', icon: '❤️' },
}

const IMPORTANCE_COLORS: Record<string, string> = {
  low: '#6b7280',
  medium: '#3b82f6',
  high: '#f59e0b',
  critical: '#ef4444',
}

export function EvolutionMemoryPanel({ projectId, visible }: Props) {
  const { memories, loading, fetchMemories, getStats, filterType, setFilterType } = useAgentMemoryStore()
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (visible) fetchMemories(projectId)
  }, [projectId, visible])

  const stats = getStats()

  const filteredMemories = memories.filter(m => {
    if (filterType && m.type !== filterType) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return m.content.toLowerCase().includes(q) || m.context?.toLowerCase().includes(q)
    }
    return true
  })

  if (!visible) return null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>自进化记忆</span>
        <button style={styles.refreshBtn} onClick={() => fetchMemories(projectId)}>
          {loading ? '...' : '刷新'}
        </button>
      </div>

      {/* 统计 */}
      <div style={styles.stats}>
        {Object.entries(TYPE_LABELS).map(([type, config]) => (
          <button
            key={type}
            style={{
              ...styles.statBtn,
              background: filterType === type ? config.color : 'transparent',
              color: filterType === type ? '#fff' : config.color,
              borderColor: config.color,
            }}
            onClick={() => setFilterType(filterType === type ? null : type)}
          >
            <span>{config.icon}</span>
            <span>{config.label}</span>
            <span style={styles.statCount}>{stats[type] || 0}</span>
          </button>
        ))}
      </div>

      {/* 搜索 */}
      <div style={styles.searchBox}>
        <input
          style={styles.searchInput}
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 记忆列表 */}
      <div style={styles.list}>
        {filteredMemories.length === 0 ? (
          <div style={styles.empty}>暂无记忆数据</div>
        ) : (
          filteredMemories.map(memory => (
            <MemoryCard key={memory.id} memory={memory} />
          ))
        )}
      </div>
    </div>
  )
}

function MemoryCard({ memory }: { memory: AgentMemory }) {
  const typeConfig = TYPE_LABELS[memory.type] || TYPE_LABELS.insight
  const importanceColor = IMPORTANCE_COLORS[memory.importance] || '#6b7280'

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.typeBadge, background: typeConfig.color }}>
          {typeConfig.icon} {typeConfig.label}
        </span>
        <span style={{ ...styles.importanceDot, background: importanceColor }} />
      </div>
      <div style={styles.cardContent}>{memory.content}</div>
      {memory.context && (
        <div style={styles.cardContext}>{memory.context}</div>
      )}
      <div style={styles.cardMeta}>
        <span>访问: {memory.access_count}次</span>
        <span>{new Date(memory.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', borderBottom: '1px solid #1f2937',
  },
  title: { fontSize: 12, fontWeight: 600, color: '#9ca3af' },
  refreshBtn: {
    background: 'transparent', border: '1px solid #374151', borderRadius: 4,
    padding: '2px 8px', color: '#6b7280', fontSize: 11, cursor: 'pointer',
  },
  stats: {
    display: 'flex', gap: 4, padding: '8px 12px', flexWrap: 'wrap',
    borderBottom: '1px solid #1f2937',
  },
  statBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 4, border: '1px solid',
    fontSize: 10, cursor: 'pointer', background: 'transparent',
  },
  statCount: { fontSize: 10, opacity: 0.7 },
  searchBox: { padding: '8px 12px', borderBottom: '1px solid #1f2937' },
  searchInput: {
    width: '100%', background: '#1f2937', border: '1px solid #374151',
    borderRadius: 4, padding: '4px 8px', color: '#e5e7eb', fontSize: 11,
    outline: 'none', boxSizing: 'border-box',
  },
  list: { flex: 1, overflow: 'auto', padding: '4px 0' },
  empty: { color: '#4b5563', textAlign: 'center', padding: 20, fontSize: 12 },
  card: {
    padding: '8px 12px', borderBottom: '1px solid #1f2937',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  typeBadge: {
    fontSize: 10, color: '#fff', padding: '1px 6px', borderRadius: 3,
  },
  importanceDot: { width: 6, height: 6, borderRadius: '50%' },
  cardContent: { fontSize: 12, color: '#e5e7eb', lineHeight: 1.4 },
  cardContext: { fontSize: 10, color: '#6b7280', marginTop: 4 },
  cardMeta: {
    display: 'flex', justifyContent: 'space-between', marginTop: 4,
    fontSize: 10, color: '#4b5563',
  },
}
