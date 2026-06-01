import { useState } from 'react'

interface Props {
  data: unknown
  name?: string
  defaultExpanded?: boolean
}

export function JsonViewer({ data, name, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (data === null || data === undefined) {
    return <span style={styles.null}>null</span>
  }

  if (typeof data === 'boolean') {
    return <span style={styles.boolean}>{String(data)}</span>
  }

  if (typeof data === 'number') {
    return <span style={styles.number}>{data}</span>
  }

  if (typeof data === 'string') {
    return <span style={styles.string}>"{data}"</span>
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span style={styles.bracket}>[]</span>
    }

    return (
      <div style={styles.container}>
        <span style={styles.toggle} onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'} {name && <span style={styles.key}>{name}:</span>}
          <span style={styles.bracket}>[</span>
          {!expanded && <span style={styles.preview}>{data.length} items...</span>}
          {!expanded && <span style={styles.bracket}>]</span>}
        </span>
        {expanded && (
          <div style={styles.children}>
            {data.map((item, i) => (
              <div key={i} style={styles.item}>
                <JsonViewer data={item} />
                {i < data.length - 1 && <span style={styles.comma}>,</span>}
              </div>
            ))}
            <span style={styles.bracket}>]</span>
          </div>
        )}
      </div>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data)
    if (entries.length === 0) {
      return <span style={styles.bracket}>{'{}'}</span>
    }

    return (
      <div style={styles.container}>
        <span style={styles.toggle} onClick={() => setExpanded(!expanded)}>
          {expanded ? '▼' : '▶'} {name && <span style={styles.key}>{name}:</span>}
          <span style={styles.bracket}>{'{'}</span>
          {!expanded && <span style={styles.preview}>{entries.length} keys...</span>}
          {!expanded && <span style={styles.bracket}>{'}'}</span>}
        </span>
        {expanded && (
          <div style={styles.children}>
            {entries.map(([key, value], i) => (
              <div key={key} style={styles.item}>
                <JsonViewer data={value} name={key} defaultExpanded={false} />
                {i < entries.length - 1 && <span style={styles.comma}>,</span>}
              </div>
            ))}
            <span style={styles.bracket}>{'}'}</span>
          </div>
        )}
      </div>
    )
  }

  return <span style={styles.string}>{String(data)}</span>
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: 'Consolas, Monaco, monospace',
    fontSize: 12,
    lineHeight: 1.5,
  },
  toggle: {
    cursor: 'pointer',
    userSelect: 'none',
  },
  key: {
    color: '#9cdcfe',
    marginRight: 4,
  },
  bracket: {
    color: '#d4d4d4',
  },
  preview: {
    color: '#6b7280',
    fontStyle: 'italic',
    margin: '0 4px',
  },
  children: {
    paddingLeft: 16,
    borderLeft: '1px solid #2a2a3e',
    marginLeft: 4,
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 0,
  },
  comma: {
    color: '#d4d4d4',
  },
  string: {
    color: '#ce9178',
  },
  number: {
    color: '#b5cea8',
  },
  boolean: {
    color: '#569cd6',
  },
  null: {
    color: '#569cd6',
  },
}
