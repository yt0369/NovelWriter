import { useState } from 'react'
import { GENRE_PRESETS } from '../constants/genrePresets'

interface Props {
  onClose: () => void
  onCreated: (project: any) => void
}

type Step = 1 | 2 | 3 | 4

interface GeneratedContent {
  world: string
  characters: string
  outline: string
}

export function ProjectInitWizard({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [selectedGenre, setSelectedGenre] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [coreConcept, setCoreConcept] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedContent | null>(null)
  const [error, setError] = useState('')

  const selectedPreset = GENRE_PRESETS.find(p => p.id === selectedGenre)

  const canNext = () => {
    if (step === 1) return !!selectedGenre
    if (step === 2) return !!name.trim()
    if (step === 3) return !!generated
    return true
  }

  const handleNext = () => {
    if (step < 4) setStep((step + 1) as Step)
  }

  const handleBack = () => {
    if (step > 1) setStep((step - 1) as Step)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setError('')
    try {
      const res = await fetch('/api/agent/generate-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genre: selectedPreset?.name || '玄幻',
          name,
          description,
          core_concept: coreConcept,
          preset_id: selectedGenre,
        }),
      })
      const data = await res.json()
      setGenerated({
        world: data.world || '',
        characters: data.characters || '',
        outline: data.outline || '',
      })
      setStep(4)
    } catch {
      setError('AI 生成失败，请检查 AI 配置后重试')
    } finally {
      setGenerating(false)
    }
  }

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/projects/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          genre: selectedPreset?.name || '',
          preset_id: selectedGenre,
          words_per_chapter: 3000,
          target_chapters: 100,
          chapters_per_volume: 10,
          init_content: generated,
        }),
      })
      const project = await res.json()
      onCreated(project)
    } catch {
      setError('创建项目失败')
    }
  }

  const renderStepIndicator = () => (
    <div style={styles.stepIndicator}>
      {[1, 2, 3, 4].map(s => (
        <div key={s} style={styles.stepDotWrap}>
          <div style={{
            ...styles.stepDot,
            ...(s === step ? styles.stepDotActive : {}),
            ...(s < step ? styles.stepDotDone : {}),
          }}>
            {s < step ? '✓' : s}
          </div>
          {s < 4 && <div style={{
            ...styles.stepLine,
            ...(s < step ? styles.stepLineDone : {}),
          }} />}
        </div>
      ))}
    </div>
  )

  const renderStepLabels = () => (
    <div style={styles.stepLabels}>
      <span style={step === 1 ? styles.stepLabelActive : styles.stepLabel}>选择题材</span>
      <span style={step === 2 ? styles.stepLabelActive : styles.stepLabel}>基本信息</span>
      <span style={step === 3 ? styles.stepLabelActive : styles.stepLabel}>AI 生成</span>
      <span style={step === 4 ? styles.stepLabelActive : styles.stepLabel}>审核确认</span>
    </div>
  )

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>AI 辅助创建项目</span>
          <span style={styles.closeBtn} onClick={onClose}>✕</span>
        </div>

        {renderStepIndicator()}
        {renderStepLabels()}

        <div style={styles.body}>
          {step === 1 && (
            <div style={styles.genreGrid}>
              {GENRE_PRESETS.map(preset => (
                <div
                  key={preset.id}
                  style={{
                    ...styles.genreCard,
                    ...(selectedGenre === preset.id ? styles.genreCardSelected : {}),
                  }}
                  onClick={() => setSelectedGenre(preset.id)}
                >
                  <div style={styles.genreName}>{preset.name}</div>
                  <div style={styles.genreDesc}>{preset.description}</div>
                  <div style={styles.genreTag}>{preset.name}</div>
                </div>
              ))}
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <label style={styles.label}>项目名称 <span style={{ color: '#ef4444' }}>*</span></label>
                <input
                  style={styles.input}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="输入你的小说名称"
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={styles.label}>简介</label>
                <textarea
                  style={{ ...styles.input, minHeight: 80, resize: 'vertical' }}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="简要描述你的故事..."
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={styles.label}>核心概念</label>
                <textarea
                  style={{ ...styles.input, minHeight: 80, resize: 'vertical' }}
                  value={coreConcept}
                  onChange={e => setCoreConcept(e.target.value)}
                  placeholder="描述故事的核心设定、主角金手指、核心冲突等..."
                />
              </div>
              {selectedPreset && (
                <div style={styles.presetInfo}>
                  <span style={styles.presetBadge}>{selectedPreset.name}</span>
                  <span style={styles.presetDetail}>
                    {selectedPreset.description}
                  </span>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div style={styles.generateSection}>
              <div style={styles.generateInfo}>
                <div style={styles.generateItem}>
                  <span style={styles.generateLabel}>题材:</span>
                  <span style={styles.generateValue}>{selectedPreset?.name || '未选择'}</span>
                </div>
                <div style={styles.generateItem}>
                  <span style={styles.generateLabel}>名称:</span>
                  <span style={styles.generateValue}>{name}</span>
                </div>
                {coreConcept && (
                  <div style={styles.generateItem}>
                    <span style={styles.generateLabel}>核心概念:</span>
                    <span style={styles.generateValue}>{coreConcept}</span>
                  </div>
                )}
              </div>
              <button
                style={generating ? styles.generateBtnDisabled : styles.generateBtn}
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'AI 正在生成...' : '开始 AI 生成'}
              </button>
              {error && <div style={styles.errorText}>{error}</div>}
            </div>
          )}

          {step === 4 && generated && (
            <div style={styles.reviewSection}>
              <div style={styles.reviewBlock}>
                <div style={styles.reviewTitle}>世界观设定</div>
                <div style={styles.reviewContent}>{generated.world || '（无内容）'}</div>
              </div>
              <div style={styles.reviewBlock}>
                <div style={styles.reviewTitle}>角色设定</div>
                <div style={styles.reviewContent}>{generated.characters || '（无内容）'}</div>
              </div>
              <div style={styles.reviewBlock}>
                <div style={styles.reviewTitle}>大纲</div>
                <div style={styles.reviewContent}>{generated.outline || '（无内容）'}</div>
              </div>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          {step > 1 && (
            <button style={styles.backBtn} onClick={handleBack}>上一步</button>
          )}
          <div style={{ flex: 1 }} />
          {step < 3 && (
            <button
              style={canNext() ? styles.nextBtn : styles.nextBtnDisabled}
              onClick={handleNext}
              disabled={!canNext()}
            >
              下一步
            </button>
          )}
          {step === 3 && !generated && (
            <button
              style={generating ? styles.nextBtnDisabled : styles.nextBtn}
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? '生成中...' : '生成并继续'}
            </button>
          )}
          {step === 4 && (
            <button style={styles.createBtn} onClick={handleCreate}>
              确认创建
            </button>
          )}
          {error && step === 4 && (
            <button style={styles.retryBtn} onClick={handleGenerate}>
              重新生成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200,
  },
  modal: {
    background: '#1a1a2e', borderRadius: 16, width: 640, maxWidth: '90vw',
    maxHeight: '85vh', display: 'flex', flexDirection: 'column',
    border: '1px solid #2a2a3e',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 24px', borderBottom: '1px solid #2a2a3e',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#e0e0e0' },
  closeBtn: { cursor: 'pointer', color: '#888', fontSize: 18 },
  stepIndicator: {
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    padding: '16px 24px 0',
  },
  stepDotWrap: {
    display: 'flex', alignItems: 'center',
  },
  stepDot: {
    width: 28, height: 28, borderRadius: '50%', background: '#2a2a3e',
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    fontSize: 12, color: '#888', fontWeight: 600, flexShrink: 0,
  },
  stepDotActive: {
    background: '#4f46e5', color: '#fff',
  },
  stepDotDone: {
    background: '#22c55e', color: '#fff',
  },
  stepLine: {
    width: 60, height: 2, background: '#2a2a3e',
  },
  stepLineDone: {
    background: '#22c55e',
  },
  stepLabels: {
    display: 'flex', justifyContent: 'center', gap: 44,
    padding: '6px 24px 12px', fontSize: 11,
  },
  stepLabel: { color: '#555' },
  stepLabelActive: { color: '#a78bfa', fontWeight: 600 },
  body: {
    flex: 1, overflow: 'auto', padding: '0 24px 16px',
  },
  genreGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
  },
  genreCard: {
    background: '#2a2a3e', borderRadius: 10, padding: 14, cursor: 'pointer',
    border: '2px solid transparent', transition: 'border-color 0.2s',
  },
  genreCardSelected: {
    borderColor: '#4f46e5', background: '#2a2a4e',
  },
  genreName: { fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 4 },
  genreDesc: { fontSize: 12, color: '#888', marginBottom: 6 },
  genreTag: {
    display: 'inline-block', fontSize: 10, background: '#4f46e5', color: '#fff',
    padding: '1px 6px', borderRadius: 4,
  },
  label: { display: 'block', fontSize: 13, color: '#aaa', marginBottom: 6 },
  input: {
    width: '100%', background: '#2a2a3e', border: '1px solid #3a3a5e',
    borderRadius: 8, padding: '10px 12px', color: '#e0e0e0', fontSize: 14,
    outline: 'none', boxSizing: 'border-box',
  },
  presetInfo: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    background: '#2a2a3e', borderRadius: 8,
  },
  presetBadge: {
    fontSize: 12, background: '#4f46e5', color: '#fff', padding: '2px 8px', borderRadius: 4,
  },
  presetDetail: { fontSize: 12, color: '#888' },
  generateSection: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0',
  },
  generateInfo: {
    width: '100%', marginBottom: 20,
  },
  generateItem: {
    display: 'flex', gap: 8, marginBottom: 8, fontSize: 13,
  },
  generateLabel: { color: '#888', minWidth: 60 },
  generateValue: { color: '#e0e0e0' },
  generateBtn: {
    background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8,
    padding: '12px 32px', fontSize: 15, cursor: 'pointer',
  },
  generateBtnDisabled: {
    background: '#3a3a5e', color: '#888', border: 'none', borderRadius: 8,
    padding: '12px 32px', fontSize: 15, cursor: 'not-allowed',
  },
  errorText: {
    color: '#ef4444', fontSize: 13, marginTop: 12,
  },
  reviewSection: {
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  reviewBlock: {
    background: '#2a2a3e', borderRadius: 8, padding: 12,
  },
  reviewTitle: {
    fontSize: 13, fontWeight: 600, color: '#a78bfa', marginBottom: 6,
  },
  reviewContent: {
    fontSize: 13, color: '#ccc', lineHeight: 1.6, whiteSpace: 'pre-wrap',
    maxHeight: 120, overflow: 'auto',
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 24px', borderTop: '1px solid #2a2a3e',
  },
  backBtn: {
    background: '#2a2a3e', color: '#ccc', border: '1px solid #3a3a5e',
    borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer',
  },
  nextBtn: {
    background: '#4f46e5', color: '#fff', border: 'none',
    borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer',
  },
  nextBtnDisabled: {
    background: '#3a3a5e', color: '#888', border: 'none',
    borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'not-allowed',
  },
  createBtn: {
    background: '#22c55e', color: '#fff', border: 'none',
    borderRadius: 8, padding: '8px 24px', fontSize: 14, cursor: 'pointer', fontWeight: 600,
  },
  retryBtn: {
    background: '#2a2a3e', color: '#f59e0b', border: '1px solid #f59e0b',
    borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
  },
}
