import { useToastStore } from '../../stores/toastStore'

const ICONS: Record<string, string> = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
}

const COLORS: Record<string, string> = {
  success: '#14b8a6',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
}

export function Toast() {
  const { toasts, removeToast } = useToastStore()

  if (!toasts.length) return null

  return (
    <div style={styles.container}>
      {toasts.map(toast => (
        <div key={toast.id} style={{ ...styles.toast, borderLeftColor: COLORS[toast.type] }}>
          <span style={{ ...styles.icon, color: COLORS[toast.type] }}>{ICONS[toast.type]}</span>
          <span style={styles.message}>{toast.message}</span>
          <button style={styles.close} onClick={() => removeToast(toast.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed', top: 16, right: 16, zIndex: 9999,
    display: 'flex', flexDirection: 'column', gap: 8,
    maxWidth: 360,
  },
  toast: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', borderRadius: 6,
    background: '#1f2937', border: '1px solid #374151',
    borderLeft: '3px solid',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    animation: 'toast-in 0.2s ease-out',
  },
  icon: { fontSize: 14, fontWeight: 700, flexShrink: 0 },
  message: { fontSize: 13, color: '#e5e7eb', flex: 1 },
  close: {
    background: 'none', border: 'none', color: '#6b7280',
    fontSize: 12, cursor: 'pointer', padding: '0 2px',
  },
}
