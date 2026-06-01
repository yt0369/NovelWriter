import { useState, useEffect } from 'react'
import { emitFileUpdated, FILE_UPDATED_EVENT, refreshMatchesPath, WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'

interface Version {
  id: string
  created_at: number
  source: string
  tool_name?: string
  description?: string
  content?: string
}

interface Props {
  projectId: string
  filePath: string | null
  onClose: () => void
}

export function VersionHistory({ projectId, filePath, onClose }: Props) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<Version | null>(null)
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null)
  const [compareData, setCompareData] = useState<[Version, Version] | null>(null)
  const [restoreStatus, setRestoreStatus] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [collapseUnchanged, setCollapseUnchanged] = useState(true)

  const fetchVersions = async () => {
    if (!filePath) return
    setLoading(true)
    fetch(`/api/files/${projectId}/versions?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(data => { setVersions(data || []) })
      .catch(() => { setVersions([]) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchVersions()
    setRestoreStatus('')
    setSourceFilter('all')
    setKindFilter('all')
  }, [projectId, filePath])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (!refreshMatchesPath(detail, filePath)) return
      fetchVersions()
    }
    window.addEventListener(FILE_UPDATED_EVENT, handler)
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => {
      window.removeEventListener(FILE_UPDATED_EVENT, handler)
      window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
    }
  }, [filePath, projectId])

  const loadContent = async (v: Version): Promise<Version> => {
    if (v.content !== undefined) return v
    const res = await fetch(`/api/files/${projectId}/versions/${v.id}`)
    const data = await res.json()
    return { ...v, content: data.content || '' }
  }

  const handleViewVersion = async (v: Version) => {
    setViewingVersion(await loadContent(v))
    setCompareIds(null)
    setCompareData(null)
  }

  const handleSelectForCompare = async (v: Version) => {
    if (!compareIds) {
      setCompareIds([v.id, ''])
      setViewingVersion(null)
      setCompareData(null)
      return
    }
    if (compareIds[1] === '') {
      if (compareIds[0] === v.id) {
        setCompareIds(null)
        return
      }
      const newIds: [string, string] = [compareIds[0], v.id]
      setCompareIds(newIds)
      const v1 = versions.find(ver => ver.id === newIds[0])
      const v2 = versions.find(ver => ver.id === newIds[1])
      if (v1 && v2) {
        setCompareData([await loadContent(v1), await loadContent(v2)])
      }
    } else {
      setCompareIds([v.id, ''])
      setViewingVersion(null)
      setCompareData(null)
    }
  }

  const isSelectedForCompare = (id: string) => {
    if (!compareIds) return false
    return compareIds[0] === id || compareIds[1] === id
  }

  const renderDiff = (v1: Version, v2: Version) => {
    const lines1 = (v1.content || '').split('\n')
    const lines2 = (v2.content || '').split('\n')
    const maxLen = Math.max(lines1.length, lines2.length)
    const diffLines: { type: 'same' | 'add' | 'remove'; text: string; lineNum: number }[] = []

    for (let i = 0; i < maxLen; i++) {
      const l1 = lines1[i]
      const l2 = lines2[i]
      if (l1 === l2) {
        if (!collapseUnchanged) diffLines.push({ type: 'same', text: l2 || '', lineNum: i + 1 })
      } else {
        if (l1 !== undefined) diffLines.push({ type: 'remove', text: l1, lineNum: i + 1 })
        if (l2 !== undefined) diffLines.push({ type: 'add', text: l2, lineNum: i + 1 })
      }
    }
    return diffLines
  }

  const sourceOptions = ['all', ...Array.from(new Set(versions.map(v => v.source || 'unknown')))]
  const kindOptions = ['all', 'draft', 'polish', 'manual', 'restore']
  const filteredVersions = versions.filter(v => {
    const sourceMatch = sourceFilter === 'all' || (v.source || 'unknown') === sourceFilter
    const kindMatch = kindFilter === 'all' || inferVersionKind(v) === kindFilter
    return sourceMatch && kindMatch
  })

  const diffStats = compareData ? summarizeDiff(compareData[0], compareData[1]) : null

  const restoreVersion = async (v: Version) => {
    if (!confirm('确定恢复到这个版本？当前内容会先保存为恢复前版本。')) return
    setRestoreStatus('正在恢复版本...')
    const res = await fetch(`/api/files/${projectId}/versions/${v.id}/restore`, { method: 'POST' })
    if (res.ok) {
      emitFileUpdated(filePath)
      setViewingVersion(null)
      setCompareData(null)
      setCompareIds(null)
      setRestoreStatus(`已恢复到 ${new Date(v.created_at * 1000).toLocaleString('zh-CN')} 的版本`)
    } else {
      setRestoreStatus('恢复失败，请查看工作流历史或稍后重试。')
    }
  }

  if (!filePath) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.title}>历史版本</span>
          <span style={styles.closeBtn} onClick={onClose}>✕</span>
        </div>
        <div style={styles.empty}>请先选择一个文件</div>
      </div>
    )
  }

  return (
    <div style={styles.container} data-testid="version-history-panel">
      <div style={styles.header}>
        <span style={styles.title}>历史版本</span>
        <span style={styles.closeBtn} onClick={onClose}>✕</span>
      </div>

      <div style={styles.filterBar}>
        {sourceOptions.map(source => (
          <button
            key={source}
            style={{
              ...styles.filterBtn,
              ...(sourceFilter === source ? styles.filterBtnActive : {}),
            }}
            data-testid={`version-filter-${source}`}
            onClick={() => {
              setSourceFilter(source)
              setViewingVersion(null)
              setCompareIds(null)
              setCompareData(null)
            }}
          >
            {source === 'all' ? '全部' : versionSourceLabel(source)}
          </button>
        ))}
      </div>

      <div style={styles.filterBar}>
        {kindOptions.map(kind => (
          <button
            key={kind}
            style={{
              ...styles.filterBtn,
              ...(kindFilter === kind ? styles.filterBtnActive : {}),
            }}
            data-testid={`version-kind-filter-${kind}`}
            onClick={() => {
              setKindFilter(kind)
              setViewingVersion(null)
              setCompareIds(null)
              setCompareData(null)
            }}
          >
            {versionKindLabel(kind)}
          </button>
        ))}
      </div>

      <div style={styles.list}>
        {restoreStatus && <div style={styles.restoreStatus} data-testid="version-restore-status">{restoreStatus}</div>}
        {loading && <div style={styles.empty}>加载中...</div>}
        {!loading && versions.length === 0 && <div style={styles.empty}>暂无版本记录</div>}
        {!loading && versions.length > 0 && filteredVersions.length === 0 && <div style={styles.empty}>当前筛选下暂无版本</div>}
        {!loading && filteredVersions.map(v => (
          <div
            key={v.id}
            style={{
              ...styles.versionItem,
              ...(isSelectedForCompare(v.id) ? styles.versionItemSelected : {}),
            }}
          >
            <div style={styles.versionInfo} onClick={() => handleViewVersion(v)}>
              <span style={styles.versionTime}>
                {new Date(v.created_at * 1000).toLocaleString('zh-CN')}
              </span>
              <span
                style={{ ...styles.versionSource, ...versionSourceStyle(v.source) }}
                data-testid={`version-source-${v.source || 'unknown'}`}
              >
                {versionSourceLabel(v.source)}
              </span>
              <span style={styles.sourceChain} data-testid="version-source-chain">
                {versionSourceChain(v)}
              </span>
            </div>
            <button
              style={styles.compareBtn}
              onClick={() => handleSelectForCompare(v)}
            >
              {isSelectedForCompare(v.id) ? '✓ 已选' : '对比'}
            </button>
            <button style={styles.restoreBtn} data-testid="version-restore-button" onClick={() => restoreVersion(v)}>恢复</button>
          </div>
        ))}
      </div>

      {viewingVersion && (
        <div style={styles.preview}>
          <div style={styles.previewHeader}>
            <span style={styles.previewTitle}>
              {new Date(viewingVersion.created_at * 1000).toLocaleString('zh-CN')}
            </span>
            <span style={styles.previewClose} onClick={() => setViewingVersion(null)}>✕</span>
          </div>
          <pre style={styles.previewContent}>{viewingVersion.content || ''}</pre>
        </div>
      )}

      {compareData && (
        <div style={styles.preview}>
          <div style={styles.previewHeader}>
            <span style={styles.previewTitle}>版本对比</span>
            <span style={styles.previewClose} onClick={() => { setCompareIds(null); setCompareData(null) }}>✕</span>
          </div>
          <div style={styles.compareLabels}>
            <span style={styles.compareLabelOld}>
              {new Date(compareData[0].created_at * 1000).toLocaleString('zh-CN')}
            </span>
            <span style={styles.compareLabelNew}>
              {new Date(compareData[1].created_at * 1000).toLocaleString('zh-CN')}
            </span>
          </div>
          {diffStats && (
            <div style={styles.diffSummary} data-testid="version-diff-summary">
              增加 {diffStats.added} 行 · 删除 {diffStats.removed} 行 · 未变 {diffStats.same} 行
            </div>
          )}
          <div style={styles.diffContext} data-testid="version-diff-context">
            仅展示变更行及其附近上下文；大段未变化内容可先通过摘要判断风险。
          </div>
          <button
            style={styles.collapseToggle}
            data-testid="version-diff-collapse-toggle"
            onClick={() => setCollapseUnchanged(value => !value)}
          >
            {collapseUnchanged ? '显示未变化行' : '折叠未变化行'}
          </button>
          <div style={styles.diffBody}>
            {renderDiff(compareData[0], compareData[1]).map((line, i) => (
              <div key={i} style={{
                ...styles.diffLine,
                ...(line.type === 'add' ? styles.diffAdd : {}),
                ...(line.type === 'remove' ? styles.diffRemove : {}),
              }}>
                <span style={styles.diffLineNum}>{line.lineNum}</span>
                <span style={styles.diffPrefix}>
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                <span style={styles.diffText}>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function versionSourceLabel(source?: string) {
  const labels: Record<string, string> = {
    manual: '手动保存',
    agent: 'AI 写入',
    autosave: '自动保存',
    restore: '版本恢复',
    e2e: 'E2E 验收',
    workflow: '工作流',
  }
  return labels[source || ''] || source || '未知来源'
}

function versionSourceStyle(source?: string): React.CSSProperties {
  if (source === 'agent' || source === 'workflow') return { color: '#bfdbfe', background: '#172554', borderColor: '#1d4ed8' }
  if (source === 'autosave') return { color: '#fde68a', background: '#3a2f17', borderColor: '#854d0e' }
  if (source === 'restore') return { color: '#bbf7d0', background: '#143326', borderColor: '#166534' }
  if (source === 'manual') return { color: '#ddd6fe', background: '#2e1065', borderColor: '#6d28d9' }
  return {}
}

function inferVersionKind(version: Version) {
  const haystack = `${version.source || ''} ${version.tool_name || ''} ${version.description || ''}`.toLowerCase()
  if (haystack.includes('polish') || haystack.includes('润色')) return 'polish'
  if (haystack.includes('draft') || haystack.includes('初稿')) return 'draft'
  if (haystack.includes('restore') || haystack.includes('恢复')) return 'restore'
  if (version.source === 'manual') return 'manual'
  return version.source || 'manual'
}

function versionKindLabel(kind: string) {
  const labels: Record<string, string> = {
    all: '全部类型',
    draft: '初稿',
    polish: '润色',
    manual: '手改',
    restore: '恢复',
  }
  return labels[kind] || kind
}

function versionSourceChain(version: Version) {
  const parts = [
    versionSourceLabel(version.source),
    versionKindLabel(inferVersionKind(version)),
    version.tool_name,
    version.description,
  ].filter(Boolean)
  return parts.join(' / ')
}

function summarizeDiff(v1: Version, v2: Version) {
  const lines1 = (v1.content || '').split('\n')
  const lines2 = (v2.content || '').split('\n')
  const maxLen = Math.max(lines1.length, lines2.length)
  let added = 0
  let removed = 0
  let same = 0

  for (let i = 0; i < maxLen; i++) {
    const l1 = lines1[i]
    const l2 = lines2[i]
    if (l1 === l2) {
      same += 1
    } else {
      if (l1 !== undefined) removed += 1
      if (l2 !== undefined) added += 1
    }
  }

  return { added, removed, same }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#111827', borderLeft: '1px solid #1f2937', width: 320,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid #1f2937',
  },
  title: { fontSize: 13, fontWeight: 600, color: '#14b8a6' },
  closeBtn: { cursor: 'pointer', color: '#6b7280', fontSize: 16 },
  empty: { color: '#6b7280', fontSize: 13, padding: 24, textAlign: 'center' },
  filterBar: {
    display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 10px',
    borderBottom: '1px solid #1f2937', background: '#1f2937',
  },
  filterBtn: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 999,
    color: '#cbd5e1', fontSize: 11, padding: '3px 8px', cursor: 'pointer',
  },
  filterBtnActive: {
    color: '#fff', background: '#14b8a6', borderColor: '#14b8a6',
  },
  list: { flex: 1, overflow: 'auto', padding: '4px 0' },
  versionItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 16px', borderBottom: '1px solid #1f2937', cursor: 'pointer',
  },
  versionItemSelected: {
    background: '#1f2937',
  },
  versionInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  versionTime: { fontSize: 12, color: '#e5e7eb' },
  versionSource: {
    alignSelf: 'flex-start',
    fontSize: 11,
    color: '#6b7280',
    border: '1px solid #374151',
    borderRadius: 999,
    padding: '1px 7px',
    background: '#1f2937',
  },
  sourceChain: { color: '#7dd3fc', fontSize: 10, lineHeight: 1.35 },
  compareBtn: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
    padding: '3px 8px', color: '#14b8a6', fontSize: 11, cursor: 'pointer',
    flexShrink: 0,
  },
  restoreBtn: {
    background: '#14532d', border: '1px solid #166534', borderRadius: 4,
    padding: '3px 8px', color: '#bbf7d0', fontSize: 11, cursor: 'pointer',
    flexShrink: 0, marginLeft: 6,
  },
  restoreStatus: {
    margin: '8px 10px',
    padding: '7px 9px',
    borderRadius: 6,
    border: '1px solid #166534',
    background: '#143326',
    color: '#bbf7d0',
    fontSize: 12,
    lineHeight: 1.4,
  },
  preview: {
    borderTop: '1px solid #1f2937', display: 'flex', flexDirection: 'column',
    maxHeight: '50%',
  },
  previewHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 16px', background: '#1f2937',
  },
  previewTitle: { fontSize: 12, color: '#14b8a6' },
  previewClose: { cursor: 'pointer', color: '#6b7280', fontSize: 14 },
  previewContent: {
    flex: 1, overflow: 'auto', padding: 12, margin: 0,
    fontSize: 12, color: '#d1d5db', lineHeight: 1.6,
    fontFamily: 'Consolas, Monaco, monospace',
    background: '#0f1117', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  },
  compareLabels: {
    display: 'flex', gap: 8, padding: '6px 16px', background: '#1f2937',
  },
  compareLabelOld: { fontSize: 11, color: '#fca5a5', flex: 1 },
  compareLabelNew: { fontSize: 11, color: '#86efac', flex: 1 },
  diffSummary: {
    color: '#cbd5e1', fontSize: 11, lineHeight: 1.4,
    padding: '6px 16px', background: '#111827', borderTop: '1px solid #1f2937',
  },
  diffContext: {
    color: '#94a3b8', fontSize: 10, lineHeight: 1.4,
    padding: '5px 16px', background: '#0f172a', borderTop: '1px solid #1f2937',
  },
  collapseToggle: {
    alignSelf: 'flex-start', margin: '6px 16px',
    background: '#1e3a5f', color: '#93c5fd', border: '1px solid #14b8a6',
    borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
  },
  diffBody: {
    flex: 1, overflow: 'auto', background: '#0f1117',
    fontFamily: 'Consolas, Monaco, monospace', fontSize: 12,
  },
  diffLine: {
    display: 'flex', padding: '1px 0', lineHeight: 1.5,
  },
  diffAdd: {
    background: 'rgba(34, 197, 94, 0.12)', color: '#86efac',
  },
  diffRemove: {
    background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5',
  },
  diffLineNum: {
    display: 'inline-block', width: 32, textAlign: 'right', paddingRight: 8,
    color: '#6b7280', userSelect: 'none', flexShrink: 0,
  },
  diffPrefix: {
    width: 16, flexShrink: 0, userSelect: 'none',
  },
  diffText: {
    flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  },
}
