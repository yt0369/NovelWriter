import { useEffect, useMemo, useState } from 'react'
import { useEmbeddingAdminStore } from '../../stores/embeddingAdminStore'

interface Props {
  projectId: string
}

export function MemoryAdminPanel({ projectId }: Props) {
  const { status, testResults, loading, repairing, fetchStatus, repairEmbeddings, testRecall, clearTestResults } = useEmbeddingAdminStore()
  const [query, setQuery] = useState('')

  useEffect(() => { fetchStatus(projectId) }, [projectId])

  const coverage = useMemo(() => {
    if (!status?.total) return 100
    return Math.round(((status.with_embedding || 0) / status.total) * 100)
  }, [status])

  const handleRepair = async () => {
    await repairEmbeddings(projectId)
  }

  const handleRecall = async () => {
    if (!query.trim()) return
    await testRecall(projectId, query.trim())
  }

  if (!status) return null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>嵌入管理</span>
        <button style={styles.refreshBtn} onClick={() => fetchStatus(projectId)} disabled={loading}>刷新</button>
      </div>
      <div style={styles.body}>
        <div style={styles.row}>
          <span style={styles.label}>状态</span>
          <span style={{ ...styles.badge, color: status.health === 'healthy' ? '#14b8a6' : '#f59e0b' }}>
            {status.health === 'healthy' ? '正常' : '异常'}
          </span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>总节点</span>
          <span style={styles.value}>{status.total}</span>
        </div>
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${coverage}%` }} />
        </div>
        <div style={styles.row}>
          <span style={styles.label}>覆盖率</span>
          <span style={styles.value}>{coverage}% ({status.with_embedding || 0}/{status.total})</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>缺失嵌入</span>
          <span style={{ ...styles.value, color: status.missing_count > 0 ? '#f59e0b' : '#14b8a6' }}>
            {status.missing_count}
          </span>
        </div>
        {(status.missing_nodes?.length || 0) > 0 && (
          <div style={styles.missingList}>
            {status.missing_nodes!.slice(0, 6).map(node => (
              <span key={node.id} style={styles.missingItem}>{node.name}</span>
            ))}
            {status.missing_nodes!.length > 6 && <span style={styles.missingMore}>+{status.missing_nodes!.length - 6}</span>}
          </div>
        )}
        {status.missing_count > 0 && (
          <button
            style={styles.btn}
            onClick={handleRepair}
            disabled={repairing}
          >
            {repairing ? '修复中...' : `一键修复 (${status.missing_count}个)`}
          </button>
        )}
        <div style={styles.testBox}>
          <div style={styles.testHeader}>
            <span style={styles.testTitle}>召回测试</span>
            {testResults.length > 0 && <button style={styles.clearBtn} onClick={clearTestResults}>清空</button>}
          </div>
          <div style={styles.queryRow}>
            <input
              style={styles.queryInput}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRecall()}
              placeholder="输入角色、设定或剧情关键词"
            />
            <button style={styles.queryBtn} onClick={handleRecall} disabled={!query.trim()}>测试</button>
          </div>
          {testResults.slice(0, 3).map(result => (
            <div key={`${result.query}-${result.latency_ms}`} style={styles.result}>
              <div style={styles.resultTitle}>{result.query} · {result.latency_ms}ms</div>
              {result.results.length === 0 ? (
                <div style={styles.emptyResult}>无召回结果</div>
              ) : result.results.slice(0, 5).map(item => (
                <div key={item.id} style={styles.resultItem}>
                  <span style={styles.resultName}>{item.name}</span>
                  <span style={styles.resultMeta}>{item.wing || '未分翼'} · {Math.round(item.score * 100)}%</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '8px 0', background: '#12121f', borderRadius: 8,
    border: '1px solid #2a2a3e', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#9ca3af',
    borderBottom: '1px solid #2a2a3e', background: '#1a1a2e',
  },
  body: { padding: '8px 12px' },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '4px 0', fontSize: 12,
  },
  label: { color: '#6b7280' },
  value: { color: '#e5e7eb' },
  badge: { fontWeight: 600 },
  refreshBtn: {
    background: 'transparent', color: '#6b7280', border: '1px solid #2a2a3e',
    borderRadius: 4, fontSize: 11, padding: '2px 8px', cursor: 'pointer',
  },
  progressTrack: {
    height: 6, background: '#0f172a', borderRadius: 999, overflow: 'hidden',
    margin: '6px 0',
  },
  progressFill: { height: '100%', background: '#14b8a6', borderRadius: 999 },
  missingList: { display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0' },
  missingItem: {
    fontSize: 10, color: '#f59e0b', background: '#2a2115',
    border: '1px solid #4a3418', borderRadius: 4, padding: '2px 5px',
  },
  missingMore: { fontSize: 10, color: '#6b7280', padding: '2px 5px' },
  btn: {
    width: '100%', marginTop: 8, padding: '6px 12px',
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 4, fontSize: 12, cursor: 'pointer',
  },
  testBox: { marginTop: 12, borderTop: '1px solid #2a2a3e', paddingTop: 10 },
  testHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  testTitle: { color: '#9ca3af', fontSize: 12, fontWeight: 600 },
  clearBtn: { background: 'transparent', border: 'none', color: '#6b7280', fontSize: 11, cursor: 'pointer' },
  queryRow: { display: 'flex', gap: 6 },
  queryInput: {
    flex: 1, minWidth: 0, background: '#0f172a', border: '1px solid #2a2a3e',
    borderRadius: 4, color: '#e5e7eb', fontSize: 12, padding: '6px 8px', outline: 'none',
  },
  queryBtn: {
    background: '#1f2937', border: '1px solid #374151', color: '#d1d5db',
    borderRadius: 4, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
  },
  result: {
    marginTop: 8, padding: '6px 10px', background: '#0f172a',
    borderRadius: 4, fontSize: 11, color: '#9ca3af',
  },
  resultTitle: { color: '#14b8a6', marginBottom: 4, fontWeight: 600 },
  resultItem: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' },
  resultName: { color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  resultMeta: { color: '#6b7280', flexShrink: 0 },
  emptyResult: { color: '#6b7280' },
}
