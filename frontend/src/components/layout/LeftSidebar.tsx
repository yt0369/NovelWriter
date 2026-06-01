import { useState, useEffect } from 'react'
import { SkillsPanel } from '../skills/SkillsPanel'
import { FileTree } from '../file-tree/FileTree'
import { OutlineViewer } from '../outline/OutlineViewer'
import { KnowledgeGraph } from '../memory/KnowledgeGraph'
import { MemorySearch } from '../memory/MemorySearch'
import { FileSearch } from '../file-tree/FileSearch'
import { MemoryAdminPanel } from '../memory/MemoryAdminPanel'
import { EvolutionMemoryPanel } from '../memory/EvolutionMemoryPanel'
import { WORKSPACE_REFRESH_EVENT } from '../../utils/workspaceEvents'

interface Props {
  projectId: string
  projectName: string
  projectGenre: string
}

export function LeftSidebar({ projectId, projectName, projectGenre }: Props) {
  const [activeNav, setActiveNav] = useState('skills')
  const [tree, setTree] = useState<any[]>([])

  useEffect(() => {
    const fetchTree = async () => {
      try {
        const res = await fetch(`/api/files/${projectId}/tree`)
        const data = await res.json()
        if (Array.isArray(data)) setTree(data)
      } catch {}
    }
    fetchTree()
    const handler = () => fetchTree()
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
  }, [projectId])

  const fileCount = countFiles(tree)

  const navItems = [
    { id: 'skills', icon: '◆', label: '写作技能' },
    { id: 'files', icon: '⊞', label: '文件库', extra: `${fileCount}个` },
    { id: 'outline', icon: '☰', label: '大纲' },
    { id: 'knowledge', icon: '◉', label: '知识图谱' },
    { id: 'search', icon: '🔍', label: '搜索' },
    { id: 'fileSearch', icon: '🔎', label: '文件搜索' },
    { id: 'memoryAdmin', icon: '🧠', label: '记忆管理' },
    { id: 'evolution', icon: '🧬', label: '自进化记忆' },
  ]

  return (
    <div style={styles.container}>
      <div style={styles.projectHeader}>
        <div style={styles.projectNameRow}>
          <span style={styles.projectName}>{projectName}</span>
        </div>
        <div style={styles.projectMeta}>
          <span style={styles.metaText}>类型: {projectGenre || '未设题材'}</span>
        </div>
      </div>

      <div style={styles.navSection}>
        {navItems.map(item => (
          <button
            key={item.id}
            style={activeNav === item.id ? styles.navItemActive : styles.navItem}
            onClick={() => setActiveNav(activeNav === item.id ? '' : item.id)}
          >
            <span style={styles.navIcon}>{item.icon}</span>
            <span style={styles.navLabel}>{item.label}</span>
            {item.extra && <span style={styles.navExtra}>{item.extra}</span>}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {activeNav === 'skills' && (
          <div style={styles.panel}>
            <SkillsPanel visible={true} projectId={projectId} />
          </div>
        )}
        {activeNav === 'files' && (
          <div style={styles.panel}>
            <FileTree projectId={projectId} compact />
          </div>
        )}
        {activeNav === 'outline' && (
          <div style={styles.panel}>
            <OutlineViewer projectId={projectId} />
          </div>
        )}
        {activeNav === 'knowledge' && (
          <div style={styles.panel}>
            <KnowledgeGraph projectId={projectId} visible={true} />
          </div>
        )}
        {activeNav === 'search' && (
          <div style={styles.panel}>
            <MemorySearch projectId={projectId} onSelect={(nodeId) => console.log('Selected node:', nodeId)} />
          </div>
        )}
        {activeNav === 'fileSearch' && (
          <div style={styles.panel}>
            <FileSearch projectId={projectId} onSelect={(filePath) => window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: { type: 'file', path: filePath } }))} />
          </div>
        )}
        {activeNav === 'memoryAdmin' && (
          <div style={styles.panel}>
            <MemoryAdminPanel projectId={projectId} />
          </div>
        )}
        {activeNav === 'evolution' && (
          <div style={styles.panel}>
            <EvolutionMemoryPanel projectId={projectId} visible={true} />
          </div>
        )}
      </div>

      <div style={styles.bottomBar}>
        <button style={styles.bottomIcon} title="设置">⚙</button>
        <button style={styles.bottomIcon} title="帮助">?</button>
      </div>
    </div>
  )
}

function countFiles(nodes: any[]): number {
  let count = 0
  const visit = (node: any) => {
    if (node.is_dir) node.children?.forEach(visit)
    else count++
  }
  nodes.forEach(visit)
  return count
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 260,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#111827',
    borderRight: '1px solid #1f2937',
    overflow: 'hidden',
    height: '100%',
  },
  projectHeader: {
    padding: '16px 16px 12px',
    borderBottom: '1px solid #1f2937',
  },
  projectNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  projectName: {
    fontSize: 17,
    fontWeight: 700,
    color: '#f3f4f6',
    letterSpacing: '-0.01em',
  },
  projectMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#9ca3af',
  },
  metaText: {},
  navSection: {
    padding: '6px 0',
    borderBottom: '1px solid #1f2937',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 16px',
    background: 'transparent',
    border: 'none',
    color: '#d1d5db',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.15s',
  },
  navItemActive: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 16px',
    background: '#1f2937',
    border: 'none',
    borderLeft: '3px solid #14b8a6',
    color: '#f3f4f6',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
  navIcon: { fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 },
  navLabel: { flex: 1, minWidth: 0 },
  navExtra: { fontSize: 11, color: '#6b7280', marginLeft: 'auto', whiteSpace: 'nowrap' },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  panel: {
    height: '100%',
  },
  bottomBar: {
    display: 'flex',
    justifyContent: 'center',
    gap: 16,
    padding: '10px 0',
    borderTop: '1px solid #1f2937',
    background: '#0d1117',
    flexShrink: 0,
  },
  bottomIcon: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
  },
}
