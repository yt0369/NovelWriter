import { useState, useEffect } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { FILE_UPDATED_EVENT, WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'
import { buttons, ui } from '../../styles/ui'

interface FileNode {
  name: string
  path: string
  is_dir: boolean
  children: FileNode[]
}

interface Props { projectId: string; compact?: boolean }

type ModalType = 'FILE' | 'FOLDER' | 'RENAME' | null

export function FileTree({ projectId, compact = false }: Props) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { activeFilePath, setActiveFile, setActiveContent, setIsDirty } = useEditorStore()

  // Modal state
  const [modalType, setModalType] = useState<ModalType>(null)
  const [modalTarget, setModalTarget] = useState('')
  const [inputValue, setInputValue] = useState('')

  const fetchTree = async () => {
    const res = await fetch(`/api/files/${projectId}/tree`)
    setTree(await res.json())
  }

  useEffect(() => { fetchTree() }, [projectId])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (!detail?.sections || detail.sections.includes('files')) fetchTree()
    }
    window.addEventListener(FILE_UPDATED_EVENT, handler)
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => {
      window.removeEventListener(FILE_UPDATED_EVENT, handler)
      window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
    }
  }, [projectId])

  const toggleDir = (path: string) => {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(path) ? s.delete(path) : s.add(path)
      return s
    })
  }

  const handleFileClick = async (path: string) => {
    const res = await fetch(`/api/files/${projectId}/read?path=${encodeURIComponent(path)}`)
    const data = await res.json()
    setActiveFile(path)
    setActiveContent(data.content)
    setIsDirty(false)
  }

  const openModal = (type: ModalType, target: string, defaultVal = '') => {
    setModalType(type)
    setModalTarget(target)
    setInputValue(defaultVal)
  }

  const handleModalSubmit = async () => {
    if (!inputValue.trim()) return
    const val = inputValue.trim()

    if (modalType === 'FILE') {
      const filePath = modalTarget ? `${modalTarget}/${val.endsWith('.md') ? val : val + '.md'}` : val
      await fetch(`/api/files/${projectId}/write`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: '' }),
      })
      setExpanded(prev => new Set(prev).add(modalTarget))
    } else if (modalType === 'FOLDER') {
      await fetch(`/api/files/${projectId}/mkdir?path=${encodeURIComponent(modalTarget + '/' + val)}`, { method: 'POST' })
      setExpanded(prev => new Set(prev).add(modalTarget))
    } else if (modalType === 'RENAME') {
      const parts = modalTarget.split('/')
      parts[parts.length - 1] = val
      const newPath = parts.join('/')
      // Read old, write new, delete old
      const oldRes = await fetch(`/api/files/${projectId}/read?path=${encodeURIComponent(modalTarget)}`)
      const oldData = await oldRes.json()
      await fetch(`/api/files/${projectId}/write`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath, content: oldData.content }),
      })
      await fetch(`/api/files/${projectId}/delete?path=${encodeURIComponent(modalTarget)}`, { method: 'DELETE' })
      if (activeFilePath === modalTarget) setActiveFile(newPath)
    }

    setModalType(null)
    fetchTree()
  }

  const handleDelete = async (path: string) => {
    if (!confirm(`确定删除 ${path}？`)) return
    await fetch(`/api/files/${projectId}/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
    if (activeFilePath === path) { setActiveFile(null); setActiveContent('') }
    fetchTree()
  }

  const [hoveredPath, setHoveredPath] = useState<string | null>(null)

  const getFileIcon = (name: string) => {
    if (name.endsWith('.md')) return 'MD'
    if (name.endsWith('.json')) return 'JS'
    return 'F'
  }

  const renderNode = (node: FileNode, depth = 0) => {
    const isActive = activeFilePath === node.path
    const isExpanded = expanded.has(node.path)
    const isHovered = hoveredPath === node.path

    if (node.is_dir) {
      return (
        <div key={node.path}>
          <div
            style={{ ...s.row, paddingLeft: 8 + depth * 16 }}
            onClick={() => toggleDir(node.path)}
            onMouseEnter={() => setHoveredPath(node.path)}
            onMouseLeave={() => setHoveredPath(null)}
          >
            <span style={s.chevron}>{isExpanded ? '−' : '+'}</span>
            <span style={s.dirIcon}>DIR</span>
            <span style={{ flex: 1, fontSize: 13, color: '#bbb' }}>{node.name}</span>
            <span style={{ ...s.actions, opacity: isHovered ? 1 : 0 }}>
              <span style={s.actionBtn} onClick={e => { e.stopPropagation(); openModal('FILE', node.path) }} title="新建文件">+文</span>
              <span style={s.actionBtn} onClick={e => { e.stopPropagation(); openModal('FOLDER', node.path) }} title="新建文件夹">+夹</span>
            </span>
          </div>
          {isExpanded && node.children.map(child => renderNode(child, depth + 1))}
        </div>
      )
    }

    return (
      <div
        key={node.path}
        style={{ ...s.row, paddingLeft: 8 + depth * 16, background: isActive ? '#123c3d' : isHovered ? '#18232d' : 'transparent' }}
        onClick={() => handleFileClick(node.path)}
        onMouseEnter={() => setHoveredPath(node.path)}
        onMouseLeave={() => setHoveredPath(null)}
      >
        <span style={{ width: 16 }} />
        <span style={s.fileIcon}>{getFileIcon(node.name)}</span>
        <span style={{ flex: 1, fontSize: 13, color: isActive ? '#fff' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        <span style={{ ...s.actions, opacity: isHovered ? 1 : 0 }}>
          <span style={s.actionBtn} onClick={e => { e.stopPropagation(); openModal('RENAME', node.path, node.name) }} title="重命名">改</span>
          <span style={s.actionBtn} onClick={e => { e.stopPropagation(); handleDelete(node.path) }} title="删除">删</span>
        </span>
      </div>
    )
  }

  return (
    <div style={s.container}>
      {!compact && (
        <div style={s.titleBar}>
          <span style={s.title}>文件库</span>
          <span style={s.actionBtn} onClick={() => openModal('FILE', '')} title="新建文件">+文</span>
        </div>
      )}

      {tree.map(node => renderNode(node))}

      {/* Modal */}
      {modalType && (
        <div style={s.overlay} onClick={() => setModalType(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>
              {modalType === 'FILE' ? '新建文件' : modalType === 'FOLDER' ? '新建文件夹' : '重命名'}
            </h3>
            <input
              style={s.modalInput}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
              placeholder={modalType === 'FILE' ? '文件名.md' : modalType === 'FOLDER' ? '文件夹名' : '新名称'}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button style={s.cancelBtn} onClick={() => setModalType(null)}>取消</button>
              <button style={s.confirmBtn} onClick={handleModalSubmit} disabled={!inputValue.trim()}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  container: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' },
  titleBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 12px 8px', borderBottom: `1px solid ${ui.color.border}` },
  title: { fontSize: 12, fontWeight: 700, color: ui.color.muted },
  compactAction: { padding: '7px 8px', borderBottom: `1px solid ${ui.color.border}` },
  newFileBtn: { ...buttons.ghost, width: '100%', padding: '5px 8px', fontSize: 11 },
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer', borderRadius: 6, margin: '1px 4px' },
  actions: { display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.15s' },
  actionBtn: { cursor: 'pointer', fontSize: 10, padding: '2px 5px', borderRadius: 999, color: '#99f6e4', background: '#102b27', border: '1px solid #115e59' },
  chevron: { fontSize: 12, width: 16, textAlign: 'center', color: ui.color.faint },
  dirIcon: { fontSize: 9, color: '#fcd34d', border: '1px solid #6b4b13', borderRadius: 4, padding: '1px 3px', background: '#2b2113' },
  fileIcon: { fontSize: 9, color: '#99f6e4', border: '1px solid #115e59', borderRadius: 4, padding: '1px 3px', background: '#102b27' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50 },
  modal: { background: ui.color.panelAlt, borderRadius: ui.radius.md, padding: 24, width: 360, border: `1px solid ${ui.color.borderStrong}` },
  modalInput: { width: '100%', background: ui.color.panelSoft, border: `1px solid ${ui.color.borderStrong}`, borderRadius: 8, padding: '10px 12px', color: ui.color.text, fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  cancelBtn: { ...buttons.secondary },
  confirmBtn: { ...buttons.primary },
}
