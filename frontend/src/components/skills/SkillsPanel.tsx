import { useState, useEffect } from 'react'
import { SkillAssetsPanel } from './SkillAssetsPanel'
import { useEditorStore } from '../../stores/editorStore'
import { useSkillTriggerStore } from '../../stores/skillTriggerStore'

interface Skill {
  name: string
  display_name: string
  description: string
  keywords: string[]
  tools: string[]
  wing: string
  category?: string
  asset_path?: string
  active: boolean
}

interface Props {
  visible: boolean
  projectId: string
}

export function SkillsPanel({ visible, projectId }: Props) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { setActiveFile, setActiveContent, setIsDirty } = useEditorStore()
  const { activateSkill, deactivateSkill, isSkillActive, getSkillState } = useSkillTriggerStore()

  const handleEditSkill = async (skill: Skill) => {
    if (!skill.asset_path) return
    try {
      const relativePath = skill.asset_path.replace(/\\/g, '/').split('assets/').pop() || ''
      const res = await fetch(`/api/skills/asset-content?path=${encodeURIComponent(relativePath)}`)
      const data = await res.json()
      if (data.content !== undefined) {
        setActiveFile(`skills/${relativePath}`)
        setActiveContent(data.content)
        setIsDirty(false)
      }
    } catch {
      setError('技能文件加载失败')
    }
  }

  const fetchSkills = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/skills/?project_id=${encodeURIComponent(projectId)}`)
      if (!res.ok) throw new Error('技能列表加载失败')
      const data = await res.json()
      setSkills(data)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '技能列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible) fetchSkills()
  }, [visible, projectId])

  const toggleSkill = async (skill: Skill) => {
    const newActive = !skill.active
    setSkills(prev => prev.map(s => s.name === skill.name ? { ...s, active: newActive } : s))
    if (newActive) {
      activateSkill(skill.name, skill.display_name)
    } else {
      deactivateSkill(skill.name)
    }
    try {
      const res = await fetch(`/api/skills/${projectId}/${newActive ? 'activate' : 'deactivate'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_name: skill.name }),
      })
      if (!res.ok) throw new Error(newActive ? '技能激活失败' : '技能关闭失败')
      setError('')
    } catch {
      setSkills(prev => prev.map(s => s.name === skill.name ? { ...s, active: !newActive } : s))
      setError(newActive ? '技能激活失败' : '技能关闭失败')
    }
  }

  if (!visible) return null

  const wingColor: Record<string, string> = {
    '世界': '#60a5fa',
    '角色': '#f472b6',
    '剧情': '#a78bfa',
    '灵感': '#fbbf24',
    '设定': '#34d399',
    '物品': '#fb923c',
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>写作技能</span>
        <button style={styles.refreshBtn} onClick={fetchSkills} disabled={loading}>
          {loading ? '...' : '刷新'}
        </button>
      </div>

      <div style={styles.hint}>
        技能会在对话中自动激活，也可手动切换
      </div>
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.list}>
        {Object.entries(groupSkills(skills)).map(([category, items]) => (
          <div key={category}>
            <div style={styles.categoryTitle}>{category}</div>
            {items.map(skill => (
          <div
            key={skill.name}
            style={{
              ...styles.skillCard,
              border: skill.active ? '1px solid #14b8a6' : '1px solid #1f2937',
              background: skill.active ? '#1a2e2a' : '#111827',
            }}
          >
            <div style={styles.skillHeader}>
              <span style={styles.skillName}>{skill.display_name}</span>
              <div style={styles.headerRight}>
                {skill.asset_path && (
                  <button
                    style={styles.editBtn}
                    onClick={(e) => { e.stopPropagation(); handleEditSkill(skill) }}
                    title="编辑技能文件"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
                <span
                  style={styles.statusDot}
                  onClick={(e) => { e.stopPropagation(); toggleSkill(skill) }}
                />
              </div>
            </div>
            <div style={styles.skillDesc} onClick={() => toggleSkill(skill)}>{skill.description}</div>
            <div style={styles.skillMeta} onClick={() => toggleSkill(skill)}>
              {skill.category && <span style={styles.categoryTag}>{skill.category}</span>}
              {skill.wing && (
                <span style={{
                  ...styles.wingTag,
                  background: wingColor[skill.wing] || '#6b7280',
                  opacity: 0.2,
                  color: wingColor[skill.wing] || '#6b7280',
                }}>
                  {skill.wing}
                </span>
              )}
              <span style={styles.toolsCount}>{skill.tools.length} 个工具</span>
              {skill.asset_path && <span style={styles.toolsCount}>asset</span>}
            </div>
          </div>
            ))}
          </div>
        ))}
        <SkillAssetsPanel projectId={projectId} />
      </div>
    </div>
  )
}

function groupSkills(skills: Skill[]) {
  return skills.reduce<Record<string, Skill[]>>((acc, skill) => {
    const category = skill.category || '内置技能'
    acc[category] = acc[category] || []
    acc[category].push(skill)
    return acc
  }, {})
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#111827',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid #1f2937',
  },
  title: { fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  refreshBtn: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    padding: '4px 10px', color: '#14b8a6', fontSize: 12, cursor: 'pointer',
  },
  hint: {
    fontSize: 11, color: '#6b7280', padding: '8px 16px', lineHeight: 1.4,
  },
  error: {
    fontSize: 12, color: '#fca5a5', padding: '0 16px 8px',
  },
  list: { flex: 1, overflow: 'auto', padding: '0 12px 12px' },
  categoryTitle: { color: '#14b8a6', fontSize: 12, fontWeight: 700, margin: '10px 2px 6px' },
  skillCard: {
    borderRadius: 8, padding: '10px 14px', marginBottom: 8,
    cursor: 'pointer', transition: 'all 0.15s',
  },
  skillHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  headerRight: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  skillName: { fontSize: 14, fontWeight: 600, color: '#e5e7eb' },
  editBtn: {
    background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer',
    padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'color 0.15s',
  },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, cursor: 'pointer' },
  skillDesc: { fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.4 },
  skillMeta: { display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' },
  wingTag: {
    fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
  },
  categoryTag: {
    fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#1e3a5f', color: '#93c5fd',
  },
  toolsCount: { fontSize: 11, color: '#6b7280' },
}
