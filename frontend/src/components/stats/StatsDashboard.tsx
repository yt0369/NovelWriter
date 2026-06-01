import { useState, useEffect } from 'react'

interface Props {
  projectId: string
  onClose: () => void
}

interface Stats {
  project_name: string
  total_chars: number
  total_words: number
  total_files: number
  md_files: number
  chapter_files: number
  target_chapters: number
  target_words: number
  progress_percent: number
}

export function StatsDashboard({ projectId, onClose }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects/' + projectId + '/stats')
      .then(r => r.json())
      .then(data => { setStats(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  const formatNum = (n: number) => n.toLocaleString('zh-CN')

  const handleExport = async () => {
    const res = await fetch('/api/projects/' + projectId + '/export')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (stats?.project_name || projectId) + '.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  const progressStyle = {
    width: String(stats?.progress_percent || 0) + '%',
    height: '100%',
    background: 'linear-gradient(90deg, #14b8a6, #2dd4bf)',
    borderRadius: 8,
    transition: 'width 0.3s',
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>项目统计</h2>
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, color: '#6b7280' }}>&times;</span>
        </div>

        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: 40 }}>加载中...</div>
          ) : stats ? (
            <>
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, color: '#9ca3af' }}>创作进度</span>
                  <span style={{ fontSize: 14, color: '#14b8a6', fontWeight: 600 }}>{stats.progress_percent}%</span>
                </div>
                <div style={{ background: '#1f2937', borderRadius: 8, height: 12, overflow: 'hidden' }}>
                  <div style={progressStyle} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#6b7280' }}>
                  <span>{formatNum(stats.total_words)} 字</span>
                  <span>目标 {formatNum(stats.target_words)} 字</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                <StatCard label="总字数" value={formatNum(stats.total_words)} color="#14b8a6" />
                <StatCard label="章节数" value={stats.chapter_files + '/' + stats.target_chapters} color="#8b5cf6" />
                <StatCard label="Markdown文件" value={String(stats.md_files)} color="#16a34a" />
                <StatCard label="总文件数" value={String(stats.total_files)} color="#f472b6" />
              </div>

              <button style={s.exportBtn} onClick={handleExport}>
                导出项目 (ZIP)
              </button>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: 40 }}>加载失败</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string, value: string, color: string }) {
  const borderStyle = '1px solid ' + color + '33'
  return (
    <div style={{
      background: '#1f2937', borderRadius: 12, padding: 16,
      border: borderStyle,
    }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modal: { background: '#111827', borderRadius: 16, width: 480, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid #1f2937' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #1f2937' },
  exportBtn: {
    width: '100%', background: '#1f2937', color: '#d1d5db', border: '1px solid #374151',
    borderRadius: 8, padding: '12px 20px', cursor: 'pointer', fontSize: 14,
  },
}
