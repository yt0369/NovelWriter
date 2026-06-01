import { useState } from 'react'

interface SearchResult {
  id: string
  name: string
  summary: string
  wing: string
  room: string
  category: string
  importance: string
  score: number
}

interface Props {
  projectId: string
  onSelect: (nodeId: string) => void
}

export function MemorySearch({ projectId, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`/api/memory/${projectId}/search?query=${encodeURIComponent(query)}&top_k=10`)
      const data = await res.json()
      setResults(data)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const importanceColor: Record<string, string> = {
    critical: '#ef4444',
    high: '#f97316',
    normal: '#6b7280',
    low: '#9ca3af',
  }

  return (
    <div style={styles.container}>
      <div style={styles.searchBar}>
        <input
          style={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="搜索知识图谱..."
        />
        <button style={styles.searchBtn} onClick={handleSearch} disabled={loading}>
          {loading ? '...' : '搜索'}
        </button>
      </div>

      {results.length > 0 && (
        <div style={styles.results}>
          {results.map(r => (
            <div key={r.id} style={styles.resultItem} onClick={() => onSelect(r.id)}>
              <div style={styles.resultHeader}>
                <span style={styles.nodeName}>{r.name}</span>
                <span style={{
                  ...styles.importance,
                  color: importanceColor[r.importance] || '#6b7280',
                }}>
                  {r.importance}
                </span>
              </div>
              <div style={styles.resultMeta}>
                <span style={styles.wing}>{r.wing}</span>
                {r.category && <span style={styles.category}>{r.category}</span>}
                <span style={styles.score}>{Math.round(r.score * 100)}%</span>
              </div>
              {r.summary && <div style={styles.summary}>{r.summary}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { marginBottom: 12 },
  searchBar: { display: 'flex', gap: 8 },
  input: {
    flex: 1, background: '#2a2a3e', border: '1px solid #3a3a5e',
    borderRadius: 8, padding: '8px 12px', color: '#e0e0e0', fontSize: 13, outline: 'none',
  },
  searchBtn: {
    background: '#4f46e5', border: 'none', borderRadius: 8,
    padding: '8px 16px', color: '#fff', fontSize: 13, cursor: 'pointer',
  },
  results: {
    marginTop: 8, maxHeight: 300, overflow: 'auto',
    background: '#12121f', borderRadius: 8, border: '1px solid #2a2a3e',
  },
  resultItem: {
    padding: '10px 14px', borderBottom: '1px solid #1e1e32',
    cursor: 'pointer', transition: 'background 0.15s',
  },
  resultHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  nodeName: { fontWeight: 600, fontSize: 14, color: '#e0e0e0' },
  importance: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' },
  resultMeta: { display: 'flex', gap: 8, marginTop: 4 },
  wing: {
    fontSize: 11, background: '#2a2a4e', color: '#a78bfa',
    padding: '2px 8px', borderRadius: 10,
  },
  category: {
    fontSize: 11, background: '#1e2a3e', color: '#60a5fa',
    padding: '2px 8px', borderRadius: 10,
  },
  score: { fontSize: 11, color: '#6b7280' },
  summary: { fontSize: 12, color: '#888', marginTop: 4, lineHeight: 1.4 },
}
