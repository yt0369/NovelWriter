import { useEffect, useState } from 'react'
import { useDiffStore } from '../../stores/diffStore'
import { buttons, panelStates } from '../../styles/ui'

export interface PendingChange {
  id: string
  tool_name: string
  file_path: string
  description: string
  diff: string
  original_content: string
  new_content: string
  metadata?: {
    edits?: Array<{
      id: string
      old_text?: string
      new_text?: string
      status?: string
      replace_all?: boolean
    }>
    patch_report?: Array<Record<string, unknown>>
  }
  status?: string
  source?: string
  created_at?: number
}

interface Props {
  projectId: string
  onOpen: (change: PendingChange) => void
  refreshKey?: number
}

export function PendingChangesPanel({ projectId, onOpen, refreshKey = 0 }: Props) {
  const [items, setItems] = useState<PendingChange[]>([])
  const [loading, setLoading] = useState(false)
  const { sessions, approveSession, rejectSession } = useDiffStore()

  const fetchItems = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes`)
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchItems() }, [projectId, refreshKey])

  return (
    <div style={styles.panel} data-testid="pending-changes-panel">
      <div style={styles.header}>
        <span>待审批变更</span>
        <button style={styles.refresh} onClick={fetchItems}>{loading ? '...' : '刷新'}</button>
      </div>
      {items.length === 0 ? (
        <div style={styles.empty} data-testid="pending-empty-state">暂无待审批变更</div>
      ) : (
        <div style={styles.list}>
          {items.map(item => (
            <button key={item.id} style={styles.item} onClick={() => onOpen(item)} data-testid="pending-change-item">
              <span style={styles.path}>{item.file_path}</span>
              <span style={styles.desc}>{item.description || item.tool_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: { borderBottom: '1px solid #2a2a3e', background: '#141427' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', color: '#a78bfa', fontSize: 12, fontWeight: 600,
  },
  refresh: { ...buttons.secondary, color: '#c4b5fd', fontSize: 11, padding: '3px 8px' },
  empty: panelStates.empty,
  list: { display: 'flex', flexDirection: 'column', gap: 6, padding: '0 10px 10px' },
  item: {
    textAlign: 'left', background: '#1e1e32', border: '1px solid #2a2a3e',
    borderRadius: 8, padding: 8, cursor: 'pointer',
  },
  path: { display: 'block', color: '#e0e0e0', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  desc: { display: 'block', color: '#777', fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
}
