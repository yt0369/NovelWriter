import type { CSSProperties } from 'react'

export interface KnowledgeTreeNode {
  id: string
  name: string
  summary: string
  wing: string
  room: string
  category: string
  importance: string
  tags: string[]
}

interface Props {
  wings: string[]
  grouped: Record<string, KnowledgeTreeNode[]>
  expandedWings: Set<string>
  selectedNodeId: string | null
  onToggleWing: (wing: string) => void
  onSelectNode: (nodeId: string) => void
}

const importanceColor: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  normal: '#6b7280',
  low: '#9ca3af',
}

export function KnowledgeTreeView({
  wings,
  grouped,
  expandedWings,
  selectedNodeId,
  onToggleWing,
  onSelectNode,
}: Props) {
  return (
    <div style={styles.nodeList}>
      {wings.map(wing => {
        const wingNodes = grouped[wing] || []
        const expanded = expandedWings.has(wing)
        return (
          <div key={wing}>
            <button style={styles.wingHeader} onClick={() => onToggleWing(wing)}>
              <span style={styles.wingArrow}>{expanded ? '▼' : '▶'}</span>
              <span style={styles.wingName}>{wing}</span>
              <span style={styles.wingCount}>{wingNodes.length}</span>
            </button>
            {expanded && wingNodes.map(node => (
              <button
                key={node.id}
                style={{
                  ...styles.nodeItem,
                  background: selectedNodeId === node.id ? '#172033' : 'transparent',
                }}
                onClick={() => onSelectNode(node.id)}
              >
                <span style={{
                  ...styles.nodeDot,
                  background: importanceColor[node.importance] || '#6b7280',
                }} />
                <span style={styles.nodeName}>{node.name}</span>
                {node.category && <span style={styles.nodeCat}>{node.category}</span>}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  nodeList: { flex: 1, overflow: 'auto', padding: '4px 0' },
  wingHeader: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', cursor: 'pointer', userSelect: 'none',
    background: 'transparent', border: 'none', textAlign: 'left',
  },
  wingArrow: { fontSize: 10, color: '#6b7280', width: 12 },
  wingName: { fontSize: 13, fontWeight: 600, color: '#14b8a6' },
  wingCount: { fontSize: 11, color: '#6b7280' },
  nodeItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 16px 6px 36px', cursor: 'pointer',
    border: 'none', textAlign: 'left',
  },
  nodeDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  nodeName: { fontSize: 13, color: '#d1d5db', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nodeCat: { fontSize: 10, color: '#6b7280', background: '#1f2937', padding: '1px 6px', borderRadius: 4 },
}
