import { useEffect, useRef } from 'react'

interface Props {
  lineCount: number
  scrollTop: number
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export function EditorGutter({ lineCount, scrollTop, textareaRef }: Props) {
  const gutterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop
    }
  }, [scrollTop])

  const lines = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1)

  return (
    <div ref={gutterRef} style={styles.gutter}>
      {lines.map(n => (
        <div key={n} style={styles.line} onClick={() => {
          const ta = textareaRef.current
          if (!ta) return
          const content = ta.value
          const lines = content.split('\n')
          let pos = 0
          for (let i = 0; i < n - 1 && i < lines.length; i++) {
            pos += lines[i].length + 1
          }
          ta.focus()
          ta.setSelectionRange(pos, pos)
        }}>
          {n}
        </div>
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  gutter: {
    width: 48, flexShrink: 0, overflow: 'hidden',
    background: '#0d1117', borderRight: '1px solid #1f2937',
    userSelect: 'none', paddingTop: 24,
  },
  line: {
    height: 27, // 15px * 1.8 line-height
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    paddingRight: 8, fontSize: 12, color: '#4b5563',
    cursor: 'pointer',
  },
}
