import { useState, useCallback } from 'react'

interface SearchResult {
  file_path: string
  file_name: string
  line_number: number
  line_content: string
  match_type: 'filename' | 'content'
}

interface Props {
  projectId: string
  onSelect: (filePath: string) => void
}

export function FileSearch({ projectId, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const res = await fetch(`/api/files/${projectId}/search?q=${encodeURIComponent(query)}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.results || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [projectId, query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  return (
    <div style={styles.container}>
      <div style={styles.searchBox}>
        <input
          style={styles.input}
          placeholder="搜索文件名或内容..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button style={styles.searchBtn} onClick={handleSearch} disabled={loading}>
          {loading ? '...' : '🔍'}
        </button>
      </div>

      <div style={styles.results}>
        {loading && <div style={styles.loading}>搜索中...</div>}

        {!loading && searched && results.length === 0 && (
          <div style={styles.empty}>未找到匹配结果</div>
        )}

        {!loading && results.map((result, i) => (
          <div
            key={`${result.file_path}-${i}`}
            style={styles.resultItem}
            onClick={() => onSelect(result.file_path)}
          >
            <div style={styles.resultHeader}>
              <span style={styles.fileName}>{result.file_name}</span>
              {result.line_number > 0 && (
                <span style={styles.lineNumber}>:{result.line_number}</span>
              )}
            </div>
            <div style={styles.filePath}>{result.file_path}</div>
            {result.line_content && (
              <div style={styles.lineContent}>
                {highlightMatch(result.line_content, query)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function highlightMatch(text: string, query: string) {
  if (!query) return text
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text
  const before = text.slice(0, index)
  const match = text.slice(index, index + query.length)
  const after = text.slice(index + query.length)
  return (
    <>
      {before}
      <span style={{ background: '#f59e0b44', color: '#f59e0b' }}>{match}</span>
      {after}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%' },
  searchBox: {
    display: 'flex', gap: 4, padding: '8px 12px',
    borderBottom: '1px solid #1f2937',
  },
  input: {
    flex: 1, background: '#1f2937', border: '1px solid #374151',
    borderRadius: 6, padding: '6px 10px', color: '#e5e7eb', fontSize: 12,
    outline: 'none',
  },
  searchBtn: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    padding: '6px 10px', color: '#e5e7eb', fontSize: 14, cursor: 'pointer',
  },
  results: { flex: 1, overflow: 'auto', padding: '4px 0' },
  loading: { color: '#6b7280', textAlign: 'center', padding: 16, fontSize: 12 },
  empty: { color: '#4b5563', textAlign: 'center', padding: 16, fontSize: 12 },
  resultItem: {
    padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #1f2937',
  },
  resultHeader: { display: 'flex', alignItems: 'center', gap: 4 },
  fileName: { fontSize: 13, fontWeight: 600, color: '#e5e7eb' },
  lineNumber: { fontSize: 11, color: '#6b7280' },
  filePath: { fontSize: 10, color: '#4b5563', marginTop: 2 },
  lineContent: {
    fontSize: 11, color: '#9ca3af', marginTop: 4,
    background: '#1f2937', padding: '4px 8px', borderRadius: 4,
    fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
}
