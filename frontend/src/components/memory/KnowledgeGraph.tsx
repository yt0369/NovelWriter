import { useState, useEffect } from 'react'
import { MemorySearch } from './MemorySearch'
import { KnowledgeNodeEditor } from './KnowledgeNodeEditor'
import { RelationshipGraph } from './RelationshipGraph'
import { KnowledgeTreeView } from './KnowledgeTreeView'
import { KNOWLEDGE_UPDATED_EVENT, WORKSPACE_REFRESH_EVENT, WorkspaceRefreshDetail } from '../../utils/workspaceEvents'

interface KnowledgeNode {
  id: string
  name: string
  summary: string
  wing: string
  room: string
  category: string
  importance: string
  tags: string[]
}

interface Props {
  projectId: string
  visible: boolean
}

const WINGS = ['世界', '角色', '剧情', '灵感', '设定', '物品']

type ViewTab = '列表视图' | '关系视图'

export function KnowledgeGraph({ projectId, visible }: Props) {
  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [expandedWings, setExpandedWings] = useState<Set<string>>(new Set(['世界', '角色']))
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createWing, setCreateWing] = useState('灵感')
  const [createName, setCreateName] = useState('')
  const [viewTab, setViewTab] = useState<ViewTab>('列表视图')

  const fetchNodes = async () => {
    try {
      const res = await fetch(`/api/memory/${projectId}/nodes?limit=200`)
      const data = await res.json()
      setNodes(data)
    } catch {}
  }

  useEffect(() => {
    if (visible) fetchNodes()
  }, [projectId, visible])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRefreshDetail>).detail
      if (visible && (!detail?.sections || detail.sections.includes('knowledge'))) fetchNodes()
    }
    window.addEventListener(KNOWLEDGE_UPDATED_EVENT, handler)
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => {
      window.removeEventListener(KNOWLEDGE_UPDATED_EVENT, handler)
      window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
    }
  }, [projectId, visible])

  const toggleWing = (wing: string) => {
    setExpandedWings(prev => {
      const next = new Set(prev)
      next.has(wing) ? next.delete(wing) : next.add(wing)
      return next
    })
  }

  const handleCreate = async () => {
    if (!createName.trim()) return
    await fetch(`/api/memory/${projectId}/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: createName, wing: createWing }),
    })
    setCreateName('')
    setShowCreate(false)
    fetchNodes()
  }

  const handleSelectFromSearch = (nodeId: string) => {
    setSelectedNodeId(nodeId)
  }

  const handleNodeDeleted = () => {
    setSelectedNodeId(null)
    fetchNodes()
  }

  const grouped: Record<string, KnowledgeNode[]> = {}
  for (const wing of WINGS) grouped[wing] = []
  for (const node of nodes) {
    const wing = node.wing || '灵感'
    if (!grouped[wing]) grouped[wing] = []
    grouped[wing].push(node)
  }

  if (!visible) return null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>知识图谱</span>
        <button style={styles.addBtn} onClick={() => setShowCreate(true)}>+ 新建</button>
      </div>

      <div style={styles.tabBar}>
        {(['列表视图', '关系视图'] as ViewTab[]).map(tab => (
          <button
            key={tab}
            style={viewTab === tab ? styles.tabActive : styles.tab}
            onClick={() => setViewTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {viewTab === '列表视图' && (
        <>
          <div style={{ padding: '8px 12px' }}>
            <MemorySearch projectId={projectId} onSelect={handleSelectFromSearch} />
          </div>

          <KnowledgeTreeView
            wings={WINGS}
            grouped={grouped}
            expandedWings={expandedWings}
            selectedNodeId={selectedNodeId}
            onToggleWing={toggleWing}
            onSelectNode={setSelectedNodeId}
          />
        </>
      )}

      {viewTab === '关系视图' && (
        <RelationshipGraph projectId={projectId} />
      )}

      {showCreate && (
        <div style={styles.overlay} onClick={() => setShowCreate(false)}>
          <div style={styles.createModal} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 12px', color: '#e5e7eb' }}>新建知识节点</h4>
            <input
              style={styles.createInput}
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="节点名称"
              autoFocus
            />
            <select style={styles.createInput} value={createWing} onChange={e => setCreateWing(e.target.value)}>
              {WINGS.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button style={styles.cancelBtn} onClick={() => setShowCreate(false)}>取消</button>
              <button style={styles.confirmBtn} onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}

      {selectedNodeId && (
        <KnowledgeNodeEditor
          projectId={projectId}
          nodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
          onDeleted={handleNodeDeleted}
        />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#111827',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid #1f2937',
  },
  title: { fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  addBtn: {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    padding: '4px 10px', color: '#14b8a6', fontSize: 12, cursor: 'pointer',
  },
  tabBar: {
    display: 'flex', borderBottom: '1px solid #1f2937',
  },
  tab: {
    flex: 1, padding: '8px 0', background: 'transparent', border: 'none',
    color: '#6b7280', fontSize: 12, cursor: 'pointer', borderBottom: '2px solid transparent',
  },
  tabActive: {
    flex: 1, padding: '8px 0', background: 'transparent', border: 'none',
    color: '#14b8a6', fontSize: 12, cursor: 'pointer', borderBottom: '2px solid #14b8a6', fontWeight: 600,
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 150,
  },
  createModal: {
    background: '#111827', borderRadius: 12, padding: 20, width: 320,
    border: '1px solid #1f2937',
  },
  createInput: {
    width: '100%', background: '#1f2937', border: '1px solid #374151',
    borderRadius: 8, padding: '8px 10px', color: '#e5e7eb', fontSize: 13,
    outline: 'none', marginBottom: 8, boxSizing: 'border-box',
  },
  cancelBtn: {
    background: '#1f2937', color: '#d1d5db', border: '1px solid #374151',
    borderRadius: 6, padding: '6px 16px', cursor: 'pointer',
  },
  confirmBtn: {
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '6px 16px', cursor: 'pointer',
  },
}
