interface DiffLine {
  line: number
  type: 'added' | 'removed' | 'modified'
}

interface Props {
  diffs: DiffLine[]
  visible: boolean
}

export function EditHighlightOverlay({ diffs, visible }: Props) {
  if (!visible || !diffs.length) return null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.count}>{diffs.length} 处差异</span>
      </div>
      <div style={styles.list}>
        {diffs.map((d, i) => (
          <div key={i} style={styles.item}>
            <span style={{
              ...styles.badge,
              background: d.type === 'added' ? '#166534' : d.type === 'removed' ? '#991b1b' : '#854d0e',
            }}>
              {d.type === 'added' ? '+' : d.type === 'removed' ? '-' : '~'}
            </span>
            <span style={styles.lineNum}>行 {d.line}</span>
            <span style={styles.type}>{d.type === 'added' ? '新增' : d.type === 'removed' ? '删除' : '修改'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute', top: 0, right: 0, width: 200,
    background: '#111827', borderLeft: '1px solid #1f2937',
    zIndex: 10, maxHeight: '100%', overflow: 'auto',
  },
  header: {
    padding: '6px 10px', fontSize: 11, color: '#9ca3af',
    borderBottom: '1px solid #1f2937', fontWeight: 600,
  },
  count: { color: '#14b8a6' },
  list: { padding: '4px 0' },
  item: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '3px 10px', fontSize: 11,
  },
  badge: {
    width: 14, height: 14, borderRadius: 3,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0,
  },
  lineNum: { color: '#6b7280', minWidth: 36 },
  type: { color: '#e5e7eb' },
}
