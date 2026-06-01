import { useState, useEffect } from 'react'

interface KnowledgeNode {
  id: string
  name: string
  summary?: string
  detail?: string
  wing: string
  room?: string
  category?: string
  importance: string
  tags?: string[]
  created_at: number
  last_modified: number
}

interface RelatedNode {
  id: string
  name: string
  wing: string
  edge_type: string
}

interface Props {
  projectId: string
  nodeId: string
  onEdit?: (nodeId: string) => void
  onSelect?: (nodeId: string) => void
}

const WING_COLORS: Record<string, string> = {
  '世界': '#3b82f6',
  '角色': '#22c55e',
  '剧情': '#ef4444',
  '灵感': '#eab308',
  '物品': '#a855f7',
  '设定': '#f97316',
}

const IMPORTANCE_LABELS: Record<string, { label: string; color: string }> = {
  critical: { label: '关键', color: '#ef4444' },
  important: { label: '重要', color: '#f59e0b' },
  normal: { label: '普通', color: '#6b7280' },
  low: { label: '次要', color: '#9ca3af' },
}

export function KnowledgeNodePreview({ projectId, nodeId, onEdit, onSelect }: Props) {
  const [node, setNode] = useState<KnowledgeNode | null>(null)
  const [related, setRelated] = useState<RelatedNode[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchNode = async () => {
      setLoading(true)
      try {
        const [nodeRes, graphRes] = await Promise.all([
          fetch(`/api/memory/${projectId}/nodes/${nodeId}`),
          fetch(`/api/memory/${projectId}/graph`),
        ])

        if (nodeRes.ok) setNode(await nodeRes.json())

        if (graphRes.ok) {
          const data = await graphRes.json()
          const edges = data.edges || []
          const nodes = data.nodes || []

          const relatedEdges = edges.filter(
            (e: any) => e.source === nodeId || e.target === nodeId
          )

          const relatedNodes: RelatedNode[] = relatedEdges.map((e: any) => {
            const otherId = e.source === nodeId ? e.target : e.source
            const otherNode = nodes.find((n: any) => n.id === otherId)
            return {
              id: otherId,
              name: otherNode?.name || otherId,
              wing: otherNode?.wing || '',
              edge_type: e.relation_type || e.edge_type || '',
            }
          })

          setRelated(relatedNodes)
        }
      } catch { /* ignore */ }
      setLoading(false)
    }

    fetchNode()
  }, [projectId, nodeId])

  if (loading) return <div style={styles.loading}>加载中...</div>
  if (!node) return <div style={styles.error}>节点不存在</div>

  const importance = IMPORTANCE_LABELS[node.importance] || IMPORTANCE_LABELS.normal

  return (
    <div style={styles.container}>
      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span style={{ ...styles.wingBadge, background: WING_COLORS[node.wing] || '#6b7280' }}>
            {node.wing}
          </span>
          <h3 style={styles.title}>{node.name}</h3>
        </div>
        {onEdit && (
          <button style={styles.editBtn} onClick={() => onEdit(nodeId)}>编辑</button>
        )}
      </div>

      {/* 元数据 */}
      <div style={styles.meta}>
        <span style={{ ...styles.importanceBadge, color: importance.color }}>
          {importance.label}
        </span>
        {node.room && <span style={styles.roomBadge}>{node.room}</span>}
        {node.category && <span style={styles.catBadge}>{node.category}</span>}
      </div>

      {/* 标签 */}
      {node.tags && node.tags.length > 0 && (
        <div style={styles.tags}>
          {node.tags.map(tag => (
            <span key={tag} style={styles.tag}>{tag}</span>
          ))}
        </div>
      )}

      {/* 摘要 */}
      {node.summary && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>摘要</div>
          <div style={styles.sectionContent}>{node.summary}</div>
        </div>
      )}

      {/* 详情 */}
      {node.detail && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>详情</div>
          <div style={styles.detailContent}>{node.detail}</div>
        </div>
      )}

      {/* 关联节点 */}
      {related.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>关联节点 ({related.length})</div>
          <div style={styles.relatedList}>
            {related.map(r => (
              <div
                key={r.id}
                style={styles.relatedItem}
                onClick={() => onSelect?.(r.id)}
              >
                <span style={{ ...styles.relatedDot, background: WING_COLORS[r.wing] || '#6b7280' }} />
                <span style={styles.relatedName}>{r.name}</span>
                <span style={styles.relatedType}>{r.edge_type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 时间信息 */}
      <div style={styles.footer}>
        <span>创建: {new Date(node.created_at * 1000).toLocaleString()}</span>
        <span>更新: {new Date(node.last_modified * 1000).toLocaleString()}</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12 },
  loading: { color: '#6b7280', textAlign: 'center', padding: 20, fontSize: 13 },
  error: { color: '#ef4444', textAlign: 'center', padding: 20, fontSize: 13 },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  wingBadge: {
    fontSize: 11, color: '#fff', padding: '2px 8px', borderRadius: 4,
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700, color: '#e5e7eb' },
  editBtn: {
    background: 'transparent', border: '1px solid #374151', borderRadius: 4,
    padding: '4px 10px', color: '#14b8a6', fontSize: 12, cursor: 'pointer',
  },
  meta: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  importanceBadge: { fontSize: 11, fontWeight: 600 },
  roomBadge: {
    fontSize: 11, color: '#9ca3af', background: '#1f2937',
    padding: '2px 8px', borderRadius: 4,
  },
  catBadge: {
    fontSize: 11, color: '#9ca3af', background: '#1f2937',
    padding: '2px 8px', borderRadius: 4,
  },
  tags: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  tag: {
    fontSize: 10, color: '#14b8a6', background: '#0d3331',
    padding: '2px 6px', borderRadius: 3,
  },
  section: {
    background: '#1f2937', borderRadius: 8, padding: 10,
    border: '1px solid #374151',
  },
  sectionTitle: { fontSize: 11, color: '#9ca3af', fontWeight: 600, marginBottom: 6 },
  sectionContent: { fontSize: 13, color: '#e5e7eb', lineHeight: 1.5 },
  detailContent: {
    fontSize: 12, color: '#d1d5db', lineHeight: 1.5,
    whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto',
  },
  relatedList: { display: 'flex', flexDirection: 'column', gap: 4 },
  relatedItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
  },
  relatedDot: { width: 6, height: 6, borderRadius: '50%' },
  relatedName: { fontSize: 12, color: '#e5e7eb', flex: 1 },
  relatedType: { fontSize: 10, color: '#6b7280' },
  footer: {
    display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4b5563',
  },
}
