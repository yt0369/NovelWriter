import { useState, useEffect } from 'react'

interface Props {
  content: string
  filePath: string | null
  onExit: () => void
}

export function ReadingLightView({ content, filePath, onExit }: Props) {
  const [fontSize, setFontSize] = useState(18)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onExit])

  const increaseFont = () => setFontSize(prev => Math.min(prev + 2, 32))
  const decreaseFont = () => setFontSize(prev => Math.max(prev - 2, 12))

  const fileName = filePath ? filePath.split('/').pop() || filePath : '未命名文件'

  return (
    <div style={styles.overlay}>
      <div style={styles.topBar}>
        <span style={styles.fileName}>{fileName}</span>
        <div style={styles.controls}>
          <button style={styles.fontBtn} onClick={decreaseFont}>A-</button>
          <span style={styles.fontSize}>{fontSize}px</span>
          <button style={styles.fontBtn} onClick={increaseFont}>A+</button>
          <button style={styles.exitBtn} onClick={onExit}>退出阅读</button>
        </div>
      </div>
      <div style={styles.contentWrapper}>
        <div style={{ ...styles.content, fontSize, lineHeight: 1.8 }}>
          {content.split('\n').map((line, i) => (
            <p key={i} style={styles.paragraph}>
              {line || '\u00A0'}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: '#111827', display: 'flex', flexDirection: 'column',
  },
  topBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 24px', background: '#1f2937', borderBottom: '1px solid #1f2937',
    flexShrink: 0,
  },
  fileName: { fontSize: 14, color: '#6b7280' },
  controls: { display: 'flex', alignItems: 'center', gap: 12 },
  fontBtn: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    padding: '4px 10px', color: '#d1d5db', fontSize: 13, cursor: 'pointer',
  },
  fontSize: { fontSize: 12, color: '#6b7280', minWidth: 36, textAlign: 'center' },
  exitBtn: {
    background: '#14b8a6', border: 'none', borderRadius: 6,
    padding: '6px 16px', color: '#fff', fontSize: 13, cursor: 'pointer',
  },
  contentWrapper: {
    flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center',
  },
  content: {
    maxWidth: 800, width: '100%', padding: '40px 32px',
    color: '#d4d4d4', textAlign: 'left',
    fontFamily: "'Noto Serif SC', Georgia, serif",
  },
  paragraph: {
    margin: '0 0 0.8em', textIndent: '2em',
  },
}
