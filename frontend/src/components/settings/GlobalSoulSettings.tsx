import { useState, useEffect } from 'react'
import { useGlobalSoulStore } from '../../stores/globalSoulStore'

interface Props {
  visible: boolean
  onClose: () => void
}

export function GlobalSoulSettings({ visible, onClose }: Props) {
  const { soul, loading, loadSoul, saveSoul } = useGlobalSoulStore()
  const [editSoul, setEditSoul] = useState('')

  useEffect(() => {
    if (visible) loadSoul()
  }, [visible])

  useEffect(() => {
    setEditSoul(soul)
  }, [soul])

  const handleSave = async () => {
    await saveSoul(editSoul)
  }

  if (!visible) return null

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <span style={styles.title}>全局 Soul 设置</span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={styles.body}>
          <p style={styles.desc}>
            全局 Soul 定义了 AI 助手的默认人格和行为准则。项目级 Soul 可覆盖此设置。
          </p>
          <textarea
            style={styles.textarea}
            value={editSoul}
            onChange={e => setEditSoul(e.target.value)}
            placeholder="输入全局 Soul 内容..."
          />
        </div>
        <div style={styles.footer}>
          <div style={{ flex: 1 }} />
          <button style={styles.saveBtn} onClick={handleSave} disabled={loading}>
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  modal: {
    width: 600, maxHeight: '80vh', background: '#0d1117', borderRadius: 12,
    border: '1px solid #374151', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid #1f2937',
  },
  title: { fontSize: 14, fontWeight: 600, color: '#e5e7eb' },
  closeBtn: {
    background: 'none', border: 'none', color: '#6b7280', fontSize: 16,
    cursor: 'pointer',
  },
  body: { padding: '12px 16px', flex: 1, overflow: 'auto' },
  desc: { fontSize: 12, color: '#6b7280', marginBottom: 12 },
  textarea: {
    width: '100%', height: '52vh', padding: 12, fontSize: 13, lineHeight: 1.6,
    background: '#111827', color: '#e5e7eb', border: '1px solid #374151',
    borderRadius: 6, outline: 'none', resize: 'none',
    fontFamily: "'Noto Serif SC', Georgia, serif",
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', borderTop: '1px solid #1f2937',
  },
  resetBtn: {
    padding: '5px 12px', fontSize: 12, background: 'none',
    color: '#6b7280', border: '1px solid #374151', borderRadius: 4, cursor: 'pointer',
  },
  saveBtn: {
    padding: '5px 16px', fontSize: 12, background: '#14b8a6',
    color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
  },
  savedHint: { fontSize: 11, color: '#14b8a6' },
}
