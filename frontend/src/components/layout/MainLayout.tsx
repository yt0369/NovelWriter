import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '../../stores/projectStore'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { LeftSidebar } from './LeftSidebar'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { AgentChat } from '../chat/AgentChat'
import { TimelineView } from '../timeline/TimelineView'
import { ForeshadowingTracker } from '../timeline/ForeshadowingTracker'
import { CharacterManager } from '../characters/CharacterManager'
import { StatsDashboard } from '../stats/StatsDashboard'
import { ProjectSettingsModal } from '../settings/ProjectSettingsModal'
import { AISettingsModal } from '../settings/AISettingsModal'
import { StatusBar } from './StatusBar'
import { ChapterAnalysisPanel } from '../timeline/ChapterAnalysisPanel'
import { UsageStatsPanel } from '../stats/UsageStatsPanel'
import { ui } from '../../styles/ui'
import { WORKSPACE_NAVIGATE_EVENT, WORKSPACE_REFRESH_EVENT, WorkspaceNavigateDetail } from '../../utils/workspaceEvents'
import { APP_VERSION } from '../../version'

type ModalType = 'timeline' | 'foreshadowing' | 'characters' | 'stats' | 'projectSettings' | 'aiSettings' | 'chapterAnalysis' | 'usageStats' | null

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function MainLayout() {
  const navigate = useNavigate()
  const { currentProject, setCurrentProject } = useProjectStore()
  const { activeContent, activeFilePath } = useEditorStore()
  const { chatWidth, chatOpen, setChatWidth, toggleChat } = useUIStore()
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [modal, setModal] = useState<ModalType>(null)
  const [isNarrow, setIsNarrow] = useState(false)
  const [mobileTab, setMobileTab] = useState<'editor' | 'agent'>('editor')
  const [navigationHighlight, setNavigationHighlight] = useState<{ target: string; message: string } | null>(null)

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth < 900)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceNavigateDetail>).detail
      if (!detail?.target) return
      if (detail.target === 'characters') setModal('characters')
      else if (detail.target === 'timeline') setModal('timeline')
      else if (detail.target === 'foreshadowing') setModal('foreshadowing')
      setNavigationHighlight({ target: detail.target, message: navigationHighlightText(detail.target) })
    }
    window.addEventListener(WORKSPACE_NAVIGATE_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_NAVIGATE_EVENT, handler)
  }, [])

  const openModal = (next: ModalType) => setModal(next)

  const startResize = (startEvent: React.MouseEvent<HTMLDivElement>) => {
    startEvent.preventDefault()
    const startX = startEvent.clientX
    const startWidth = chatWidth
    const onMove = (event: MouseEvent) => {
      setChatWidth(clamp(startWidth - (event.clientX - startX), 320, 560))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!currentProject) return null

  const leftSidebar = (
    <LeftSidebar
      projectId={currentProject.id}
      projectName={currentProject.name}
      projectGenre={currentProject.genre || ''}
    />
  )

  const editor = (
    <div style={styles.editor}>
      <MarkdownEditor projectId={currentProject.id} />
    </div>
  )

  const agent = (
    <div style={{ ...styles.chat, width: isNarrow ? '100%' : chatWidth, flexShrink: 0 }}>
      <AgentChat projectId={currentProject.id} />
    </div>
  )

  return (
    <div style={styles.container}>
      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <span style={styles.logo}>NovelWriter</span>
          <span style={styles.localBadge}>本地项目</span>
        </div>
        <div style={styles.topBarRight}>
          <button
            style={activeFilePath ? styles.topBtn : styles.topBtnDisabled}
            onClick={() => activeFilePath && setShowVersionHistory(!showVersionHistory)}
            disabled={!activeFilePath}
          >
            版本历史
          </button>
          <button style={styles.topBtn} onClick={() => openModal('chapterAnalysis')}>章节分析</button>
          <button style={styles.topBtn} onClick={() => openModal('usageStats')}>使用统计</button>
          <button style={styles.topBtn} onClick={toggleChat}>
            {chatOpen ? '隐藏助手' : '显示助手'}
          </button>
          <button style={styles.topBtn} onClick={() => openModal('projectSettings')}>项目编辑</button>
          <button style={styles.topBtn} onClick={() => openModal('aiSettings')}>AI设置</button>
          <button
            style={styles.backBtn}
            onClick={() => { setCurrentProject(null); navigate('/') }}
          >
            返回列表
          </button>
        </div>
      </div>

      {/* Mobile Tabs */}
      {isNarrow && (
        <div style={styles.mobileTabs}>
          <button style={mobileTab === 'editor' ? styles.mobileTabActive : styles.mobileTab} onClick={() => setMobileTab('editor')}>编辑</button>
          <button style={mobileTab === 'agent' ? styles.mobileTabActive : styles.mobileTab} onClick={() => setMobileTab('agent')}>助手</button>
        </div>
      )}

      {/* Body */}
      <div style={isNarrow ? styles.mobileBody : styles.body}>
        {isNarrow ? (
          <>
            {mobileTab === 'editor' && editor}
            {mobileTab === 'agent' && agent}
          </>
        ) : (
          <>
            {leftSidebar}
            {editor}
            {chatOpen && (
              <>
                <div style={styles.resizeHandle} onMouseDown={startResize} />
                {agent}
              </>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {modal === 'timeline' && <TimelineView projectId={currentProject.id} onClose={() => setModal(null)} />}
      {modal === 'foreshadowing' && <ForeshadowingTracker projectId={currentProject.id} onClose={() => setModal(null)} />}
      {modal === 'characters' && <CharacterManager projectId={currentProject.id} onClose={() => setModal(null)} />}
      {modal === 'stats' && <StatsDashboard projectId={currentProject.id} onClose={() => setModal(null)} />}
      {modal === 'projectSettings' && <ProjectSettingsModal projectId={currentProject.id} onClose={() => setModal(null)} />}
      {modal === 'aiSettings' && <AISettingsModal onClose={() => setModal(null)} />}
      {modal === 'chapterAnalysis' && <ChapterAnalysisPanel projectId={currentProject.id} visible onClose={() => setModal(null)} />}
      {modal === 'usageStats' && <UsageStatsPanel visible onClose={() => setModal(null)} />}

      {/* Status Bar */}
      <StatusBar />
    </div>
  )
}

function navigationHighlightText(target: WorkspaceNavigateDetail['target']) {
  const labels: Record<WorkspaceNavigateDetail['target'], string> = {
    files: '已跳到文件区',
    outline: '已跳到大纲区',
    knowledge: '已跳到知识区',
    characters: '已打开角色档案',
    timeline: '已打开时间线',
    foreshadowing: '已打开伏笔面板',
  }
  return labels[target]
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0f1117',
    color: '#e5e7eb',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 16px',
    height: 44,
    minHeight: 44,
    background: '#111827',
    borderBottom: '1px solid #1f2937',
  },
  topBarLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  topBarRight: { display: 'flex', alignItems: 'center', gap: 6 },
  logo: { fontWeight: 800, fontSize: 15, color: '#f3f4f6', letterSpacing: '-0.02em' },
  localBadge: {
    fontSize: 11,
    color: '#6b7280',
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 4,
    padding: '2px 8px',
  },
  topBtn: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 6,
    padding: '5px 12px',
    color: '#d1d5db',
    fontSize: 12,
    cursor: 'pointer',
  },
  topBtnDisabled: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 6,
    padding: '5px 12px',
    color: '#4b5563',
    fontSize: 12,
    cursor: 'not-allowed',
    opacity: 0.5,
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid #374151',
    borderRadius: 6,
    padding: '5px 12px',
    color: '#9ca3af',
    fontSize: 12,
    cursor: 'pointer',
  },
  mobileTabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    background: '#111827',
    borderBottom: '1px solid #1f2937',
  },
  mobileTab: {
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#6b7280',
    padding: '10px 0',
    fontSize: 13,
    cursor: 'pointer',
  },
  mobileTabActive: {
    background: '#1f2937',
    border: 'none',
    borderBottom: '2px solid #14b8a6',
    color: '#f3f4f6',
    padding: '10px 0',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  body: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
  mobileBody: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
  editor: { flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  chat: {
    background: '#111827',
    borderLeft: '1px solid #1f2937',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  },
  resizeHandle: {
    width: 4,
    flexShrink: 0,
    cursor: 'col-resize',
    background: '#1f2937',
    transition: 'background 0.15s',
  },
}
