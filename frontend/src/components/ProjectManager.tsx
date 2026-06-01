import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import { GENRE_PRESETS } from '../constants/genrePresets'
import { CORE_GAMEPLAY_TAGS, NARRATIVE_ELEMENT_TAGS, STYLE_TONE_TAGS, ROMANCE_LINE_TAGS } from '../constants/projectTags'
import { AISettingsModal } from './settings/AISettingsModal'
import { ProjectInitWizard } from './ProjectInitWizard'
import { APP_VERSION } from '../version'
import { ui } from '../styles/ui'

export function ProjectManager() {
  const { projects, fetchProjects, setCurrentProject, deleteProject, updateProject } = useProjectStore()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const [editProject, setEditProject] = useState<{ id: string; name: string; description: string; genre: string; core_gameplay: string[]; narrative_elements: string[]; style_tone: string[]; romance_line: string[] } | null>(null)

  // Project form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState('')
  const [wordsPerChapter, setWordsPerChapter] = useState(3000)
  const [targetChapters, setTargetChapters] = useState(100)
  const [chaptersPerVolume, setChaptersPerVolume] = useState(10)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [pleasureRhythm, setPleasureRhythm] = useState({ small: 3, medium: 10, large: 30 })
  const [pleasureRhythmEnabled, setPleasureRhythmEnabled] = useState(true)
  const [coreGameplay, setCoreGameplay] = useState<string[]>([])
  const [narrativeElements, setNarrativeElements] = useState<string[]>([])
  const [styleTone, setStyleTone] = useState<string[]>([])
  const [romanceLine, setRomanceLine] = useState<string[]>([])
  const [showPolishModal, setShowPolishModal] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 保存和恢复滚动位置，防止标签点击后跳到顶部
  const saveScrollPos = () => {
    if (scrollContainerRef.current) {
      sessionStorage.setItem('pm_scroll', String(scrollContainerRef.current.scrollTop))
    }
  }
  useEffect(() => {
    const saved = sessionStorage.getItem('pm_scroll')
    if (saved && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = parseInt(saved, 10)
      sessionStorage.removeItem('pm_scroll')
    }
  })
  const [polishInstruction, setPolishInstruction] = useState('')
  const [isPolishing, setIsPolishing] = useState(false)

  useEffect(() => { fetchProjects() }, [])

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = GENRE_PRESETS.find(p => p.id === presetId)
    if (preset) {
      setGenre(preset.name)
    }
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    const res = await fetch('/api/projects/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, description, genre, words_per_chapter: wordsPerChapter,
        target_chapters: targetChapters, chapters_per_volume: chaptersPerVolume,
        preset_id: selectedPresetId,
        pleasure_rhythm: pleasureRhythmEnabled ? pleasureRhythm : null,
        core_gameplay_tags: coreGameplay, narrative_element_tags: narrativeElements,
        style_tone_tags: styleTone, romance_line_tags: romanceLine,
      }),
    })
    const project = await res.json()
    setCurrentProject(project)
    navigate(`/project/${project.id}`)
  }

  const toggleTag = (tag: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(tag) ? list.filter(t => t !== tag) : [...list, tag])
  }

  const addCustomTag = (tag: string, list: string[], setter: (v: string[]) => void) => {
    const trimmed = tag.trim()
    if (trimmed && !list.includes(trimmed)) {
      setter([...list, trimmed])
    }
  }

  const handleRunPolish = async () => {
    setIsPolishing(true)
    try {
      const res = await fetch('/api/agent/polish-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, description, genre,
          target_chapters: targetChapters,
          words_per_chapter: wordsPerChapter,
          core_gameplay: coreGameplay,
          narrative_elements: narrativeElements,
          style_tone: styleTone,
          romance_line: romanceLine,
          instruction: polishInstruction,
        }),
      })
      const data = await res.json()
      if (data.name) setName(data.name)
      if (data.description) setDescription(data.description)
      if (data.core_gameplay) setCoreGameplay(data.core_gameplay)
      if (data.narrative_elements) setNarrativeElements(data.narrative_elements)
      if (data.style_tone) setStyleTone(data.style_tone)
      if (data.romance_line) setRomanceLine(data.romance_line)
      setShowPolishModal(false)
    } catch {
      alert('AI润色失败，请检查AI配置')
    } finally {
      setIsPolishing(false)
    }
  }

  const resetForm = () => {
    setName(''); setDescription(''); setGenre(''); setSelectedPresetId('')
    setWordsPerChapter(3000); setTargetChapters(100); setChaptersPerVolume(10)
    setPleasureRhythm({ small: 3, medium: 10, large: 30 }); setPleasureRhythmEnabled(true)
    setCoreGameplay([]); setNarrativeElements([]); setStyleTone([]); setRomanceLine([])
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/projects/import', { method: 'POST', body: formData })
      if (res.ok) {
        fetchProjects()
      }
    } catch {}
    e.target.value = ''
  }

  const TagSection = ({ title, tags, selected, setter, color }: { title: string, tags: readonly string[], selected: string[], setter: (v: string[]) => void, color: string }) => {
    const [customInput, setCustomInput] = useState('')
    return (
    <div style={{ marginBottom: 16 }}>
      <label style={s.label}>{title}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {tags.map(tag => (
          <button key={tag} onClick={() => { saveScrollPos(); toggleTag(tag, selected, setter) }} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 13, border: 'none', cursor: 'pointer',
            background: selected.includes(tag) ? color : '#1f2937',
            color: selected.includes(tag) ? '#fff' : '#9ca3af',
          }}>{tag}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          placeholder="自定义标签..."
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          style={{ ...s.input, flex: 1, padding: '6px 10px', fontSize: 12 }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(customInput, selected, setter); setCustomInput('') } }}
        />
        <button style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 12, border: 'none', cursor: 'pointer',
          background: color, color: '#fff', whiteSpace: 'nowrap',
        }} onClick={() => { addCustomTag(customInput, selected, setter); setCustomInput('') }}>添加</button>
      </div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {selected.map(tag => (
            <span key={tag} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4, fontSize: 12,
              background: `${color}33`, border: `1px solid ${color}66`, color,
            }}>
              {tag}
              <span onClick={() => setter(selected.filter(t => t !== tag))} style={{ cursor: 'pointer', fontWeight: 700 }}>×</span>
            </span>
          ))}
        </div>
      )}
    </div>
    )
  }

  return (
    <div style={s.container}>
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={s.title}>NovelWriter</h1>
            <p style={s.subtitle}>AI驱动的小说写作助手 · v{APP_VERSION}</p>
          </div>
          <button style={s.settingsBtn} onClick={() => setShowSettings(true)}>AI配置</button>
        </div>

        {!showCreate ? (
          <>
            <button style={s.primaryBtn} onClick={() => { resetForm(); setShowCreate(true) }}>创建新项目</button>
            <button style={s.wizardBtn} onClick={() => setShowWizard(true)}>AI 辅助创建</button>
            <div style={{ marginTop: 12 }}>
              <label style={{ ...s.secondaryBtn, display: 'block', textAlign: 'center', cursor: 'pointer' }}>
                导入项目 (ZIP)
                <input type="file" accept=".zip" onChange={handleImport} style={{ display: 'none' }} />
              </label>
            </div>
            {projects.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h3 style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>最近的项目</h3>
                {projects.map(p => (
                  <div key={p.id} style={s.projectItem} onClick={() => { setCurrentProject(p); navigate(`/project/${p.id}`) }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
                        {p.description && <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 4 }}>{p.description}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                        <button
                          style={s.iconBtn}
                          onClick={e => {
                            e.stopPropagation()
                            const tags = (p as any).tags || {}
                            setEditProject({
                              id: p.id, name: p.name, description: p.description || '',
                              genre: p.genre || '',
                              core_gameplay: tags.core_gameplay || [],
                              narrative_elements: tags.narrative_elements || [],
                              style_tone: tags.style_tone || [],
                              romance_line: tags.romance_line || [],
                            })
                          }}
                          title="编辑"
                        >✏</button>
                        <button
                          style={{ ...s.iconBtn, color: '#dc2626' }}
                          onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: p.id, name: p.name }) }}
                          title="删除"
                        >🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div ref={scrollContainerRef} style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>创建项目</h2>
              <button style={s.polishBtn} onClick={() => setShowPolishModal(true)}>✨ AI润色</button>
            </div>
            {/* 书名 */}
            <div style={{ marginBottom: 16 }}>
              <label style={s.label}>书名 <span style={{ color: '#dc2626' }}>*</span></label>
              <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="我的小说" />
            </div>

            {/* 题材预设 */}
            <div style={{ marginBottom: 16 }}>
              <label style={s.label}>题材预设</label>
              <select style={s.input} value={selectedPresetId} onChange={e => handlePresetChange(e.target.value)}>
                <option value="">不使用预设</option>
                {GENRE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name} - {p.description}</option>)}
              </select>
            </div>

            {/* 基本设置 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={s.label}>每卷章节数</label>
                <input style={s.input} type="number" value={chaptersPerVolume} onChange={e => setChaptersPerVolume(+e.target.value)} />
              </div>
              <div>
                <label style={s.label}>单章字数</label>
                <input style={s.input} type="number" value={wordsPerChapter} onChange={e => setWordsPerChapter(+e.target.value)} />
              </div>
              <div>
                <label style={s.label}>目标章节</label>
                <input style={s.input} type="number" value={targetChapters} onChange={e => setTargetChapters(+e.target.value)} />
              </div>
            </div>

            {/* 爽点节奏 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ ...s.label, marginBottom: 0 }}>爽点节奏</label>
                <div onClick={() => setPleasureRhythmEnabled(!pleasureRhythmEnabled)} style={{
                  width: 44, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative',
                  background: pleasureRhythmEnabled ? '#14b8a6' : '#4b5563', transition: 'background 0.2s',
                }}>
                  <div style={{
                    position: 'absolute', top: 2, width: 20, height: 20, borderRadius: 10, background: '#fff',
                    left: pleasureRhythmEnabled ? 22 : 2, transition: 'left 0.2s',
                  }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, opacity: pleasureRhythmEnabled ? 1 : 0.4 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>小爽点(章)</label>
                  <input style={s.input} type="number" value={pleasureRhythm.small} onChange={e => setPleasureRhythm({ ...pleasureRhythm, small: +e.target.value })} disabled={!pleasureRhythmEnabled} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>中爽点(章)</label>
                  <input style={s.input} type="number" value={pleasureRhythm.medium} onChange={e => setPleasureRhythm({ ...pleasureRhythm, medium: +e.target.value })} disabled={!pleasureRhythmEnabled} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>大爽点(章)</label>
                  <input style={s.input} type="number" value={pleasureRhythm.large} onChange={e => setPleasureRhythm({ ...pleasureRhythm, large: +e.target.value })} disabled={!pleasureRhythmEnabled} />
                </div>
              </div>
            </div>

            {/* 简介 */}
            <div style={{ marginBottom: 16 }}>
              <label style={s.label}>简介 / 核心梗</label>
              <textarea style={{ ...s.input, height: 80 }} value={description} onChange={e => setDescription(e.target.value)} placeholder="一句话描述你的故事核心..." />
            </div>

            {/* 标签 */}
            <TagSection title="核心玩法" tags={CORE_GAMEPLAY_TAGS} selected={coreGameplay} setter={setCoreGameplay} color="#14b8a6" />
            <TagSection title="叙事元素" tags={NARRATIVE_ELEMENT_TAGS} selected={narrativeElements} setter={setNarrativeElements} color="#8b5cf6" />
            <TagSection title="风格基调" tags={STYLE_TONE_TAGS} selected={styleTone} setter={setStyleTone} color="#16a34a" />
            <TagSection title="感情线" tags={ROMANCE_LINE_TAGS} selected={romanceLine} setter={setRomanceLine} color="#f472b6" />

            <div style={{ display: 'flex', gap: 12, marginTop: 24, position: 'sticky', bottom: 0, background: '#111827', padding: '12px 0' }}>
              <button style={s.primaryBtn} onClick={handleCreate} disabled={!name.trim()}>创建项目</button>
              <button style={s.secondaryBtn} onClick={() => setShowCreate(false)}>取消</button>
            </div>
          </div>
        )}
      </div>

      {showSettings && <AISettingsModal onClose={() => setShowSettings(false)} />}
      {showWizard && <ProjectInitWizard onClose={() => setShowWizard(false)} onCreated={project => { setCurrentProject(project); navigate(`/project/${project.id}`) }} />}

      {deleteConfirm && (
        <div style={s.modalOverlay}>
          <div style={s.modalCard}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', marginBottom: 12 }}>确认删除</h3>
            <p style={{ fontSize: 14, color: '#9ca3af', marginBottom: 20 }}>
              确定要删除项目「{deleteConfirm.name}」吗？此操作不可撤销。
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                style={{ ...s.primaryBtn, background: '#dc2626', flex: 1 }}
                onClick={async () => { await deleteProject(deleteConfirm.id); setDeleteConfirm(null) }}
              >
                删除
              </button>
              <button style={s.secondaryBtn} onClick={() => setDeleteConfirm(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {editProject && (
        <div style={s.modalOverlay}>
          <div style={{ ...s.modalCard, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', margin: 0 }}>编辑项目</h3>
              <button style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }} onClick={() => setEditProject(null)}>✕</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>项目名称</label>
              <input
                style={s.input}
                value={editProject.name}
                onChange={e => setEditProject({ ...editProject, name: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>题材</label>
              <input
                style={s.input}
                value={editProject.genre}
                onChange={e => setEditProject({ ...editProject, genre: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={s.label}>简介</label>
              <textarea
                style={{ ...s.input, height: 80, resize: 'vertical' }}
                value={editProject.description}
                onChange={e => setEditProject({ ...editProject, description: e.target.value })}
              />
            </div>
            <TagSection title="核心玩法" tags={CORE_GAMEPLAY_TAGS} selected={editProject.core_gameplay} setter={v => setEditProject({ ...editProject, core_gameplay: v })} color="#14b8a6" />
            <TagSection title="叙事元素" tags={NARRATIVE_ELEMENT_TAGS} selected={editProject.narrative_elements} setter={v => setEditProject({ ...editProject, narrative_elements: v })} color="#8b5cf6" />
            <TagSection title="风格基调" tags={STYLE_TONE_TAGS} selected={editProject.style_tone} setter={v => setEditProject({ ...editProject, style_tone: v })} color="#16a34a" />
            <TagSection title="感情线" tags={ROMANCE_LINE_TAGS} selected={editProject.romance_line} setter={v => setEditProject({ ...editProject, romance_line: v })} color="#f472b6" />
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button
                style={{ ...s.primaryBtn, flex: 1 }}
                onClick={async () => {
                  await fetch(`/api/projects/${editProject.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      name: editProject.name,
                      description: editProject.description,
                      genre: editProject.genre,
                      core_gameplay_tags: editProject.core_gameplay,
                      narrative_element_tags: editProject.narrative_elements,
                      style_tone_tags: editProject.style_tone,
                      romance_line_tags: editProject.romance_line,
                    }),
                  })
                  fetchProjects()
                  setEditProject(null)
                }}
                disabled={!editProject.name.trim()}
              >
                保存
              </button>
              <button style={s.secondaryBtn} onClick={() => setEditProject(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {showPolishModal && (
        <div style={s.modalOverlay}>
          <div style={s.modalCard}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', marginBottom: 12 }}>✨ AI润色项目信息</h3>
            <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>输入额外指令，AI将根据当前表单内容生成润色建议</p>
            <textarea
              style={{ ...s.input, height: 80, marginBottom: 16, resize: 'vertical' }}
              value={polishInstruction}
              onChange={e => setPolishInstruction(e.target.value)}
              placeholder="例如：让书名更有吸引力，增加悬疑元素..."
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <button style={{ ...s.primaryBtn, flex: 1 }} onClick={handleRunPolish} disabled={isPolishing}>
                {isPolishing ? '生成中...' : '生成'}
              </button>
              <button style={s.secondaryBtn} onClick={() => setShowPolishModal(false)} disabled={isPolishing}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: '100vh', background: '#0f1117', color: '#e5e7eb', padding: '40px 16px' },
  card: { background: '#111827', borderRadius: 16, padding: 32, width: 640, maxWidth: '90vw' },
  title: { fontSize: 28, fontWeight: 700, marginBottom: 4, color: '#f3f4f6' },
  subtitle: { color: '#6b7280', fontSize: 14 },
  primaryBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, cursor: 'pointer', width: '100%' },
  wizardBtn: { background: 'linear-gradient(135deg, #14b8a6, #2dd4bf)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 15, cursor: 'pointer', width: '100%', marginTop: 10 },
  secondaryBtn: { background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 8, padding: '12px 24px', fontSize: 15, cursor: 'pointer', flex: 1 },
  settingsBtn: { background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  polishBtn: { background: 'linear-gradient(135deg, #14b8a6, #2dd4bf)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalCard: { background: '#111827', borderRadius: 16, padding: 24, width: 480, maxWidth: '90vw', border: '1px solid #374151' },
  projectItem: { background: '#1f2937', borderRadius: 8, padding: 16, marginBottom: 8, cursor: 'pointer' },
  iconBtn: { background: 'none', border: 'none', color: '#6b7280', fontSize: 14, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 },
  label: { display: 'block', fontSize: 13, color: '#9ca3af', marginBottom: 6 },
  input: { width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 12px', color: '#e5e7eb', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
}
