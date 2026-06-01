import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { buttons, panelStates, pills } from '../../styles/ui'
import { emitKnowledgeUpdated, WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'

interface Candidate {
  id: string
  candidate_type: string
  source_file_path?: string
  payload: Record<string, unknown>
  status: string
  created_at: number
}

interface BatchPreviewItem {
  candidate_id: string
  candidate_type?: string
  target_type?: string
  target_label?: string
  display_name?: string
  summary?: string
  evidence?: string
  confidence?: number
  suggested_update?: string
  duplicate_risk?: boolean
  existing_target_id?: string
  duplicate_reason?: string
}

interface BatchPreview {
  status: string
  items: BatchPreviewItem[]
  summary: {
    total: number
    duplicate_count: number
    target_counts: Record<string, number>
  }
}

interface Props {
  projectId: string
  refreshKey?: number
}

export function KnowledgeCandidatesPanel({ projectId, refreshKey = 0 }: Props) {
  const { activeFilePath } = useEditorStore()
  const [items, setItems] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<BatchPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [activeType, setActiveType] = useState('all')
  const [activeSource, setActiveSource] = useState('all')
  const [activeTarget, setActiveTarget] = useState('all')
  const [activeConfidence, setActiveConfidence] = useState('all')
  const [duplicateOnly, setDuplicateOnly] = useState(false)
  const selectedIds = useMemo(() => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id), [selected])
  const typeFilters = useMemo(() => {
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.candidate_type] = (acc[item.candidate_type] || 0) + 1
      return acc
    }, {})
    return Object.entries(counts)
      .sort(([left], [right]) => labelForType(left).localeCompare(labelForType(right), 'zh-Hans-CN'))
      .map(([type, count]) => ({ type, count }))
  }, [items])
  const sourceFilters = useMemo(() => countPayloadField(items, 'extraction_source', sourceLabel), [items])
  const targetFilters = useMemo(() => countPayloadField(items, 'target_type', targetLabel), [items])
  const confidenceFilters = useMemo(() => {
    const buckets = items.reduce<Record<string, number>>((acc, item) => {
      const bucket = confidenceBucket(item)
      if (bucket) acc[bucket] = (acc[bucket] || 0) + 1
      return acc
    }, {})
    return [
      { key: 'high', label: '高置信', count: buckets.high || 0 },
      { key: 'medium', label: '中置信', count: buckets.medium || 0 },
      { key: 'low', label: '低置信', count: buckets.low || 0 },
    ].filter(filter => filter.count > 0)
  }, [items])
  const duplicateRiskCount = useMemo(() => items.filter(hasDuplicateRisk).length, [items])
  const visibleItems = useMemo(
    () => items.filter(item => (
      (activeType === 'all' || item.candidate_type === activeType) &&
      (activeSource === 'all' || item.payload.extraction_source === activeSource) &&
      (activeTarget === 'all' || item.payload.target_type === activeTarget) &&
      (activeConfidence === 'all' || confidenceBucket(item) === activeConfidence) &&
      (!duplicateOnly || hasDuplicateRisk(item))
    )),
    [items, activeType, activeSource, activeTarget, activeConfidence, duplicateOnly],
  )

  const fetchItems = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/memory/${projectId}/candidates`)
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
      setSelected({})
      setActiveType('all')
      setActiveSource('all')
      setActiveTarget('all')
      setActiveConfidence('all')
      setDuplicateOnly(false)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchItems() }, [projectId, refreshKey])

  useEffect(() => {
    if (selectedIds.length === 0) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    fetch(`/api/memory/${projectId}/candidates/batch-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_ids: selectedIds }),
    })
      .then(res => res.json())
      .then(data => { if (!cancelled) setPreview(data?.status === 'ok' ? data : null) })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [projectId, selectedIds.join('|')])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (!detail?.sections || detail.sections.includes('knowledge')) fetchItems()
    }
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
  }, [projectId])

  const decide = async (id: string, action: 'approve' | 'reject') => {
    await fetch(`/api/memory/${projectId}/candidates/${id}/${action}`, { method: 'POST' })
    fetchItems()
    emitKnowledgeUpdated()
  }

  const batchDecide = async (action: 'batch-approve' | 'batch-reject') => {
    if (selectedIds.length === 0) return
    await fetch(`/api/memory/${projectId}/candidates/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_ids: selectedIds }),
    })
    fetchItems()
    emitKnowledgeUpdated()
  }

  const switchType = (type: string) => {
    setActiveType(type)
    setSelected({})
  }

  const switchSource = (source: string) => {
    setActiveSource(source)
    setSelected({})
  }

  const switchTarget = (target: string) => {
    setActiveTarget(target)
    setSelected({})
  }

  const switchConfidence = (confidence: string) => {
    setActiveConfidence(confidence)
    setSelected({})
  }

  const toggleDuplicateOnly = () => {
    setDuplicateOnly(value => !value)
    setSelected({})
  }

  const analyzeCurrentChapter = async () => {
    if (!activeFilePath) return
    setLoading(true)
    try {
      await fetch(`/api/memory/${projectId}/analyze-chapter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFilePath, use_model: true }),
      })
      fetchItems()
      emitKnowledgeUpdated()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.panel} data-testid="knowledge-candidates-panel">
      <div style={styles.header}>
        <span>待确认知识</span>
        <div style={styles.headerActions}>
          <button style={!activeFilePath ? styles.refreshDisabled : styles.refresh} onClick={analyzeCurrentChapter} disabled={!activeFilePath}>分析当前章</button>
          <button
            data-testid="knowledge-batch-reject"
            style={selectedIds.length === 0 ? styles.refreshDisabled : styles.refresh}
            onClick={() => batchDecide('batch-reject')}
            disabled={selectedIds.length === 0}
          >
            批拒
          </button>
          <button
            data-testid="knowledge-batch-approve"
            style={selectedIds.length === 0 ? styles.refreshDisabled : styles.refresh}
            onClick={() => batchDecide('batch-approve')}
            disabled={selectedIds.length === 0}
          >
            批准
          </button>
          <button style={styles.refresh} onClick={fetchItems}>{loading ? '...' : '刷新'}</button>
        </div>
      </div>
      {selectedIds.length > 0 && (
        <BatchPreviewBox preview={preview} loading={previewLoading} selectedCount={selectedIds.length} />
      )}
      {items.length === 0 ? (
        <div style={styles.empty} data-testid="knowledge-empty-state">暂无待确认知识</div>
      ) : (
        <>
          <div style={styles.filters} data-testid="knowledge-filter-bar">
            <button
              type="button"
              data-testid="knowledge-filter-all"
              style={activeType === 'all' ? styles.filterActive : styles.filter}
              onClick={() => switchType('all')}
            >
              全部 {items.length}
            </button>
            {typeFilters.map(filter => (
              <button
                type="button"
                key={filter.type}
                data-testid={`knowledge-filter-${filter.type}`}
                style={activeType === filter.type ? styles.filterActive : styles.filter}
                onClick={() => switchType(filter.type)}
              >
                {labelForType(filter.type)} {filter.count}
              </button>
            ))}
          </div>
          <div style={styles.filters} data-testid="knowledge-source-filter-bar">
            <button
              type="button"
              data-testid="knowledge-source-filter-all"
              style={activeSource === 'all' ? styles.filterActive : styles.filter}
              onClick={() => switchSource('all')}
            >
              来源全部
            </button>
            {sourceFilters.map(filter => (
              <button
                type="button"
                key={filter.value}
                data-testid={`knowledge-source-filter-${filter.value}`}
                style={activeSource === filter.value ? styles.filterActive : styles.filter}
                onClick={() => switchSource(filter.value)}
              >
                {filter.label} {filter.count}
              </button>
            ))}
          </div>
          <div style={styles.filters} data-testid="knowledge-target-filter-bar">
            <button
              type="button"
              data-testid="knowledge-target-filter-all"
              style={activeTarget === 'all' ? styles.filterActive : styles.filter}
              onClick={() => switchTarget('all')}
            >
              目标全部
            </button>
            {targetFilters.map(filter => (
              <button
                type="button"
                key={filter.value}
                data-testid={`knowledge-target-filter-${filter.value}`}
                style={activeTarget === filter.value ? styles.filterActive : styles.filter}
                onClick={() => switchTarget(filter.value)}
              >
                {filter.label} {filter.count}
              </button>
            ))}
          </div>
          <div style={styles.filters} data-testid="knowledge-quality-filter-bar">
            <button
              type="button"
              data-testid="knowledge-confidence-filter-all"
              style={activeConfidence === 'all' ? styles.filterActive : styles.filter}
              onClick={() => switchConfidence('all')}
            >
              置信全部
            </button>
            {confidenceFilters.map(filter => (
              <button
                type="button"
                key={filter.key}
                data-testid={`knowledge-confidence-filter-${filter.key}`}
                style={activeConfidence === filter.key ? styles.filterActive : styles.filter}
                onClick={() => switchConfidence(filter.key)}
              >
                {filter.label} {filter.count}
              </button>
            ))}
            <button
              type="button"
              data-testid="knowledge-duplicate-filter"
              style={duplicateOnly ? styles.filterActive : styles.filter}
              onClick={toggleDuplicateOnly}
            >
              重复风险 {duplicateRiskCount}
            </button>
          </div>
          {visibleItems.length === 0 ? (
            <div style={styles.empty} data-testid="knowledge-empty-state">当前筛选暂无待确认知识</div>
          ) : (
            <div style={styles.list}>
              {visibleItems.map(item => (
            <div key={item.id} style={styles.card} data-testid="knowledge-candidate-card">
              <div style={styles.cardHeader}>
                <label style={styles.checkLine}>
                  <input
                    data-testid="knowledge-candidate-select"
                    type="checkbox"
                    checked={!!selected[item.id]}
                    onChange={e => setSelected(prev => ({ ...prev, [item.id]: e.target.checked }))}
                  />
                  <span style={styles.type}>{labelForType(item.candidate_type)}</span>
                </label>
                <span style={styles.path}>{item.source_file_path || ''}</span>
              </div>
              <div style={styles.summary}>{renderPayload(item.payload)}</div>
              <CandidateQualitySummary item={item} />
              {typeof item.payload.evidence === 'string' && item.payload.evidence && (
                <FieldLine label="证据" value={item.payload.evidence} testId="knowledge-candidate-evidence" tone="evidence" />
              )}
              {typeof item.payload.suggested_update === 'string' && item.payload.suggested_update && (
                <FieldLine label="建议写入" value={item.payload.suggested_update} testId="knowledge-candidate-suggestion" tone="suggested" />
              )}
              <div style={styles.meta}>
                {typeof item.payload.extraction_source === 'string' && <span style={styles.sourceBadge} data-testid="knowledge-candidate-source">{sourceLabel(item.payload.extraction_source)}</span>}
                {typeof item.payload.confidence === 'number' && <span>置信度 {Math.round(item.payload.confidence * 100)}%</span>}
                {typeof item.payload.target_type === 'string' && <span data-testid="knowledge-candidate-target">目标 {targetLabel(item.payload.target_type)}</span>}
                {typeof item.payload.target_id === 'string' && item.payload.target_id && <span>ID {item.payload.target_id}</span>}
                {typeof item.payload.extraction_error === 'string' && <span>失败原因 {item.payload.extraction_error}</span>}
              </div>
              <div style={styles.actions}>
                <button style={styles.rejectBtn} onClick={() => decide(item.id, 'reject')}>拒绝</button>
                <button style={styles.approveBtn} onClick={() => decide(item.id, 'approve')}>确认入库</button>
              </div>
            </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CandidateQualitySummary({ item }: { item: Candidate }) {
  const source = typeof item.payload.extraction_source === 'string' ? sourceLabel(item.payload.extraction_source) : '来源未知'
  const target = typeof item.payload.target_type === 'string' ? targetLabel(item.payload.target_type) : '目标未定'
  const confidence = typeof item.payload.confidence === 'number' ? `${Math.round(item.payload.confidence * 100)}%` : '未提供'
  const confidenceText = typeof item.payload.confidence === 'number' ? `${confidenceBucketLabel(confidenceBucket(item))} ${confidence}` : confidence
  const duplicateText = hasDuplicateRisk(item) ? '可能重复' : '未见重复'
  return (
    <div style={styles.qualitySummary} data-testid="knowledge-candidate-quality-summary">
      <span>{source}</span>
      <span>{confidenceText}</span>
      <span>写入 {target}</span>
      <span>{duplicateText}</span>
    </div>
  )
}

function BatchPreviewBox({ preview, loading, selectedCount }: { preview: BatchPreview | null; loading: boolean; selectedCount: number }) {
  const targetCounts = preview?.summary?.target_counts || {}
  return (
    <div style={styles.previewBox} data-testid="knowledge-batch-preview">
      <div style={styles.previewHeader}>
        <span>批量入库预览</span>
        <span>{loading ? '分析中...' : `已选 ${selectedCount} 条`}</span>
      </div>
      {preview ? (
        <>
          <div style={styles.previewMeta}>
            {Object.entries(targetCounts).map(([target, count]) => (
              <span key={target}>{targetLabel(target)} {count}</span>
            ))}
            {preview.summary.duplicate_count > 0 && (
              <span style={styles.duplicateBadge} data-testid="knowledge-preview-duplicate-risk">
                可能重复 {preview.summary.duplicate_count}
              </span>
            )}
          </div>
          <div style={styles.previewList}>
            {preview.items.slice(0, 5).map(item => (
              <div key={item.candidate_id} style={styles.previewItem}>
                <span>{item.display_name || item.candidate_id}</span>
                <span>{item.target_label || targetLabel(item.target_type || '')}</span>
                {item.duplicate_risk && (
                  <span style={styles.duplicateText}>
                    {item.duplicate_reason || '可能重复'}{item.existing_target_id ? ` · 已存在 ${item.existing_target_id}` : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={styles.previewMeta}>正在准备预览。</div>
      )}
    </div>
  )
}

function FieldLine({ label, value, testId, tone }: { label: string; value: string; testId: string; tone: 'evidence' | 'suggested' }) {
  return (
    <div style={tone === 'evidence' ? styles.evidence : styles.suggested} data-testid={testId}>
      <span style={styles.fieldLabel}>{label}：</span>{value}
    </div>
  )
}

function countPayloadField(items: Candidate[], field: 'extraction_source' | 'target_type', labeler: (value: string) => string) {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const value = item.payload[field]
    if (typeof value === 'string' && value) acc[value] = (acc[value] || 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .sort(([left], [right]) => labeler(left).localeCompare(labeler(right), 'zh-Hans-CN'))
    .map(([value, count]) => ({ value, label: labeler(value), count }))
}

function confidenceBucket(item: Candidate) {
  const confidence = item.payload.confidence
  if (typeof confidence !== 'number') return ''
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}

function confidenceBucketLabel(bucket: string) {
  const labels: Record<string, string> = { high: '高置信', medium: '中置信', low: '低置信' }
  return labels[bucket] || '置信'
}

function hasDuplicateRisk(item: Candidate) {
  return item.payload.duplicate_risk === true || Boolean(item.payload.duplicate_reason)
}

function labelForType(type: string) {
  const labels: Record<string, string> = {
    chapter_summary: '章节摘要',
    chapter_analysis_required: '章节分析',
    character_state: '角色状态',
    timeline_event: '时间线事件',
    foreshadowing: '伏笔',
    world_setting: '世界观设定',
  }
  return labels[type] || type
}

function renderPayload(payload: Record<string, unknown>) {
  const title = payload.title || payload.name
  const summary = payload.summary || payload.message || payload.description
  if (title || summary) return `${title ? `${title}：` : ''}${summary || ''}`
  return JSON.stringify(payload).slice(0, 240)
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    model_analysis: '模型分析',
    local_rule: '本地规则兜底',
  }
  return labels[source] || source
}

function targetLabel(targetType: string) {
  const labels: Record<string, string> = {
    chapter_summary: '章节摘要',
    character: '人物档案',
    timeline_event: '时间线事件',
    foreshadowing: '伏笔表',
    knowledge_node: '知识图谱',
  }
  return labels[targetType] || targetType
}

const styles: Record<string, React.CSSProperties> = {
  panel: { borderTop: '1px solid #2a2a3e', background: '#141427' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', color: '#a78bfa', fontSize: 12, fontWeight: 700 },
  headerActions: { display: 'flex', gap: 6, alignItems: 'center' },
  refresh: { ...buttons.secondary, color: '#c4b5fd', fontSize: 11, padding: '3px 8px' },
  refreshDisabled: { ...buttons.disabled, fontSize: 11, padding: '3px 8px' },
  empty: panelStates.empty,
  filters: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 10px 8px' },
  filter: pills.filter,
  filterActive: pills.filterActive,
  list: { display: 'flex', flexDirection: 'column', gap: 8, padding: '0 10px 10px', maxHeight: 260, overflow: 'auto' },
  card: { background: '#1e1e32', border: '1px solid #2a2a3e', borderRadius: 8, padding: 10 },
  previewBox: { margin: '0 10px 8px', background: '#111827', border: '1px solid #334155', borderRadius: 8, padding: 9 },
  previewHeader: { display: 'flex', justifyContent: 'space-between', gap: 8, color: '#e5e7eb', fontSize: 12, fontWeight: 700 },
  previewMeta: { display: 'flex', gap: 8, flexWrap: 'wrap', color: '#93c5fd', fontSize: 11, marginTop: 6 },
  previewList: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 7 },
  previewItem: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 5, color: '#cbd5e1', fontSize: 11, lineHeight: 1.35 },
  duplicateBadge: pills.warning,
  duplicateText: { gridColumn: '1 / -1', color: '#fde68a' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', gap: 8 },
  checkLine: { display: 'flex', alignItems: 'center', gap: 6 },
  type: { color: '#e0e0e0', fontSize: 12, fontWeight: 700 },
  path: { color: '#666', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  summary: { color: '#aaa', fontSize: 12, lineHeight: 1.45, marginTop: 6 },
  qualitySummary: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, color: '#dbeafe', fontSize: 11 },
  evidence: { color: '#8b949e', fontSize: 11, lineHeight: 1.4, marginTop: 5, maxHeight: 48, overflow: 'auto' },
  suggested: { color: '#cbd5e1', fontSize: 11, lineHeight: 1.4, marginTop: 5, maxHeight: 48, overflow: 'auto' },
  fieldLabel: { color: '#c4b5fd', fontWeight: 700 },
  meta: { display: 'flex', gap: 8, color: '#666', fontSize: 11, marginTop: 5, flexWrap: 'wrap' },
  sourceBadge: pills.success,
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  rejectBtn: { background: '#2a2a3e', border: '1px solid #3a3a5e', color: '#ccc', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
  approveBtn: { background: '#16a34a', border: 'none', color: '#fff', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
}
