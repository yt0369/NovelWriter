interface Props {
  onInsert: (prefix: string, suffix?: string) => void
  viewMode: 'edit' | 'preview' | 'split'
  setViewMode: (mode: 'edit' | 'preview' | 'split') => void
  wordCount: number
  lineCount: number
}

export function EditorToolbar({ onInsert, viewMode, setViewMode, wordCount, lineCount }: Props) {
  return (
    <div style={styles.formatBar}>
      <div style={styles.formatGroup}>
        <button style={styles.formatBtn} onClick={() => onInsert('**', '**')} title="粗体">B</button>
        <button style={styles.formatBtnItalic} onClick={() => onInsert('*', '*')} title="斜体">I</button>
        <button style={styles.formatBtn} onClick={() => onInsert('## ')} title="标题">H</button>
      </div>
      <div style={styles.formatDivider} />
      <div style={styles.formatGroup}>
        <button style={styles.formatBtn} onClick={() => onInsert('- ')} title="无序列表">☰</button>
        <button style={styles.formatBtn} onClick={() => onInsert('1. ')} title="有序列表">≡</button>
      </div>
      <div style={styles.formatDivider} />
      <div style={styles.formatGroup}>
        <button style={styles.formatBtn} onClick={() => onInsert('> ')} title="引用">❝</button>
        <button style={styles.formatBtn} onClick={() => onInsert('`', '`')} title="行内代码">{"</>"}</button>
        <button style={styles.formatBtn} onClick={() => onInsert('[', '](url)')} title="链接">🔗</button>
        <button style={styles.formatBtn} onClick={() => onInsert('![alt](', ')')} title="图片">🖼</button>
      </div>
      <div style={styles.formatDivider} />
      <div style={styles.formatGroup}>
        <button style={styles.formatBtn} onClick={() => onInsert('| 列1 | 列2 |\n|------|------|\n| ', ' |  |')} title="表格">▦</button>
        <button style={styles.formatBtn} onClick={() => onInsert('---\n')} title="分割线">—</button>
      </div>
      <div style={{ flex: 1 }} />
      <div style={styles.statsGroup}>
        <span style={styles.statItem}>{lineCount} 行</span>
        <span style={styles.statDivider}>|</span>
        <span style={styles.statItem}>{wordCount.toLocaleString()} 字</span>
      </div>
      <div style={styles.viewModeGroup}>
        <button style={viewMode === 'edit' ? styles.viewModeBtnActive : styles.viewModeBtn} onClick={() => setViewMode('edit')}>编辑</button>
        <button style={viewMode === 'preview' ? styles.viewModeBtnActive : styles.viewModeBtn} onClick={() => setViewMode('preview')}>预览</button>
        <button style={viewMode === 'split' ? styles.viewModeBtnActive : styles.viewModeBtn} onClick={() => setViewMode('split')}>分屏</button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  formatBar: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 12px', background: '#111827', borderBottom: '1px solid #1f2937',
  },
  formatGroup: { display: 'flex', gap: 2 },
  formatBtn: {
    background: 'none', border: 'none', color: '#9ca3af', fontSize: 14,
    cursor: 'pointer', padding: '4px 8px', borderRadius: 4, lineHeight: 1,
    minWidth: 28, textAlign: 'center',
  },
  formatBtnItalic: {
    background: 'none', border: 'none', color: '#9ca3af', fontSize: 14,
    cursor: 'pointer', padding: '4px 8px', borderRadius: 4, lineHeight: 1,
    fontStyle: 'italic', minWidth: 28, textAlign: 'center',
  },
  formatDivider: { width: 1, height: 16, background: '#374151', margin: '0 4px' },
  statsGroup: {
    display: 'flex', alignItems: 'center', gap: 6, marginRight: 8,
  },
  statItem: { fontSize: 12, color: '#6b7280' },
  statDivider: { color: '#374151', fontSize: 11 },
  viewModeGroup: {
    display: 'flex', background: '#1f2937', borderRadius: 4, border: '1px solid #374151',
  },
  viewModeBtn: {
    background: 'none', border: 'none', padding: '3px 8px', color: '#6b7280',
    fontSize: 11, cursor: 'pointer', borderRadius: 3,
  },
  viewModeBtnActive: {
    background: '#374151', border: 'none', padding: '3px 8px', color: '#14b8a6',
    fontSize: 11, cursor: 'pointer', borderRadius: 3,
  },
}
