import { useState, useEffect, useMemo } from 'react'
import { useUsageStatsStore } from '../../stores/usageStatsStore'

interface Props {
  visible: boolean
  onClose: () => void
}

export function UsageStatsPanel({ visible, onClose }: Props) {
  const { stats, loading, days, fetchStats, setDays } = useUsageStatsStore()
  const [viewMode, setViewMode] = useState<'day' | 'model' | 'type'>('day')

  useEffect(() => {
    if (visible) fetchStats()
  }, [visible])

  const totalTokens = useMemo(() => {
    return stats.reduce((sum, s) => sum + s.total_tokens, 0)
  }, [stats])

  const byDay = useMemo(() => {
    const result: Record<string, number> = {}
    for (const s of stats) {
      result[s.date] = (result[s.date] || 0) + s.total_tokens
    }
    return Object.entries(result).sort((a, b) => a[0].localeCompare(b[0]))
  }, [stats])

  const byModel = useMemo(() => {
    const result: Record<string, number> = {}
    for (const s of stats) {
      result[s.model] = (result[s.model] || 0) + s.total_tokens
    }
    return Object.entries(result).sort((a, b) => b[1] - a[1])
  }, [stats])

  const byType = useMemo(() => {
    const result: Record<string, number> = {}
    for (const s of stats) {
      result[s.task_type] = (result[s.task_type] || 0) + s.total_tokens
    }
    return Object.entries(result).sort((a, b) => b[1] - a[1])
  }, [stats])

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toString()
  }

  const maxTokens = useMemo(() => {
    const data = viewMode === 'day' ? byDay : viewMode === 'model' ? byModel : byType
    return Math.max(...data.map(([, v]) => v), 1)
  }, [viewMode, byDay, byModel, byType])

  if (!visible) return null

  const data = viewMode === 'day' ? byDay : viewMode === 'model' ? byModel : byType

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: 16 }}>使用统计</h3>
          <span style={styles.closeBtn} onClick={onClose}>&times;</span>
        </div>

        <div style={styles.toolbar}>
          <div style={styles.tabs}>
            {([['day', '按天'], ['model', '按模型'], ['type', '按类型']] as [typeof viewMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                style={viewMode === mode ? styles.tabActive : styles.tab}
                onClick={() => setViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            style={styles.select}
            value={days}
            onChange={e => { setDays(Number(e.target.value)); fetchStats(Number(e.target.value)) }}
          >
            <option value={7}>7天</option>
            <option value={30}>30天</option>
            <option value={90}>90天</option>
          </select>
        </div>

        <div style={styles.body}>
          <div style={styles.totalCard}>
            <div style={styles.totalLabel}>总 Token 使用量</div>
            <div style={styles.totalValue}>{formatTokens(totalTokens)}</div>
          </div>

          {loading ? (
            <div style={styles.loading}>加载中...</div>
          ) : (
            <div style={styles.chart}>
              {data.map(([key, value]) => (
                <div key={key} style={styles.barRow}>
                  <div style={styles.barLabel}>{key}</div>
                  <div style={styles.barTrack}>
                    <div
                      style={{
                        ...styles.barFill,
                        width: `${(value / maxTokens) * 100}%`,
                      }}
                    />
                  </div>
                  <div style={styles.barValue}>{formatTokens(value)}</div>
                </div>
              ))}
              {data.length === 0 && (
                <div style={styles.empty}>暂无数据</div>
              )}
            </div>
          )}
        </div>
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
    background: '#111827', borderRadius: 12, width: 500, maxWidth: '90vw',
    maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    border: '1px solid #1f2937',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #1f2937',
  },
  closeBtn: { cursor: 'pointer', fontSize: 20, color: '#6b7280' },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 20px', borderBottom: '1px solid #1f2937',
  },
  tabs: { display: 'flex', gap: 2 },
  tab: {
    padding: '4px 10px', background: 'transparent', border: 'none',
    color: '#6b7280', fontSize: 12, cursor: 'pointer', borderRadius: 4,
  },
  tabActive: {
    padding: '4px 10px', background: '#1f2937', border: 'none',
    color: '#14b8a6', fontSize: 12, cursor: 'pointer', borderRadius: 4, fontWeight: 600,
  },
  select: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    padding: '4px 8px', color: '#e5e7eb', fontSize: 12, outline: 'none',
  },
  body: { flex: 1, padding: '16px 20px', overflow: 'auto' },
  totalCard: {
    background: '#1f2937', borderRadius: 8, padding: '12px 16px',
    border: '1px solid #374151', marginBottom: 16, textAlign: 'center',
  },
  totalLabel: { fontSize: 12, color: '#9ca3af', marginBottom: 4 },
  totalValue: { fontSize: 28, fontWeight: 700, color: '#14b8a6' },
  loading: { color: '#6b7280', textAlign: 'center', padding: 20 },
  empty: { color: '#4b5563', textAlign: 'center', padding: 20, fontSize: 13 },
  chart: { display: 'flex', flexDirection: 'column', gap: 8 },
  barRow: { display: 'flex', alignItems: 'center', gap: 8 },
  barLabel: { fontSize: 12, color: '#d1d5db', minWidth: 80, textAlign: 'right' },
  barTrack: {
    flex: 1, height: 16, background: '#1f2937', borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%', background: '#14b8a6', borderRadius: 4,
    transition: 'width 0.3s',
  },
  barValue: { fontSize: 11, color: '#6b7280', minWidth: 50 },
}
