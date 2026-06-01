import { useState, useEffect } from 'react'
import { useEntityVersionStore, EntityVersion } from '../../stores/entityVersionStore'

interface Props {
  entityType: string
  entityId: string
  entityName?: string
  onClose: () => void
  onRestore?: (snapshot: any) => void
}

export function EntityVersionHistory({ entityType, entityId, entityName, onClose, onRestore }: Props) {
  const { versions, fetchVersions, restoreVersion } = useEntityVersionStore()
  const [selectedVersion, setSelectedVersion] = useState<EntityVersion | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    fetchVersions(entityType, entityId)
  }, [entityType, entityId])

  const handleRestore = async (version: EntityVersion) => {
    if (!confirm(`确定恢复到版本 ${version.version}？`)) return
    setRestoring(true)
    const snapshot = await restoreVersion(entityType, entityId, version.version)
    setRestoring(false)
    if (snapshot && onRestore) {
      onRestore(snapshot)
      onClose()
    }
  }

  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: 15 }}>
            版本历史 {entityName ? `— ${entityName}` : ''}
          </h3>
          <span style={styles.closeBtn} onClick={onClose}>&times;</span>
        </div>

        <div style={styles.body}>
          {versions.length === 0 ? (
            <div style={styles.empty}>暂无版本记录</div>
          ) : (
            <div style={styles.list}>
              {versions.map(v => (
                <div
                  key={v.id}
                  style={{
                    ...styles.item,
                    background: selectedVersion?.id === v.id ? '#1f2937' : 'transparent',
                  }}
                  onClick={() => setSelectedVersion(v)}
                >
                  <div style={styles.itemHeader}>
                    <span style={styles.versionTag}>v{v.version}</span>
                    <span style={styles.date}>{formatDate(v.created_at)}</span>
                  </div>
                  {v.change_summary && (
                    <div style={styles.summary}>{v.change_summary}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedVersion && (
          <div style={styles.preview}>
            <div style={styles.previewHeader}>
              <span>v{selectedVersion.version} 快照预览</span>
              <button
                style={styles.restoreBtn}
                onClick={() => handleRestore(selectedVersion)}
                disabled={restoring}
              >
                {restoring ? '恢复中...' : '恢复此版本'}
              </button>
            </div>
            <pre style={styles.previewContent}>
              {typeof selectedVersion.snapshot === 'string'
                ? selectedVersion.snapshot.slice(0, 2000)
                : JSON.stringify(selectedVersion.snapshot, null, 2).slice(0, 2000)}
            </pre>
          </div>
        )}
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
    background: '#111827', borderRadius: 12, width: 560, maxWidth: '90vw',
    maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    border: '1px solid #1f2937',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #1f2937',
  },
  closeBtn: { cursor: 'pointer', fontSize: 20, color: '#6b7280' },
  body: { flex: 1, overflow: 'auto', padding: '12px 20px' },
  empty: { color: '#6b7280', textAlign: 'center', padding: 40, fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  item: {
    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid transparent',
  },
  itemHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  versionTag: {
    fontSize: 12, fontWeight: 600, color: '#14b8a6',
    background: '#0d3331', padding: '2px 8px', borderRadius: 4,
  },
  date: { fontSize: 11, color: '#6b7280' },
  summary: { fontSize: 12, color: '#d1d5db', marginTop: 4 },
  preview: {
    borderTop: '1px solid #1f2937', padding: '12px 20px',
    maxHeight: 200, overflow: 'auto',
  },
  previewHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8, fontSize: 12, color: '#9ca3af',
  },
  restoreBtn: {
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
  },
  previewContent: {
    background: '#0f172a', borderRadius: 6, padding: 10,
    fontSize: 11, color: '#d1d5db', whiteSpace: 'pre-wrap',
    wordBreak: 'break-all', maxHeight: 120, overflow: 'auto',
    margin: 0,
  },
}
