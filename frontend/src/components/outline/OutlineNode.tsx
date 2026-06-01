import { useState } from 'react'

interface TreeNode {
  id: string
  name: string
  type: 'volume' | 'chapter' | 'event'
  children?: TreeNode[]
  status?: string
  summary?: string
  file_path?: string
}

interface Props {
  node: TreeNode
  level: number
  onNodeClick?: (node: TreeNode) => void
}

export function OutlineNode({ node, level, onNodeClick }: Props) {
  const [expanded, setExpanded] = useState(level < 2)
  const hasChildren = node.children && node.children.length > 0

  const statusColor = node.status === 'completed' ? '#14b8a6' : '#6b7280'
  const typeIcon = node.type === 'volume' ? '📁' : node.type === 'chapter' ? '📄' : '📌'

  return (
    <div>
      <div
        style={{ ...styles.node, paddingLeft: level * 16 }}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded)
          onNodeClick?.(node)
        }}
      >
        {hasChildren ? (
          <span style={styles.expandIcon}>{expanded ? '▾' : '▸'}</span>
        ) : (
          <span style={styles.expandIcon} />
        )}
        <span style={styles.typeIcon}>{typeIcon}</span>
        <span style={styles.name}>{node.name}</span>
        {node.status && (
          <span style={{ ...styles.status, color: statusColor }}>
            {node.status === 'completed' ? '✓' : '○'}
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map(child => (
            <OutlineNode key={child.id} node={child} level={level + 1} onNodeClick={onNodeClick} />
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  node: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 8px', cursor: 'pointer', fontSize: 13,
    color: '#e5e7eb', borderRadius: 4,
  },
  expandIcon: { width: 12, fontSize: 10, color: '#6b7280', textAlign: 'center' },
  typeIcon: { fontSize: 12 },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  status: { fontSize: 10 },
}
