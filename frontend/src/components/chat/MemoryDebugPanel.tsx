import { useState, useEffect } from 'react'

interface DebugMessage {
  index: number
  role: string
  content: string
  state: 'sent' | 'filtered' | 'skipInHistory'
  tool_names?: string[]
  has_tool_result?: boolean
}

interface DebugData {
  total_messages: number
  sent_count: number
  filtered_count: number
  tool_pairs: number
  estimated_tokens: number
  token_budget?: number
  compression_threshold?: number
  over_compression_threshold?: boolean
  compression_applied?: boolean
  compressed_message_count?: number
  compressed_tokens?: number
  fixed_message_count?: number
  orphan_tool_calls?: string[]
  orphan_tool_results?: string[]
  messages: DebugMessage[]
}

interface Props {
  projectId: string
  sessionId: string
  visible: boolean
}

export function MemoryDebugPanel({ projectId, sessionId, visible }: Props) {
  const [data, setData] = useState<DebugData | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    if (!visible || !sessionId) return
    const fetchDebug = async () => {
      try {
        const res = await fetch(`/api/agent/debug/context/${projectId}/${sessionId}`)
        if (res.ok) setData(await res.json())
      } catch { /* ignore */ }
    }
    fetchDebug()
  }, [visible, sessionId])

  if (!visible || !data) return null

  const roleColor = (role: string) => {
    if (role === 'user') return '#60a5fa'
    if (role === 'assistant') return '#a78bfa'
    if (role === 'tool') return '#f59e0b'
    return '#6b7280'
  }

  const stateColor = (state: string) => {
    if (state === 'sent') return '#14b8a6'
    if (state === 'filtered') return '#f59e0b'
    return '#f43f5e'
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>记忆调试</div>
      <div style={styles.stats}>
        <span style={styles.stat}>消息: {data.total_messages}</span>
        <span style={styles.stat}>发送: {data.sent_count}</span>
        <span style={styles.stat}>过滤: {data.filtered_count}</span>
        <span style={styles.stat}>工具对: {data.tool_pairs}</span>
        <span style={styles.stat}>Token: ~{data.estimated_tokens}</span>
        {data.token_budget && <span style={styles.stat}>预算: {data.token_budget}</span>}
        {data.compression_threshold && (
          <span style={data.over_compression_threshold ? styles.warnStat : styles.stat}>
            压缩阈值: {data.compression_threshold}
          </span>
        )}
        {data.compression_applied && (
          <span style={styles.warnStat}>
            已压缩: {data.compressed_message_count} 条 / ~{data.compressed_tokens} tokens
          </span>
        )}
        {(data.orphan_tool_calls?.length || data.orphan_tool_results?.length) ? (
          <span style={styles.errorStat}>
            工具缺口: {(data.orphan_tool_calls?.length || 0) + (data.orphan_tool_results?.length || 0)}
          </span>
        ) : null}
      </div>
      <div style={styles.list}>
        {data.messages.map((msg, i) => (
          <div
            key={i}
            style={styles.msgCard}
            onClick={() => setExpanded(expanded === i ? null : i)}
          >
            <div style={styles.msgHeader}>
              <span style={styles.msgIndex}>#{msg.index}</span>
              <span style={{ ...styles.msgRole, color: roleColor(msg.role) }}>{msg.role}</span>
              <span style={{ ...styles.msgState, color: stateColor(msg.state) }}>{msg.state}</span>
              {msg.tool_names && msg.tool_names.length > 0 && (
                <span style={styles.toolBadge}>{msg.tool_names.join(', ')}</span>
              )}
              {msg.has_tool_result && <span style={styles.resultBadge}>结果</span>}
            </div>
            {expanded === i && (
              <pre style={styles.msgContent}>
                {msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '0 16px 8px', background: '#12121f', borderRadius: 8,
    border: '1px solid #2a2a3e', overflow: 'hidden', maxHeight: 400, overflowY: 'auto',
  },
  header: {
    padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#a78bfa',
    borderBottom: '1px solid #2a2a3e', background: '#1a1a2e', position: 'sticky', top: 0,
  },
  stats: {
    display: 'flex', gap: 12, padding: '6px 12px', fontSize: 11, color: '#6b7280',
    borderBottom: '1px solid #2a2a3e', flexWrap: 'wrap',
  },
  stat: {},
  warnStat: { color: '#f59e0b' },
  errorStat: { color: '#f87171' },
  list: { padding: '4px 0' },
  msgCard: {
    padding: '4px 12px', cursor: 'pointer', borderBottom: '1px solid #1f2937',
  },
  msgHeader: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 },
  msgIndex: { color: '#6b7280', minWidth: 24 },
  msgRole: { fontWeight: 600, minWidth: 50 },
  msgState: { fontSize: 10 },
  toolBadge: {
    fontSize: 10, padding: '0 4px', background: '#1f2937', borderRadius: 3, color: '#9ca3af',
  },
  resultBadge: {
    fontSize: 10, padding: '0 4px', background: '#14b8a620', borderRadius: 3, color: '#14b8a6',
  },
  msgContent: {
    marginTop: 4, padding: 6, background: '#0f172a', borderRadius: 4,
    fontSize: 11, color: '#9ca3af', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    maxHeight: 150, overflow: 'auto',
  },
}
