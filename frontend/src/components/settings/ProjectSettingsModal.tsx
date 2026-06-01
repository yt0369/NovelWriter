import { useState, useEffect } from 'react'
import {
  CORE_GAMEPLAY_TAGS,
  NARRATIVE_ELEMENT_TAGS,
  STYLE_TONE_TAGS,
  ROMANCE_LINE_TAGS,
} from '../../constants/projectTags'
import { MemoryAdminPanel } from '../memory/MemoryAdminPanel'

interface Props {
  projectId: string
  onClose: () => void
}

interface ProjectData {
  name: string
  description: string
  genre: string
  words_per_chapter: number
  target_chapters: number
  chapters_per_volume: number
  core_gameplay_tags: string[]
  narrative_element_tags: string[]
  style_tone_tags: string[]
  romance_line_tags: string[]
}

const TAG_CONFIGS = [
  { key: 'core_gameplay_tags' as const, title: '核心玩法', tags: CORE_GAMEPLAY_TAGS, color: '#14b8a6' },
  { key: 'narrative_element_tags' as const, title: '叙事元素', tags: NARRATIVE_ELEMENT_TAGS, color: '#8b5cf6' },
  { key: 'style_tone_tags' as const, title: '风格基调', tags: STYLE_TONE_TAGS, color: '#16a34a' },
  { key: 'romance_line_tags' as const, title: '感情线', tags: ROMANCE_LINE_TAGS, color: '#f472b6' },
]

function TagSection({ title, tags, selected, setter, color }: {
  title: string
  tags: readonly string[]
  selected: string[]
  setter: (v: string[]) => void
  color: string
}) {
  const [customInput, setCustomInput] = useState('')

  const toggleTag = (tag: string) => {
    setter(selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag])
  }

  const addCustomTag = () => {
    const trimmed = customInput.trim()
    if (trimmed && !selected.includes(trimmed)) {
      setter([...selected, trimmed])
    }
    setCustomInput('')
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={s.label}>{title}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {tags.map(tag => (
          <button key={tag} onClick={() => toggleTag(tag)} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 13, border: 'none', cursor: 'pointer',
            background: selected.includes(tag) ? color : '#1f2937',
            color: selected.includes(tag) ? '#fff' : '#9ca3af',
            transition: 'all 0.15s',
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
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag() } }}
        />
        <button style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 12, border: 'none', cursor: 'pointer',
          background: color, color: '#fff', whiteSpace: 'nowrap',
        }} onClick={addCustomTag}>添加</button>
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

export function ProjectSettingsModal({ projectId, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [showPolishModal, setShowPolishModal] = useState(false)
  const [polishInstruction, setPolishInstruction] = useState('')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [genre, setGenre] = useState('')
  const [wordsPerChapter, setWordsPerChapter] = useState(3000)
  const [targetChapters, setTargetChapters] = useState(100)
  const [chaptersPerVolume, setChaptersPerVolume] = useState(10)
  const [coreGameplay, setCoreGameplay] = useState<string[]>([])
  const [narrativeElements, setNarrativeElements] = useState<string[]>([])
  const [styleTone, setStyleTone] = useState<string[]>([])
  const [romanceLine, setRomanceLine] = useState<string[]>([])

  const tagSetters: Record<string, (v: string[]) => void> = {
    core_gameplay_tags: setCoreGameplay,
    narrative_element_tags: setNarrativeElements,
    style_tone_tags: setStyleTone,
    romance_line_tags: setRomanceLine,
  }

  const tagValues: Record<string, string[]> = {
    core_gameplay_tags: coreGameplay,
    narrative_element_tags: narrativeElements,
    style_tone_tags: styleTone,
    romance_line_tags: romanceLine,
  }

  useEffect(() => {
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(data => {
        setName(data.name || '')
        setDescription(data.description || '')
        setGenre(data.genre || '')
        setWordsPerChapter(data.words_per_chapter ?? 3000)
        setTargetChapters(data.target_chapters ?? 100)
        setChaptersPerVolume(data.chapters_per_volume ?? 10)
        const tags = data.tags || {}
        if (tags.core_gameplay) setCoreGameplay(tags.core_gameplay)
        if (tags.narrative_elements) setNarrativeElements(tags.narrative_elements)
        if (tags.style_tone) setStyleTone(tags.style_tone)
        if (tags.romance_line) setRomanceLine(tags.romance_line)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          genre,
          words_per_chapter: wordsPerChapter,
          target_chapters: targetChapters,
          chapters_per_volume: chaptersPerVolume,
          core_gameplay_tags: coreGameplay,
          narrative_element_tags: narrativeElements,
          style_tone_tags: styleTone,
          romance_line_tags: romanceLine,
        }),
      })
      onClose()
    } catch {
      alert('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const handlePolish = async () => {
    setPolishing(true)
    try {
      const res = await fetch('/api/agent/polish-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          genre,
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
      setPolishing(false)
    }
  }

  if (loading) {
    return (
      <div style={s.overlay}>
        <div style={s.modal}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200, color: '#6b7280' }}>
            加载中...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>项目设置</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button style={s.polishBtn} onClick={() => setShowPolishModal(true)} disabled={polishing}>
              ✨ AI润色
            </button>
            <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 20, color: '#6b7280' }}>&times;</span>
          </div>
        </div>

        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>项目名称</label>
            <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="输入项目名称" />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>题材</label>
            <input style={s.input} value={genre} onChange={e => setGenre(e.target.value)} placeholder="例如：玄幻、都市、科幻" />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={s.label}>简介 / 核心梗</label>
            <textarea
              style={{ ...s.input, height: 80, resize: 'vertical' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="一句话描述你的故事核心..."
            />
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>每卷章节数</label>
              <input style={s.input} type="number" value={chaptersPerVolume} onChange={e => setChaptersPerVolume(+e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>单章字数</label>
              <input style={s.input} type="number" value={wordsPerChapter} onChange={e => setWordsPerChapter(+e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>目标章节数</label>
              <input style={s.input} type="number" value={targetChapters} onChange={e => setTargetChapters(+e.target.value)} />
            </div>
          </div>

          <div style={{ margin: '20px 0 8px', fontSize: 14, fontWeight: 600, color: '#d1d5db', borderBottom: '1px solid #1f2937', paddingBottom: 8 }}>
            标签设定
          </div>

          {TAG_CONFIGS.map(cfg => (
            <TagSection
              key={cfg.key}
              title={cfg.title}
              tags={cfg.tags}
              selected={tagValues[cfg.key]}
              setter={tagSetters[cfg.key]}
              color={cfg.color}
            />
          ))}

          <div style={{ margin: '20px 0 8px', fontSize: 14, fontWeight: 600, color: '#d1d5db', borderBottom: '1px solid #1f2937', paddingBottom: 8 }}>
            Embedding 管理
          </div>
          <MemoryAdminPanel projectId={projectId} />
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #1f2937', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button style={s.cancelBtn} onClick={onClose}>取消</button>
          <button style={s.saveBtn} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
        </div>

        {showPolishModal && (
          <div style={s.polishOverlay}>
            <div style={s.polishCard}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', marginBottom: 12 }}>✨ AI润色项目信息</h3>
              <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>输入额外指令，AI将根据当前表单内容生成润色建议</p>
              <textarea
                style={{ ...s.input, height: 80, marginBottom: 16, resize: 'vertical' }}
                value={polishInstruction}
                onChange={e => setPolishInstruction(e.target.value)}
                placeholder="例如：让书名更有吸引力，增加悬疑元素..."
              />
              <div style={{ display: 'flex', gap: 12 }}>
                <button style={{ ...s.saveBtn, flex: 1 }} onClick={handlePolish} disabled={polishing}>
                  {polishing ? '生成中...' : '生成'}
                </button>
                <button style={s.cancelBtn} onClick={() => setShowPolishModal(false)} disabled={polishing}>取消</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modal: { background: '#111827', borderRadius: 16, width: 560, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid #1f2937' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #1f2937' },
  label: { display: 'block', fontSize: 13, color: '#9ca3af', marginBottom: 6 },
  input: { width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 12px', color: '#e5e7eb', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  cancelBtn: { background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 8, padding: '10px 20px', cursor: 'pointer' },
  saveBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer' },
  polishBtn: { background: 'linear-gradient(135deg, #14b8a6, #2dd4bf)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  polishOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200 },
  polishCard: { background: '#111827', borderRadius: 16, padding: 24, width: 480, maxWidth: '90vw', border: '1px solid #374151' },
}
