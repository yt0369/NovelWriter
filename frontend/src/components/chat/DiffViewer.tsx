import { useState, useMemo } from 'react'

interface Props {
  diff: string
  filePath: string
  edits?: PatchEdit[]
  onApprove?: () => void
  onReject?: () => void
  onEditStatusChange?: (editId: string, status: 'accepted' | 'rejected' | 'pending') => void
  actionBusy?: boolean
  actionMessage?: string
}

interface PatchEdit {
  id: string
  old_text?: string
  new_text?: string
  status?: string
  replace_all?: boolean
}

type LineType = 'added' | 'removed' | 'unchanged' | 'header' | 'meta'

interface DiffLine {
  type: LineType
  content: string
  oldLineNum?: number
  newLineNum?: number
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n')
  const result: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'meta', content: line })
    } else if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('+')) {
      result.push({ type: 'added', content: line.slice(1), newLineNum: newLine })
      newLine++
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', content: line.slice(1), oldLineNum: oldLine })
      oldLine++
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line
      result.push({ type: 'unchanged', content, oldLineNum: oldLine, newLineNum: newLine })
      oldLine++
      newLine++
    }
  }

  return result
}

function buildSideBySide(diffLines: DiffLine[]) {
  const left: { type: LineType; content: string; lineNum?: number }[] = []
  const right: { type: LineType; content: string; lineNum?: number }[] = []

  let i = 0
  while (i < diffLines.length) {
    const line = diffLines[i]
    if (line.type === 'meta' || line.type === 'header') {
      left.push({ type: line.type, content: line.content })
      right.push({ type: line.type, content: line.content })
      i++
    } else if (line.type === 'removed') {
      const removedBatch: DiffLine[] = []
      while (i < diffLines.length && diffLines[i].type === 'removed') {
        removedBatch.push(diffLines[i])
        i++
      }
      const addedBatch: DiffLine[] = []
      while (i < diffLines.length && diffLines[i].type === 'added') {
        addedBatch.push(diffLines[i])
        i++
      }
      const maxLen = Math.max(removedBatch.length, addedBatch.length)
      for (let j = 0; j < maxLen; j++) {
        if (j < removedBatch.length) {
          left.push({ type: 'removed', content: removedBatch[j].content, lineNum: removedBatch[j].oldLineNum })
        } else {
          left.push({ type: 'unchanged', content: '' })
        }
        if (j < addedBatch.length) {
          right.push({ type: 'added', content: addedBatch[j].content, lineNum: addedBatch[j].newLineNum })
        } else {
          right.push({ type: 'unchanged', content: '' })
        }
      }
    } else if (line.type === 'added') {
      left.push({ type: 'unchanged', content: '' })
      right.push({ type: 'added', content: line.content, lineNum: line.newLineNum })
      i++
    } else {
      left.push({ type: 'unchanged', content: line.content, lineNum: line.oldLineNum })
      right.push({ type: 'unchanged', content: line.content, lineNum: line.newLineNum })
      i++
    }
  }

  return { left, right }
}

function lineStyle(type: LineType): React.CSSProperties {
  switch (type) {
    case 'added': return { background: '#1a3a1a', color: '#86efac' }
    case 'removed': return { background: '#3a1a1a', color: '#fca5a5' }
    case 'header': return { color: '#60a5fa', background: '#1a2a3e' }
    case 'meta': return { color: '#888', fontStyle: 'italic', background: '#1a1a2e' }
    default: return {}
  }
}

export function DiffViewer({
  diff,
  filePath,
  edits = [],
  onApprove,
  onReject,
  onEditStatusChange,
  actionBusy = false,
  actionMessage = '',
}: Props) {
  const [viewMode, setViewMode] = useState<'unified' | 'sideBySide'>('unified')

  const diffLines = useMemo(() => parseUnifiedDiff(diff), [diff])
  const sideBySide = useMemo(() => buildSideBySide(diffLines), [diffLines])

  if (!diff) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.filePath}>{filePath}</span>
        <div style={styles.headerRight}>
          {edits.length > 0 && <span style={styles.editCount}>{edits.length} edits</span>}
          {actionMessage && <span style={styles.actionMessage}>{actionMessage}</span>}
          {onReject && <button style={styles.rejectBtn} onClick={onReject} disabled={actionBusy}>忽略</button>}
            {onApprove && <button style={styles.approveBtn} onClick={onApprove} disabled={actionBusy}>{actionBusy ? '处理中...' : '确认'}</button>}
          </div>
        </div>
        <div style={{ color: '#888', fontSize: 13, padding: 16, textAlign: 'center' }}>
          无差异内容
        </div>
      </div>
    )
  }

  const hasChanges = diffLines.some(l => l.type === 'added' || l.type === 'removed')

  const renderUnified = () => (
    <div style={styles.diffBody}>
      {diffLines.map((line, i) => {
        const ls = lineStyle(line.type)
        const lineNum = line.type === 'removed' ? line.oldLineNum : line.newLineNum
        return (
          <div key={i} style={{ ...styles.line, ...ls }}>
            <span style={styles.lineNum}>{lineNum ?? ''}</span>
            <span style={styles.prefix}>
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : line.type === 'header' ? '@' : ' '}
            </span>
            <span style={styles.lineTextWrap}>{line.content || ' '}</span>
          </div>
        )
      })}
    </div>
  )

  const renderSideBySide = () => (
    <div style={styles.sideBySideContainer}>
      <div style={styles.sidePanel}>
        <div style={styles.sidePanelHeader}>原始</div>
        <div style={styles.diffBody}>
          {sideBySide.left.map((line, i) => {
            const ls = lineStyle(line.type)
            return (
              <div key={i} style={{ ...styles.line, ...ls }}>
                <span style={styles.lineNum}>{line.lineNum ?? ''}</span>
                <span style={styles.lineTextWrap}>{line.content || ' '}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div style={styles.sideDivider} />
      <div style={styles.sidePanel}>
        <div style={styles.sidePanelHeader}>修改后</div>
        <div style={styles.diffBody}>
          {sideBySide.right.map((line, i) => {
            const ls = lineStyle(line.type)
            return (
              <div key={i} style={{ ...styles.line, ...ls }}>
                <span style={styles.lineNum}>{line.lineNum ?? ''}</span>
                <span style={styles.lineTextWrap}>{line.content || ' '}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.filePath}>{filePath}</span>
        <div style={styles.headerRight}>
          <div style={styles.toggleGroup}>
            <button
              style={viewMode === 'unified' ? styles.toggleActive : styles.toggle}
              onClick={() => setViewMode('unified')}
            >
              统一视图
            </button>
            <button
              style={viewMode === 'sideBySide' ? styles.toggleActive : styles.toggle}
              onClick={() => setViewMode('sideBySide')}
            >
              并排对比
            </button>
          </div>
          {actionMessage && <span style={styles.actionMessage}>{actionMessage}</span>}
          {onReject && (
            <button style={styles.rejectBtn} onClick={onReject} disabled={actionBusy}>
              {hasChanges ? '拒绝全部' : '忽略'}
            </button>
          )}
          {onApprove && (
            <button style={styles.approveBtn} onClick={onApprove} disabled={actionBusy}>
              {actionBusy ? '处理中...' : hasChanges ? '批准全部' : '确认'}
            </button>
          )}
        </div>
      </div>
      {edits.length > 0 && (
        <div style={styles.editPanel}>
          {edits.map(edit => (
            <div key={edit.id} style={styles.editItem}>
              <div style={styles.editMain}>
                <span style={styles.editId}>{edit.id}</span>
                <span style={{
                  ...styles.editStatus,
                  color: edit.status === 'rejected' ? '#fca5a5' : edit.status === 'accepted' ? '#86efac' : '#fbbf24',
                }}>
                  {edit.status === 'rejected' ? '已拒绝' : edit.status === 'accepted' ? '已接受' : '待定'}
                </span>
                {edit.replace_all && <span style={styles.editFlag}>全部匹配</span>}
              </div>
              <div style={styles.editPreview}>
                <span style={styles.editOld}>{(edit.old_text || '').slice(0, 80) || '（空）'}</span>
                <span style={styles.editArrow}>→</span>
                <span style={styles.editNew}>{(edit.new_text || '').slice(0, 80) || '（空）'}</span>
              </div>
              {onEditStatusChange && (
                <div style={styles.editActions}>
                  <button
                    style={styles.editAcceptBtn}
                    onClick={() => onEditStatusChange(edit.id, 'accepted')}
                    disabled={actionBusy || edit.status === 'accepted'}
                  >
                    接受此 edit
                  </button>
                  <button
                    style={styles.editRejectBtn}
                    onClick={() => onEditStatusChange(edit.id, 'rejected')}
                    disabled={actionBusy || edit.status === 'rejected'}
                  >
                    拒绝此 edit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {viewMode === 'unified' ? renderUnified() : renderSideBySide()}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid #3a3a5e',
    fontSize: 12,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: '#1e1e32',
    borderBottom: '1px solid #3a3a5e',
  },
  filePath: {
    color: '#a78bfa',
    fontWeight: 600,
  },
  editCount: {
    color: '#9ca3af',
    fontSize: 11,
  },
  actionMessage: {
    color: '#fbbf24',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  toggleGroup: {
    display: 'flex',
    gap: 0,
    borderRadius: 6,
    overflow: 'hidden',
    border: '1px solid #3a3a5e',
  },
  toggle: {
    background: 'transparent',
    border: 'none',
    padding: '4px 10px',
    color: '#888',
    fontSize: 11,
    cursor: 'pointer',
  },
  toggleActive: {
    background: '#3a3a5e',
    border: 'none',
    padding: '4px 10px',
    color: '#e0e0e0',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 600,
  },
  rejectBtn: {
    background: 'transparent',
    border: '1px solid #7f1d1d',
    borderRadius: 6,
    padding: '4px 12px',
    color: '#fca5a5',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 600,
  },
  approveBtn: {
    background: '#166534',
    border: '1px solid #166534',
    borderRadius: 6,
    padding: '4px 12px',
    color: '#bbf7d0',
    fontSize: 11,
    cursor: 'pointer',
    fontWeight: 600,
  },
  editPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 8,
    background: '#171729',
    borderBottom: '1px solid #3a3a5e',
    maxHeight: 180,
    overflow: 'auto',
  },
  editItem: {
    border: '1px solid #2a2a3e',
    borderRadius: 6,
    padding: 8,
    background: '#12121f',
  },
  editMain: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 },
  editId: { color: '#bfdbfe', fontWeight: 700, fontSize: 11 },
  editStatus: { fontSize: 11 },
  editFlag: { color: '#9ca3af', fontSize: 10, border: '1px solid #374151', borderRadius: 4, padding: '1px 5px' },
  editPreview: { display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', minWidth: 0 },
  editOld: { color: '#fca5a5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  editArrow: { color: '#6b7280', flexShrink: 0 },
  editNew: { color: '#86efac', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  editActions: { display: 'flex', gap: 6, marginTop: 6 },
  editAcceptBtn: {
    background: '#143326', border: '1px solid #166534', color: '#bbf7d0',
    borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
  },
  editRejectBtn: {
    background: '#3b1d24', border: '1px solid #7f1d1d', color: '#fecaca',
    borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
  },
  diffBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'auto',
    background: '#12121f',
  },
  line: {
    display: 'flex',
    padding: '1px 0',
    lineHeight: 1.5,
    minHeight: 18,
  },
  lineNum: {
    display: 'inline-block',
    width: 36,
    textAlign: 'right',
    paddingRight: 8,
    color: '#555',
    userSelect: 'none',
    flexShrink: 0,
  },
  prefix: {
    display: 'inline-block',
    width: 16,
    textAlign: 'center',
    flexShrink: 0,
    userSelect: 'none',
  },
  lineText: {
    flex: 1,
    whiteSpace: 'pre',
    paddingRight: 12,
  },
  lineTextWrap: {
    flex: 1,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    paddingRight: 12,
  },
  sideBySideContainer: {
    display: 'flex',
    background: '#12121f',
    flex: 1,
    overflow: 'hidden',
  },
  sidePanel: {
    flex: 1,
    minWidth: 0,
    overflow: 'auto',
  },
  sidePanelHeader: {
    padding: '4px 12px',
    background: '#1a1a2e',
    borderBottom: '1px solid #2a2a3e',
    color: '#888',
    fontSize: 11,
    fontWeight: 600,
  },
  sideDivider: {
    width: 1,
    background: '#3a3a5e',
    flexShrink: 0,
  },
}
