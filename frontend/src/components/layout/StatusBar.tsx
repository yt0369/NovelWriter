import { useMemo } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useProjectStore } from '../../stores/projectStore'

export function StatusBar() {
  const { activeFilePath, activeContent } = useEditorStore()
  const { currentProject } = useProjectStore()

  const stats = useMemo(() => {
    if (!activeContent) return { chars: 0, words: 0, lines: 0 }
    const chars = activeContent.length
    const words = activeContent.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
    const lines = activeContent.split('\n').length
    return { chars, words, lines }
  }, [activeContent])

  const fileName = activeFilePath ? activeFilePath.split('/').pop() : ''

  return (
    <div style={styles.container}>
      <div style={styles.left}>
        {currentProject && (
          <span style={styles.project}>📁 {currentProject.name}</span>
        )}
        {fileName && (
          <span style={styles.file}>📄 {fileName}</span>
        )}
      </div>
      <div style={styles.right}>
        {activeContent && (
          <>
            <span style={styles.stat}>{stats.lines} 行</span>
            <span style={styles.stat}>{stats.words} 词</span>
            <span style={styles.stat}>{stats.chars} 字</span>
          </>
        )}
        <span style={styles.stat}>UTF-8</span>
        <span style={styles.stat}>LF</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    height: 24, padding: '0 12px', background: '#0f172a',
    borderTop: '1px solid #1f2937', fontSize: 11, color: '#6b7280',
  },
  left: { display: 'flex', gap: 12, alignItems: 'center' },
  right: { display: 'flex', gap: 12, alignItems: 'center' },
  project: { color: '#9ca3af' },
  file: { color: '#d1d5db' },
  stat: {},
}
