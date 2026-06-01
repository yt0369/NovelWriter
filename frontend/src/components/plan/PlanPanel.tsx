import { usePlanStore } from '../../stores/planStore'

export function PlanPanel() {
  const { steps, currentPlan } = usePlanStore()

  if (!currentPlan || !steps.length) return null

  const completed = steps.filter(s => s.status === 'completed').length
  const progress = Math.round((completed / steps.length) * 100)

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <span style={{ color: '#14b8a6' }}>✓</span>
      case 'in_progress': return <span style={{ color: '#f59e0b' }}>⟳</span>
      case 'failed': return <span style={{ color: '#ef4444' }}>✗</span>
      default: return <span style={{ color: '#6b7280' }}>○</span>
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>执行计划</span>
        <span style={styles.progress}>{completed}/{steps.length}</span>
      </div>
      <div style={styles.progressBar}>
        <div style={{ ...styles.progressFill, width: `${progress}%` }} />
      </div>
      <div style={styles.steps}>
        {steps.map(step => (
          <div key={step.id} style={{
            ...styles.step,
            background: step.status === 'in_progress' ? '#1f2937' : 'transparent',
          }}>
            <span style={styles.stepIcon}>{statusIcon(step.status)}</span>
            <span style={styles.stepLabel}>{step.label}</span>
            {step.note && <div style={styles.stepNote}>{step.note}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 12 },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8,
  },
  progress: { color: '#6b7280', fontSize: 11 },
  progressBar: {
    height: 3, background: '#1f2937', borderRadius: 2, marginBottom: 12, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', background: '#14b8a6', borderRadius: 2, transition: 'width 0.3s',
  },
  steps: { display: 'flex', flexDirection: 'column', gap: 4 },
  step: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '4px 8px', borderRadius: 4, fontSize: 12,
  },
  stepIcon: { width: 16, textAlign: 'center', flexShrink: 0 },
  stepLabel: { color: '#e5e7eb', flex: 1 },
  stepNote: { color: '#6b7280', fontSize: 11, marginTop: 2 },
}
