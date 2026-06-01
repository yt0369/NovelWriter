import { useState, useEffect } from 'react'
import { ui } from '../../styles/ui'

interface ProjectStats {
  total_words: number
  total_chapters: number
  completed_chapters: number
  total_characters: number
  total_events: number
  total_foreshadows: number
  unresolved_foreshadows: number
}

interface Props {
  projectId: string
}

export function ProjectOverview({ projectId }: Props) {
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // 从多个 API 获取统计数据
    Promise.all([
      fetch(`/api/timeline/${projectId}/volumes`).then(r => r.json()).catch(() => []),
      fetch(`/api/timeline/${projectId}/chapters`).then(r => r.json()).catch(() => []),
      fetch(`/api/timeline/${projectId}/events`).then(r => r.json()).catch(() => []),
      fetch(`/api/characters/${projectId}`).then(r => r.json()).catch(() => []),
      fetch(`/api/foreshadowing/${projectId}`).then(r => r.json()).catch(() => []),
    ]).then(([volumes, chapters, events, characters, foreshadows]) => {
      const chaptersArr = Array.isArray(chapters) ? chapters : []
      const eventsArr = Array.isArray(events) ? events : []
      const charactersArr = Array.isArray(characters) ? characters : []
      const foreshadowsArr = Array.isArray(foreshadows) ? foreshadows : []

      setStats({
        total_words: chaptersArr.reduce((sum: number, ch: any) => sum + (ch.word_count || 0), 0),
        total_chapters: chaptersArr.length,
        completed_chapters: chaptersArr.filter((ch: any) => ch.status === '已完成').length,
        total_characters: charactersArr.length,
        total_events: eventsArr.length,
        total_foreshadows: foreshadowsArr.length,
        unresolved_foreshadows: foreshadowsArr.filter((f: any) => f.status !== '已回收').length,
      })
    }).finally(() => setLoading(false))
  }, [projectId])

  if (loading) {
    return (
      <div style={s.container}>
        <div style={s.loading}>加载中...</div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div style={s.container}>
        <div style={s.empty}>无法加载项目数据</div>
      </div>
    )
  }

  const progress = stats.total_chapters > 0
    ? Math.round((stats.completed_chapters / stats.total_chapters) * 100)
    : 0

  return (
    <div style={s.container}>
      <h3 style={s.title}>📊 项目概览</h3>

      {/* 进度条 */}
      <div style={s.progressSection}>
        <div style={s.progressHeader}>
          <span style={s.progressLabel}>写作进度</span>
          <span style={s.progressValue}>{progress}%</span>
        </div>
        <div style={s.progressBar}>
          <div style={{ ...s.progressFill, width: `${progress}%` }} />
        </div>
        <div style={s.progressDetail}>
          {stats.completed_chapters} / {stats.total_chapters} 章已完成
        </div>
      </div>

      {/* 统计卡片 */}
      <div style={s.statsGrid}>
        <StatCard icon="📝" label="总字数" value={stats.total_words.toLocaleString()} color="#14b8a6" />
        <StatCard icon="📚" label="章节数" value={stats.total_chapters} color="#8b5cf6" />
        <StatCard icon="👥" label="角色数" value={stats.total_characters} color="#f472b6" />
        <StatCard icon="⚡" label="事件数" value={stats.total_events} color="#f59e0b" />
        <StatCard icon="🔮" label="伏笔数" value={stats.total_foreshadows} color="#6366f1" />
        <StatCard icon="❓" label="未回收伏笔" value={stats.unresolved_foreshadows} color="#ef4444" />
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: {
  icon: string
  label: string
  value: number | string
  color: string
}) {
  return (
    <div style={s.statCard}>
      <div style={{ ...s.statIcon, color }}>{icon}</div>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: {
    padding: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: ui.color.text,
    margin: '0 0 16px',
  },
  loading: {
    padding: 20,
    textAlign: 'center',
    color: ui.color.faint,
  },
  empty: {
    padding: 20,
    textAlign: 'center',
    color: ui.color.faint,
    fontSize: 13,
  },
  progressSection: {
    marginBottom: 20,
    padding: 12,
    background: ui.color.panelSoft,
    borderRadius: 8,
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 13,
    color: ui.color.text,
    fontWeight: 500,
  },
  progressValue: {
    fontSize: 14,
    fontWeight: 700,
    color: ui.color.primary,
  },
  progressBar: {
    height: 8,
    background: ui.color.bg,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: `linear-gradient(90deg, ${ui.color.primary}, #2dd4bf)`,
    borderRadius: 4,
    transition: 'width 0.3s ease',
  },
  progressDetail: {
    marginTop: 6,
    fontSize: 11,
    color: ui.color.faint,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  statCard: {
    background: ui.color.panelSoft,
    borderRadius: 8,
    padding: 12,
    textAlign: 'center',
  },
  statIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: ui.color.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: ui.color.faint,
  },
}
