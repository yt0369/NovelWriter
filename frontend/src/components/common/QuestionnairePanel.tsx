import { useState } from 'react'

interface Option {
  label: string
  description?: string
  recommended?: boolean
}

interface Question {
  id: string
  question: string
  options?: Option[]
  type?: 'single' | 'multi'
}

interface Questionnaire {
  id: string
  questions: Question[]
  status: string
}

interface Props {
  questionnaire: Questionnaire
  onSubmit: (answers: Record<string, string | string[]>) => void
}

export function QuestionnairePanel({ questionnaire, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})

  const handleSingleSelect = (qId: string, label: string) => {
    setAnswers(prev => ({ ...prev, [qId]: label }))
  }

  const handleMultiSelect = (qId: string, label: string) => {
    setAnswers(prev => {
      const current = (prev[qId] as string[]) || []
      const next = current.includes(label)
        ? current.filter(l => l !== label)
        : [...current, label]
      return { ...prev, [qId]: next }
    })
  }

  const handleSubmit = () => {
    const finalAnswers: Record<string, string | string[]> = {}
    for (const q of questionnaire.questions) {
      const answer = answers[q.id]
      if (answer === '其他' || (Array.isArray(answer) && answer.includes('其他'))) {
        const otherText = otherTexts[q.id] || ''
        if (Array.isArray(answer)) {
          finalAnswers[q.id] = [...answer.filter(a => a !== '其他'), otherText].filter(Boolean)
        } else {
          finalAnswers[q.id] = otherText || '其他'
        }
      } else {
        finalAnswers[q.id] = answer || ''
      }
    }
    onSubmit(finalAnswers)
  }

  const isValid = questionnaire.questions.every(q => {
    const answer = answers[q.id]
    if (!answer) return false
    if (answer === '其他' && !otherTexts[q.id]) return false
    if (Array.isArray(answer) && answer.includes('其他') && !otherTexts[q.id]) return false
    return true
  })

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>请回答以下问题</span>
        <span style={styles.progress}>{Object.keys(answers).length}/{questionnaire.questions.length}</span>
      </div>
      <div style={styles.body}>
        {questionnaire.questions.map((q, i) => (
          <div key={q.id} style={styles.question}>
            <div style={styles.questionText}>
              <span style={styles.questionIndex}>{i + 1}.</span>
              {q.question}
            </div>
            <div style={styles.options}>
              {(q.options || []).map(opt => {
                const isSelected = q.type === 'multi'
                  ? ((answers[q.id] as string[]) || []).includes(opt.label)
                  : answers[q.id] === opt.label
                return (
                  <div
                    key={opt.label}
                    style={{ ...styles.option, ...(isSelected ? styles.optionSelected : {}) }}
                    onClick={() => q.type === 'multi'
                      ? handleMultiSelect(q.id, opt.label)
                      : handleSingleSelect(q.id, opt.label)
                    }
                  >
                    <div style={styles.optionHeader}>
                      <span style={styles.optionLabel}>{opt.label}</span>
                      {opt.recommended && <span style={styles.badge}>推荐</span>}
                    </div>
                    {opt.description && <div style={styles.optionDesc}>{opt.description}</div>}
                  </div>
                )
              })}
              <div
                style={{
                  ...styles.option,
                  ...(answers[q.id] === '其他' || (Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes('其他'))
                    ? styles.optionSelected : {})
                }}
                onClick={() => q.type === 'multi'
                  ? handleMultiSelect(q.id, '其他')
                  : handleSingleSelect(q.id, '其他')
                }
              >
                <span style={styles.optionLabel}>其他</span>
                {(answers[q.id] === '其他' || (Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes('其他'))) && (
                  <input
                    style={styles.otherInput}
                    value={otherTexts[q.id] || ''}
                    onChange={e => setOtherTexts(prev => ({ ...prev, [q.id]: e.target.value }))}
                    placeholder="请输入..."
                    onClick={e => e.stopPropagation()}
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={styles.footer}>
        <button style={{ ...styles.submitBtn, ...(!isValid ? styles.submitBtnDisabled : {}) }} onClick={handleSubmit} disabled={!isValid}>
          提交回答
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '0 16px 8px', background: '#12121f', borderRadius: 8,
    border: '1px solid #2a2a3e', overflow: 'hidden',
    position: 'relative', zIndex: 10,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', borderBottom: '1px solid #2a2a3e', background: '#1a1a2e',
  },
  title: { fontSize: 12, fontWeight: 600, color: '#a78bfa' },
  progress: { fontSize: 11, color: '#6b7280' },
  body: { padding: '8px 12px', maxHeight: '60vh', overflowY: 'auto' },
  question: { marginBottom: 12 },
  questionText: { fontSize: 13, color: '#e5e7eb', marginBottom: 6, lineHeight: 1.5 },
  questionIndex: { color: '#a78bfa', fontWeight: 600, marginRight: 4 },
  options: { display: 'flex', flexDirection: 'column', gap: 4 },
  option: {
    padding: '6px 10px', background: '#1f2937', borderRadius: 6,
    border: '1px solid #374151', cursor: 'pointer', fontSize: 12,
  },
  optionSelected: { borderColor: '#a78bfa', background: '#1e1b4b' },
  optionHeader: { display: 'flex', alignItems: 'center', gap: 6 },
  optionLabel: { color: '#e5e7eb' },
  badge: {
    fontSize: 10, padding: '1px 6px', background: '#a78bfa', color: '#fff',
    borderRadius: 3,
  },
  optionDesc: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  otherInput: {
    marginTop: 4, width: '100%', padding: '4px 8px', fontSize: 12,
    background: '#111827', color: '#e5e7eb', border: '1px solid #374151',
    borderRadius: 4, outline: 'none',
  },
  footer: { padding: '8px 12px', borderTop: '1px solid #2a2a3e' },
  submitBtn: {
    width: '100%', padding: '6px 12px', background: '#a78bfa', color: '#fff',
    border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer',
  },
  submitBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
}
