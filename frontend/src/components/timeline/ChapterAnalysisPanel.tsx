import { useState, useEffect } from 'react'
import { useChapterAnalysisStore, ForeshadowingItem, ChapterCharacterState, ChapterPlotKeyPoint } from '../../stores/chapterAnalysisStore'

interface Props {
  projectId: string
  visible: boolean
  onClose: () => void
}

type TabType = 'foreshadowing' | 'characters' | 'plotpoints'

const HOOK_ICONS: Record<string, string> = {
  crisis: '⚡',
  mystery: '❓',
  emotion: '💗',
  choice: '⚖',
  desire: '🔥',
}

const HOOK_COLORS: Record<string, string> = {
  crisis: '#f14c4c',
  mystery: '#9cdcfe',
  emotion: '#c586c0',
  choice: '#dcdcaa',
  desire: '#ce9178',
}

export function ChapterAnalysisPanel({ projectId, visible, onClose }: Props) {
  const {
    data, loadProjectAnalyses, getStats,
    deleteForeshadowing, deleteCharacterState, deletePlotKeyPoint,
  } = useChapterAnalysisStore()

  const [activeTab, setActiveTab] = useState<TabType>('foreshadowing')
  const [filterChapter, setFilterChapter] = useState<string>('')

  useEffect(() => {
    if (visible) loadProjectAnalyses(projectId)
  }, [projectId, visible])

  const stats = getStats()

  if (!visible) return null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: 16 }}>章节分析</h3>
          <span style={styles.closeBtn} onClick={onClose}>&times;</span>
        </div>

        {/* 统计卡片 */}
        <div style={styles.statsRow}>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{stats.totalForeshadowing}</div>
            <div style={styles.statLabel}>伏笔</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{stats.unresolvedForeshadowing}</div>
            <div style={styles.statLabel}>未解决</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{stats.totalCharacterStates}</div>
            <div style={styles.statLabel}>角色状态</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{stats.totalPlotKeyPoints}</div>
            <div style={styles.statLabel}>关键点</div>
          </div>
        </div>

        {/* 标签页 */}
        <div style={styles.tabs}>
          {([['foreshadowing', '伏笔'], ['characters', '角色状态'], ['plotpoints', '关键点']] as [TabType, string][]).map(([tab, label]) => (
            <button
              key={tab}
              style={activeTab === tab ? styles.tabActive : styles.tab}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 过滤 */}
        <div style={styles.filterRow}>
          <input
            style={styles.filterInput}
            placeholder="按章节过滤..."
            value={filterChapter}
            onChange={e => setFilterChapter(e.target.value)}
          />
        </div>

        {/* 内容 */}
        <div style={styles.content}>
          {activeTab === 'foreshadowing' && (
            <ForeshadowingList
              items={data.foreshadowing}
              filterChapter={filterChapter}
              onDelete={deleteForeshadowing}
            />
          )}
          {activeTab === 'characters' && (
            <CharacterStateList
              items={data.characterStates}
              filterChapter={filterChapter}
              onDelete={deleteCharacterState}
            />
          )}
          {activeTab === 'plotpoints' && (
            <PlotKeyPointList
              items={data.plotKeyPoints}
              filterChapter={filterChapter}
              onDelete={deletePlotKeyPoint}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 伏笔列表 ─────────────────────────────────────────

function ForeshadowingList({ items, filterChapter, onDelete }: {
  items: ForeshadowingItem[]
  filterChapter: string
  onDelete: (id: string) => void
}) {
  const filtered = filterChapter
    ? items.filter(f => f.sourceRef?.includes(filterChapter))
    : items

  if (filtered.length === 0) {
    return <div style={styles.empty}>暂无伏笔数据</div>
  }

  return (
    <div style={styles.list}>
      {filtered.map(item => (
        <div key={item.id} style={styles.card}>
          <div style={styles.cardHeader}>
            {item.hookType && (
              <span style={{ color: HOOK_COLORS[item.hookType] || '#888' }}>
                {HOOK_ICONS[item.hookType] || '📌'}
              </span>
            )}
            <span style={styles.cardTitle}>{item.content}</span>
            <span style={{
              ...styles.typeBadge,
              background: item.type === 'resolved' ? '#14b8a622' : item.type === 'dangling' ? '#ef444422' : '#f59e0b22',
              color: item.type === 'resolved' ? '#14b8a6' : item.type === 'dangling' ? '#ef4444' : '#f59e0b',
            }}>
              {item.type === 'resolved' ? '已解决' : item.type === 'dangling' ? '悬空' : '已埋'}
            </span>
          </div>
          <div style={styles.cardMeta}>
            {item.sourceRef && <span>章节: {item.sourceRef}</span>}
            {item.hookStrength && <span>强度: {item.hookStrength}</span>}
            {item.rewardScore && <span>奖励: +{item.rewardScore}</span>}
          </div>
          <button style={styles.deleteBtn} onClick={() => onDelete(item.id)}>删除</button>
        </div>
      ))}
    </div>
  )
}

// ─── 角色状态列表 ─────────────────────────────────────

function CharacterStateList({ items, filterChapter, onDelete }: {
  items: ChapterCharacterState[]
  filterChapter: string
  onDelete: (id: string) => void
}) {
  const filtered = filterChapter
    ? items.filter(s => s.chapterRef?.includes(filterChapter))
    : items

  if (filtered.length === 0) {
    return <div style={styles.empty}>暂无角色状态数据</div>
  }

  return (
    <div style={styles.list}>
      {filtered.map(item => (
        <div key={item.id} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.charName}>{item.characterName}</span>
            {item.chapterIndex && <span style={styles.chapterBadge}>第{item.chapterIndex}章</span>}
          </div>
          {item.stateDescription && <div style={styles.cardDesc}>{item.stateDescription}</div>}
          <div style={styles.cardMeta}>
            {item.location && <span>📍 {item.location}</span>}
            {item.emotionalState && <span>💗 {item.emotionalState}</span>}
            {item.goal && <span>🎯 {item.goal}</span>}
          </div>
          {item.confidence && (
            <div style={styles.confidence}>
              置信度: {Math.round(item.confidence * 100)}%
            </div>
          )}
          <button style={styles.deleteBtn} onClick={() => onDelete(item.id)}>删除</button>
        </div>
      ))}
    </div>
  )
}

// ─── 剧情关键点列表 ─────────────────────────────────────

function PlotKeyPointList({ items, filterChapter, onDelete }: {
  items: ChapterPlotKeyPoint[]
  filterChapter: string
  onDelete: (id: string) => void
}) {
  const filtered = filterChapter
    ? items.filter(p => p.chapterRef?.includes(filterChapter))
    : items

  if (filtered.length === 0) {
    return <div style={styles.empty}>暂无剧情关键点</div>
  }

  return (
    <div style={styles.list}>
      {filtered.map(item => (
        <div key={item.id} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardTitle}>{item.description}</span>
            <span style={{
              ...styles.importanceBadge,
              color: item.importance === 'critical' ? '#ef4444' : item.importance === 'high' ? '#f59e0b' : item.importance === 'medium' ? '#3b82f6' : '#6b7280',
            }}>
              {item.importance === 'critical' ? '关键' : item.importance === 'high' ? '重要' : item.importance === 'medium' ? '一般' : '次要'}
            </span>
          </div>
          <div style={styles.cardMeta}>
            {item.chapterRef && <span>章节: {item.chapterRef}</span>}
            {item.tags && item.tags.length > 0 && (
              <span>标签: {item.tags.join(', ')}</span>
            )}
          </div>
          <button style={styles.deleteBtn} onClick={() => onDelete(item.id)}>删除</button>
        </div>
      ))}
    </div>
  )
}

// ─── 样式 ─────────────────────────────────────────────

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
  statsRow: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
    padding: '12px 20px', borderBottom: '1px solid #1f2937',
  },
  statCard: { textAlign: 'center' },
  statValue: { fontSize: 20, fontWeight: 700, color: '#14b8a6' },
  statLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  tabs: {
    display: 'flex', borderBottom: '1px solid #1f2937',
  },
  tab: {
    flex: 1, padding: '8px 0', background: 'transparent', border: 'none',
    color: '#6b7280', fontSize: 12, cursor: 'pointer', borderBottom: '2px solid transparent',
  },
  tabActive: {
    flex: 1, padding: '8px 0', background: 'transparent', border: 'none',
    color: '#14b8a6', fontSize: 12, cursor: 'pointer', borderBottom: '2px solid #14b8a6', fontWeight: 600,
  },
  filterRow: { padding: '8px 20px', borderBottom: '1px solid #1f2937' },
  filterInput: {
    width: '100%', background: '#1f2937', border: '1px solid #374151',
    borderRadius: 6, padding: '6px 10px', color: '#e5e7eb', fontSize: 12,
    outline: 'none', boxSizing: 'border-box',
  },
  content: { flex: 1, overflow: 'auto', padding: '12px 20px' },
  empty: { color: '#4b5563', textAlign: 'center', padding: 40, fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: {
    background: '#1f2937', borderRadius: 8, padding: 10,
    border: '1px solid #374151',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 13, color: '#e5e7eb', flex: 1 },
  cardDesc: { fontSize: 12, color: '#9ca3af', marginBottom: 4 },
  cardMeta: { display: 'flex', gap: 12, fontSize: 11, color: '#6b7280', flexWrap: 'wrap' },
  charName: { fontSize: 13, fontWeight: 600, color: '#e5e7eb' },
  chapterBadge: {
    fontSize: 10, color: '#14b8a6', background: '#0d3331',
    padding: '2px 6px', borderRadius: 4,
  },
  typeBadge: {
    fontSize: 10, padding: '2px 6px', borderRadius: 4,
  },
  importanceBadge: { fontSize: 11, fontWeight: 600 },
  confidence: { fontSize: 10, color: '#9ca3af', marginTop: 4 },
  deleteBtn: {
    background: 'transparent', border: 'none', color: '#ef4444',
    fontSize: 11, cursor: 'pointer', marginTop: 4, padding: 0,
  },
}
