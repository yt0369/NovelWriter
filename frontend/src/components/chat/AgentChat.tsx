import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatStore, ChatMessage } from '../../stores/chatStore'
import { AgentInput } from './AgentInput'
import { PendingChange } from './PendingChangesPanel'
import { KnowledgeCandidatesPanel } from '../memory/KnowledgeCandidatesPanel'
import { QuestionnairePanel } from '../common/QuestionnairePanel'
import { MemoryDebugPanel } from './MemoryDebugPanel'
import { GlobalSoulSettings } from '../settings/GlobalSoulSettings'
import { PlanPanel } from '../plan/PlanPanel'
import { usePlanStore } from '../../stores/planStore'
import { useTodoStore } from '../../stores/todoStore'
import { ui } from '../../styles/ui'
import { AISettingsModal } from '../settings/AISettingsModal'
import { emitFileUpdated, emitKnowledgeUpdated, emitPendingUpdated, WORKSPACE_REFRESH_EVENT } from '../../utils/workspaceEvents'
import { useEditorStore } from '../../stores/editorStore'

interface TodoItem {
  id: string
  text: string
  done: boolean
}

interface ToolCallInfo {
  name: string
  args: Record<string, unknown>
  result?: unknown
}

interface AgentDecision {
  intent?: string
  confidence?: number
  suggested_workflow?: string | null
  reasons?: string[]
  active_skills?: Array<{ id?: string; name?: string; reason?: string; trigger?: string; source?: string }>
  context_sources?: string[]
  pending_change_policy?: string
  will_write?: boolean
  warnings?: Array<{ code?: string; severity?: string; message?: string }>
  turn_id?: number
}

interface Props {
  projectId: string
}

export type RightPanelTab = 'chat' | 'knowledge' | 'history' | 'debug' | 'plan'
export type WorkflowDisplayState = 'idle' | 'running' | 'pending_approval' | 'completed' | 'failed'

const PANEL_TABS: Array<{ id: RightPanelTab; label: string; icon: string }> = [
  { id: 'knowledge', label: '知识', icon: '◉' },
  { id: 'plan', label: '计划', icon: '📋' },
  { id: 'debug', label: '调试', icon: '🔧' },
  { id: 'history', label: '历史', icon: '⏱' },
]

function normalizeSavedMessage(raw: Record<string, unknown>): ChatMessage {
  const rawParts = raw.raw_parts as Record<string, unknown> | undefined
  const metadata = raw.metadata as Record<string, unknown> | undefined
  return {
    id: String(raw.id || `${Date.now()}-${Math.random()}`),
    role: (raw.role === 'assistant' ? 'model' : raw.role) as ChatMessage['role'],
    content: String(raw.content || ''),
    reasoning_content: String(raw.reasoning_content || rawParts?.reasoning_content || ''),
    reasoning_collapsed: true,
    metadata: metadata || {},
    timestamp: Number(raw.timestamp || Date.now()),
  }
}

export function AgentChat({ projectId }: Props) {
  const {
    messages,
    isLoading,
    addMessage,
    setMessages,
    setIsLoading,
    sessionId,
    setSessionId,
    sessions,
    setSessions,
    addSession,
    removeSession,
    updateSessionTitle,
    updateLastModelMessage,
    updateLastModelReasoning,
    toggleReasoning,
    removeMessagesFrom,
    clearMessages,
  } = useChatStore()
  const { activeFilePath } = useEditorStore()
  const [input, setInput] = useState('')
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([])
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const pendingChangesRef = useRef<PendingChange[]>([])
  useEffect(() => { pendingChangesRef.current = pendingChanges }, [pendingChanges])
  const [questionnaire, setQuestionnaire] = useState<any>(null)
  const [todoItems, setTodoItems] = useState<TodoItem[]>([])
  const [workflowStatus, setWorkflowStatus] = useState('')
  const [workflowState, setWorkflowState] = useState<WorkflowDisplayState>('idle')
  const [refreshKey, setRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState<RightPanelTab>('chat')
  const [agentDecision, setAgentDecision] = useState<AgentDecision | null>(null)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [showSessionList, setShowSessionList] = useState(false)
  const [showAISettings, setShowAISettings] = useState(false)
  const [showGlobalSoul, setShowGlobalSoul] = useState(false)
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editMsgText, setEditMsgText] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const settingsRef = useRef<HTMLDivElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)
  const editingTitleRef = useRef<HTMLInputElement>(null)
  const sessionClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleWsMessageRef = useRef<((data: Record<string, unknown>) => void) | null>(null)
  const turnCounterRef = useRef(0)

  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setSessionId(null)
    clearMessages()
    setActiveTab('chat')
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current)
      loadingTimerRef.current = null
    }
  }, [projectId, setSessionId, clearMessages])

  useEffect(() => () => {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  useEffect(() => {
    const initSession = async () => {
      try {
        const sessionsRes = await fetch(`/api/agent/${projectId}/sessions`)
        const sessions = await sessionsRes.json()
        let activeSession = Array.isArray(sessions) && sessions.length > 0 ? sessions[0] : null
        if (!activeSession) {
          const res = await fetch(`/api/agent/${projectId}/sessions`, { method: 'POST' })
          activeSession = await res.json()
        }
        setSessionId(activeSession.id)
        const messagesRes = await fetch(`/api/agent/${projectId}/sessions/${activeSession.id}/messages`)
        const savedMessages = await messagesRes.json()
        if (Array.isArray(savedMessages)) {
          setMessages(savedMessages.map(normalizeSavedMessage))
          if (savedMessages.length > 0) setActiveTab('chat')
        }
      } catch {}
    }
    if (!sessionId) initSession()
  }, [projectId, sessionId, setMessages, setSessionId])

  // 只在消息数量变化或 tab 切换时滚动，不因消息内容修改而滚动
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    const count = messages.length
    if (count !== prevMsgCountRef.current || activeTab) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      prevMsgCountRef.current = count
    }
  }, [messages.length, activeTab])

  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1)
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
  }, [])

  // 加载待审批变更（从数据库）
  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await fetch(`/api/agent/${projectId}/pending-changes`)
        const data = await res.json()
        if (Array.isArray(data)) {
          setPendingChanges(data)
          if (data.length === 0) {
            useEditorStore.getState().setDiffMode(null)
            // 如果没有待审批变更，清除 pending_approval 状态
            if (workflowState === 'pending_approval') {
              setWorkflowState('completed')
              setWorkflowStatus('所有变更已处理')
            }
          }
        }
      } catch {}
    }
    fetchPending()
  }, [projectId, refreshKey])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // settingsRef 包含了按钮和下拉菜单，所以点击菜单项不会触发关闭
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false)
      }
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node)) {
        setShowSessionList(false)
        setEditingSessionId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const connectWs = useCallback(() => {
    if (!sessionId) return
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/api/agent/ws/agent/${projectId}/${sessionId}`
    const ws = new WebSocket(url)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleWsMessageRef.current?.(data)
      } catch {}
    }
    const failActiveRequest = (message: string) => {
      wsRef.current = null
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current)
        loadingTimerRef.current = null
      }
      if (useChatStore.getState().isLoading) {
        setIsLoading(false)
        setWorkflowState('failed')
        setWorkflowStatus(message)
        updateLastModelMessage(message)
      }
    }

    ws.onclose = () => failActiveRequest('连接已断开，请重试。')
    ws.onerror = () => failActiveRequest('连接失败，请检查后端服务或网络后重试。')
    wsRef.current = ws
  }, [projectId, sessionId, setIsLoading, updateLastModelMessage])

  const handleWsMessage = (data: Record<string, unknown>) => {
    switch (data.type) {
      case 'delta':
        updateLastModelMessage(`${useChatStore.getState().messages.at(-1)?.content || ''}${data.content as string}`)
        break
      case 'reasoning_delta':
        updateLastModelReasoning(data.content as string)
        break
      case 'intent': {
        const decision = data as AgentDecision
        // 忽略旧轮次的 intent 事件（审批续跑产生的）
        if (decision.turn_id !== undefined && decision.turn_id !== turnCounterRef.current) break
        setAgentDecision(decision)
        setWorkflowStatus(`识别意图：${intentLabel(decision.intent)}`)
        break
      }
      case 'execution_plan': {
        const plan = (data.plan || data) as AgentDecision
        usePlanStore.getState().setPlan(plan)
        setAgentDecision(prev => ({ ...(prev || {}), ...plan }))
        setWorkflowStatus(`执行计划：${intentLabel(plan.intent)}`)
        break
      }
      case 'tool_start':
        setToolCalls(prev => [...prev, {
          name: data.name as string,
          args: (data.args as Record<string, unknown>) || {},
        }])
        break
      case 'tool_result': {
        const name = data.name as string
        setToolCalls(prev => {
          const updated = [...prev]
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].name === name) {
              updated[i] = { ...updated[i], result: data.result }
              break
            }
          }
          return updated
        })
        break
      }
      case 'workflow_start':
        setWorkflowStatus(`工作流运行中：${workflowLabel(data.workflow_type as string)}`)
        setWorkflowState('running')
        break
      case 'workflow_result':
        setWorkflowStatus(`工作流结果：${workflowLabel(data.workflow_type as string)} · ${data.status || ''}`)
        break
      case 'approval_required': {
        const pc = data.pending_change as PendingChange
        setPendingChanges(prev => [...prev, pc])
        setWorkflowState('pending_approval')
        setWorkflowStatus('已生成待审批变更')
        setRefreshKey(k => k + 1)  // 触发 PendingChangesPanel 刷新
        break
      }
      case 'approval_result': {
        const status = data.status as string
        const changeId = data.change_id as string
        const resultData = data.result as Record<string, unknown> | undefined
        setPendingChanges(prev => prev.filter(c => c.id !== changeId))
        if (useEditorStore.getState().activePendingChange?.id === changeId) {
          useEditorStore.getState().setDiffMode(null)
        }
        if (status === 'approved') {
          const filePath = (resultData?.file_path as string) || ''
          emitFileUpdated(filePath)
          emitKnowledgeUpdated()
          setWorkflowStatus('变更已批准，文件已刷新')
          setWorkflowState('completed')
        } else {
          setWorkflowStatus('变更已拒绝')
          setWorkflowState('completed')
          emitPendingUpdated('pending-rejected')
        }
        break
      }
      case 'todo': {
        const items = data.items as TodoItem[]
        if (items) {
          setTodoItems(items)
          useTodoStore.getState().setTodos(items)
        }
        break
      }
      case 'knowledge_extracted': {
        emitKnowledgeUpdated()
        break
      }
      case 'questionnaire': {
        setQuestionnaire(data.questionnaire)
        break
      }
      case 'done': {
        if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null }
        const content = data.content as string
        const currentContent = useChatStore.getState().messages.at(-1)?.content || ''
        const finalContent = content || currentContent || (
          data.reasoning_content
            ? '本次只返回了思考过程，没有生成最终回答，请重试或换一种说法。'
            : '本次没有生成最终回答，请重试或换一种说法。'
        )
        updateLastModelMessage(finalContent)
        setIsLoading(false)
        // 如果有待审批变更，保持 pending_approval 状态
        // 注意：pendingChanges 是组件状态，需要通过 ref 访问
        const pendingCount = pendingChangesRef.current?.length || 0
        if (pendingCount > 0) {
          setWorkflowState('pending_approval')
          setWorkflowStatus(`已完成，但有 ${pendingCount} 个待审批变更`)
        } else {
          setWorkflowState('completed')
        }
        // 保留工具调用显示（如果有待审批变更）
        if (pendingCount === 0) {
          setToolCalls([])
        }
        break
      }
      case 'error': {
        if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null }
        const errorMsg = data.error as string
        updateLastModelMessage(`错误: ${errorMsg}`)
        setIsLoading(false)
        setWorkflowState('failed')
        setWorkflowStatus(errorMsg || '执行失败')
        setToolCalls([])
        break
      }
    }
  }
  handleWsMessageRef.current = handleWsMessage

  const handleCancel = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsLoading(false)
    setWorkflowState('idle')
    setToolCalls([])
    setAgentDecision(null)
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current)
      loadingTimerRef.current = null
    }
  }

  const handleSend = () => {
    if (!input.trim() || isLoading) return
    turnCounterRef.current++

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')
    addMessage({
      id: (Date.now() + 1).toString(),
      role: 'model',
      content: '',
      timestamp: Date.now(),
    })

    setIsLoading(true)
    setWorkflowState('running')
    setToolCalls([])
    setAgentDecision(null)

    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
    loadingTimerRef.current = setTimeout(() => {
      setIsLoading(false)
      setWorkflowState('failed')
      updateLastModelMessage(useChatStore.getState().messages.at(-1)?.content || '（响应超时，请重试）')
    }, 300000)

    const sendChat = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'chat', message: userMsg.content, active_file_path: activeFilePath || '', turn_id: turnCounterRef.current }))
      }
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWs()
      let check: ReturnType<typeof setInterval>
      const connectTimeout = setTimeout(() => {
        clearInterval(check)
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          wsRef.current.close()
          wsRef.current = null
        }
        if (useChatStore.getState().isLoading) {
          if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null }
          setIsLoading(false)
          setWorkflowState('failed')
          setWorkflowStatus('连接超时，请确认后端服务正在运行。')
          updateLastModelMessage('连接超时，请确认后端服务正在运行后重试。')
        }
      }, 10000)
      check = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(check)
          clearTimeout(connectTimeout)
          sendChat()
        }
      }, 100)
    } else {
      sendChat()
    }
  }

  const handleApprove = async (changeId: string) => {
    // 确认对话框防止意外批准
    const change = pendingChanges.find(c => c.id === changeId)
    if (!confirm(`确定批准变更？\n文件: ${change?.file_path || '未知'}`)) {
      return
    }
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes/${changeId}/approve`, { method: 'POST' })
      if (res.ok || res.status === 404) {
        // 404 说明已经被批准过了
        const filePath = change?.file_path || ''
        emitFileUpdated(filePath)
        emitKnowledgeUpdated()
        setPendingChanges(prev => {
          const remaining = prev.filter(c => c.id !== changeId)
          if (remaining.length === 0) {
            setWorkflowStatus('所有变更已批准')
            setWorkflowState('completed')
          } else {
            setWorkflowStatus(`还有 ${remaining.length} 个待审批变更`)
            setWorkflowState('pending_approval')
          }
          return remaining
        })
        if (useEditorStore.getState().activePendingChange?.id === changeId) {
          useEditorStore.getState().setDiffMode(null)
        }
      } else {
        const data = await res.json().catch(() => ({}))
        setWorkflowStatus(`批准失败: ${data.detail || data.error || '未知错误'}`)
        setWorkflowState('failed')
      }
    } catch (e) {
      console.error('[approve] error:', e)
    }
  }

  const handleReject = async (changeId: string) => {
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes/${changeId}/reject`, { method: 'POST' })
      if (res.ok || res.status === 404) {
        // 404 说明已经被拒绝过了
        emitPendingUpdated('pending-rejected')
        setPendingChanges(prev => {
          const remaining = prev.filter(c => c.id !== changeId)
          if (remaining.length === 0) {
            setWorkflowStatus('所有变更已处理')
            setWorkflowState('completed')
          } else {
            setWorkflowStatus(`还有 ${remaining.length} 个待审批变更`)
            setWorkflowState('pending_approval')
          }
          return remaining
        })
        if (useEditorStore.getState().activePendingChange?.id === changeId) {
          useEditorStore.getState().setDiffMode(null)
        }
      } else {
        const data = await res.json().catch(() => ({}))
        setWorkflowStatus(`拒绝失败: ${data.detail || data.error || '未知错误'}`)
        setWorkflowState('failed')
      }
    } catch (e) {
      console.error('[reject] error:', e)
    }
  }

  const handleRevise = async (changeId: string, newContent: string, description: string) => {
    const res = await fetch(`/api/agent/${projectId}/pending-changes/${changeId}/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_content: newContent, description }),
    })
    const data = await res.json()
    if (res.ok) {
      const revised = data as PendingChange
      setPendingChanges(prev => prev.map(c => c.id === changeId ? revised : c))
      useEditorStore.getState().setDiffMode(revised)
      setWorkflowStatus('变更已修订，等待审批')
      setWorkflowState('pending_approval')
      emitPendingUpdated('pending-revised')
    } else {
      setWorkflowStatus(`修订失败: ${data.detail || data.error || '未知错误'}`)
      setWorkflowState('failed')
    }
  }

  const handleWorkflowStatus = (status: string) => {
    setWorkflowStatus(status)
    if (status.includes('运行中')) setWorkflowState('running')
    else if (status.includes('待审批')) setWorkflowState('pending_approval')
    else if (status.includes('失败')) setWorkflowState('failed')
    else if (status.includes('完成') || status.includes('生成')) setWorkflowState('completed')
  }

  // ─── 会话管理 ────────────────────────────────────────────

  const fetchSessions = async () => {
    try {
      const res = await fetch(`/api/agent/${projectId}/sessions`)
      const data = await res.json()
      if (Array.isArray(data)) setSessions(data)
    } catch {}
  }

  const handleNewSession = async () => {
    try {
      const res = await fetch(`/api/agent/${projectId}/sessions`, { method: 'POST' })
      const data = await res.json()
      if (data.id) {
        handleSwitchSession(data.id)
        addSession({ id: data.id, title: data.title, last_modified: Date.now() })
        setShowSessionList(false)
      }
    } catch {}
  }

  const handleSwitchSession = async (newSessionId: string) => {
    if (newSessionId === sessionId) { setShowSessionList(false); return }
    wsRef.current?.close()
    wsRef.current = null
    setSessionId(newSessionId)
    setMessages([])
    setActiveTab('chat')
    setToolCalls([])
    setAgentDecision(null)
    setPendingChanges([])
    useEditorStore.getState().setDiffMode(null)
    setWorkflowState('idle')
    setWorkflowStatus('')
    setShowSessionList(false)

    try {
      const res = await fetch(`/api/agent/${projectId}/sessions/${newSessionId}/messages`)
      const saved = await res.json()
      if (Array.isArray(saved)) setMessages(saved.map(normalizeSavedMessage))
    } catch {}
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await fetch(`/api/agent/${projectId}/sessions/${id}`, { method: 'DELETE' })
      removeSession(id)
      if (id === sessionId) {
        const remaining = sessions.filter(s => s.id !== id)
        if (remaining.length > 0) {
          handleSwitchSession(remaining[0].id)
        } else {
          handleNewSession()
        }
      }
    } catch {}
  }

  const handleRenameSession = async (id: string) => {
    const trimmed = editingTitle.trim()
    if (!trimmed) { setEditingSessionId(null); return }
    if (trimmed === sessions.find(s => s.id === id)?.title) { setEditingSessionId(null); return }
    try {
      await fetch(`/api/agent/${projectId}/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      updateSessionTitle(id, trimmed)
    } catch {}
    setEditingSessionId(null)
  }

  useEffect(() => {
    fetchSessions()
  }, [projectId])

  // ─── 消息操作 ────────────────────────────────────────────

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMsgId(msg.id)
    setEditMsgText(msg.content)
  }

  const handleSaveEdit = () => {
    if (!editingMsgId || !editMsgText.trim()) return
    turnCounterRef.current++
    const idx = messages.findIndex(m => m.id === editingMsgId)
    if (idx === -1) { setEditingMsgId(null); return }

    const newText = editMsgText.trim()
    // 保留编辑后的消息，删除后续所有消息（同时从数据库删除）
    const newMsgs = messages.slice(0, idx + 1).map((m, i) =>
      i === idx ? { ...m, content: newText } : m
    )
    // 从数据库删除后续消息
    for (let i = idx + 1; i < messages.length; i++) {
      fetch(`/api/agent/${projectId}/sessions/${sessionId}/messages/${messages[i].id}`, { method: 'DELETE' }).catch(() => {})
    }
    setMessages(newMsgs)
    setEditingMsgId(null)
    setEditMsgText('')

    // 通过 WebSocket 重新发送
    setIsLoading(true)
    setWorkflowState('running')
    setToolCalls([])
    setAgentDecision(null)

    addMessage({
      id: (Date.now() + 1).toString(),
      role: 'model',
      content: '',
      timestamp: Date.now(),
    })

    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
    loadingTimerRef.current = setTimeout(() => {
      setIsLoading(false)
      setWorkflowState('failed')
      updateLastModelMessage(useChatStore.getState().messages.at(-1)?.content || '（响应超时，请重试）')
    }, 300000)

    const sendChat = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'chat', message: newText, active_file_path: activeFilePath || '', turn_id: turnCounterRef.current }))
      }
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWs()
      let check: ReturnType<typeof setInterval>
      const connectTimeout = setTimeout(() => {
        clearInterval(check)
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          wsRef.current.close()
          wsRef.current = null
        }
        if (useChatStore.getState().isLoading) {
          if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null }
          setIsLoading(false)
          setWorkflowState('failed')
          setWorkflowStatus('连接超时，请确认后端服务正在运行。')
          updateLastModelMessage('连接超时，请确认后端服务正在运行后重试。')
        }
      }, 10000)
      check = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(check)
          clearTimeout(connectTimeout)
          sendChat()
        }
      }, 100)
    } else {
      sendChat()
    }
  }

  const handleCancelEdit = () => {
    setEditingMsgId(null)
    setEditMsgText('')
  }

  const handleDeleteMessage = (msgId: string) => {
    const idx = messages.findIndex(m => m.id === msgId)
    if (idx === -1) return
    const msg = messages[idx]
    const toDeleteIds: string[] = [msgId]
    if (msg.role === 'model') {
      // AI 消息：删除自身及后续所有消息
      for (let i = idx + 1; i < messages.length; i++) toDeleteIds.push(messages[i].id)
      removeMessagesFrom(msgId)
    } else {
      // 用户消息：删除自身，如果下一条是 AI 回复也一并删除
      const next = messages[idx + 1]
      if (next && next.role === 'model') toDeleteIds.push(next.id)
      const newMsgs = messages.filter((_, i) => i !== idx && (next && next.role === 'model' ? i !== idx + 1 : true))
      setMessages(newMsgs)
    }
    for (const id of toDeleteIds) {
      fetch(`/api/agent/${projectId}/sessions/${sessionId}/messages/${id}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const handleRegenerateMessage = (msgId: string) => {
    const idx = messages.findIndex(m => m.id === msgId)
    if (idx === -1) return
    turnCounterRef.current++
    // 删除该 AI 消息及后续所有消息
    removeMessagesFrom(msgId)
    // 找到最后一条用户消息并重新发送
    const lastUserMsg = [...messages].slice(0, idx).reverse().find(m => m.role === 'user')
    if (!lastUserMsg) return

    // 构建新的消息列表（保留到最后一条用户消息）
    const userIdx = messages.findIndex(m => m.id === lastUserMsg.id)
    setMessages(messages.slice(0, userIdx + 1))

    // 通过 WebSocket 重新发送
    setIsLoading(true)
    setWorkflowState('running')
    setToolCalls([])
    setAgentDecision(null)

    addMessage({
      id: (Date.now() + 1).toString(),
      role: 'model',
      content: '',
      timestamp: Date.now(),
    })

    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
    loadingTimerRef.current = setTimeout(() => {
      setIsLoading(false)
      setWorkflowState('failed')
      updateLastModelMessage(useChatStore.getState().messages.at(-1)?.content || '（响应超时，请重试）')
    }, 300000)

    const sendChat = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'chat', message: lastUserMsg.content, active_file_path: activeFilePath || '', turn_id: turnCounterRef.current }))
      }
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWs()
      let check: ReturnType<typeof setInterval>
      const connectTimeout = setTimeout(() => {
        clearInterval(check)
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          wsRef.current.close()
          wsRef.current = null
        }
        if (useChatStore.getState().isLoading) {
          if (loadingTimerRef.current) { clearTimeout(loadingTimerRef.current); loadingTimerRef.current = null }
          setIsLoading(false)
          setWorkflowState('failed')
          setWorkflowStatus('连接超时，请确认后端服务正在运行。')
          updateLastModelMessage('连接超时，请确认后端服务正在运行后重试。')
        }
      }, 10000)
      check = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(check)
          clearTimeout(connectTimeout)
          sendChat()
        }
      }, 100)
    } else {
      sendChat()
    }
  }

  const toolDisplayName: Record<string, string> = {
    read_file: '读取文件',
    write_file: '写入文件',
    patch_file: '修改文件',
    glob: '搜索文件',
    grep: '搜索内容',
    thinking: '思考中',
    final_answer: '整理回复',
    ask_questions: '准备提问',
    workflow_chapter_draft: '章节生成',
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div ref={sessionListRef} style={{ position: 'relative', flex: 1 }}>
          <div
            style={styles.headerTitleRow}
            onClick={() => { setShowSessionList(v => !v); fetchSessions() }}
          >
            <span style={styles.headerTitle}>{sessions.find(s => s.id === sessionId)?.title || '对话主入口'}</span>
            <span style={styles.sessionChevron}>{showSessionList ? '▴' : '▾'}</span>
          </div>
          {workflowStatus && <div style={styles.headerStatus}>{workflowStatus}</div>}
          {showSessionList && (
            <div style={styles.sessionDropdown}>
              <button style={styles.newSessionBtn} onClick={handleNewSession}>
                + 新建对话
              </button>
              <div style={styles.sessionDivider} />
              <div style={styles.sessionListScroll}>
                {sessions.map(s => (
                  <div
                    key={s.id}
                    style={{
                      ...styles.sessionItem,
                      ...(s.id === sessionId ? styles.sessionItemActive : {}),
                    }}
                    onClick={() => {
                      // 双击检测：250ms 内两次点击 = 重命名
                      if (sessionClickTimerRef.current) {
                        clearTimeout(sessionClickTimerRef.current)
                        sessionClickTimerRef.current = null
                        setEditingSessionId(s.id)
                        setEditingTitle(s.title)
                      } else {
                        sessionClickTimerRef.current = setTimeout(() => {
                          sessionClickTimerRef.current = null
                          handleSwitchSession(s.id)
                        }, 250)
                      }
                    }}
                  >
                    {editingSessionId === s.id ? (
                      <input
                        ref={editingTitleRef}
                        style={styles.sessionTitleInput}
                        value={editingTitle}
                        onChange={e => setEditingTitle(e.target.value)}
                        onBlur={() => handleRenameSession(s.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameSession(s.id)
                          if (e.key === 'Escape') setEditingSessionId(null)
                        }}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span style={styles.sessionTitle}>{s.title}</span>
                    )}
                    {s.id !== editingSessionId && (
                      <button
                        style={styles.sessionDeleteBtn}
                        onClick={e => { e.stopPropagation(); handleDeleteSession(s.id) }}
                        title="删除会话"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={styles.headerRight}>
          <span style={{ ...styles.stateBadge, ...stateStyle(workflowState) }}>{statusLabel(workflowState)}</span>
          <div ref={settingsRef} style={{ position: 'relative' }}>
            <button style={styles.settingsBtn} onClick={() => setShowSettingsMenu(v => !v)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {showSettingsMenu && (
              <div style={styles.settingsDropdown}>
                {PANEL_TABS.map(tab => (
                  <button
                    key={tab.id}
                    style={{
                      ...styles.settingsItem,
                      ...(activeTab === tab.id && activeTab !== 'chat' ? styles.settingsItemActive : {}),
                    }}
                    onClick={() => { setActiveTab(tab.id); setShowSettingsMenu(false) }}
                  >
                    <span style={styles.settingsItemIcon}>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
                <div style={styles.settingsDivider} />
                <button
                  style={styles.settingsItem}
                  onClick={() => { setShowAISettings(true); setShowSettingsMenu(false) }}
                >
                  <span style={styles.settingsItemIcon}>⚡</span>
                  <span>AI配置</span>
                </button>
                <button
                  style={styles.settingsItem}
                  onClick={() => { setShowGlobalSoul(true); setShowSettingsMenu(false) }}
                >
                  <span style={styles.settingsItemIcon}>◉</span>
                  <span>全局 Soul</span>
                </button>
                <button
                  style={styles.settingsItem}
                  onClick={() => {
                    fetch(`/api/agent/${projectId}/sessions/${sessionId}/messages`, { method: 'DELETE' }).catch(() => {})
                    clearMessages()
                    setShowSettingsMenu(false)
                  }}
                >
                  <span style={styles.settingsItemIcon}>×</span>
                  <span>清空对话</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={styles.content}>
        {/* 审批提示条 — 替代弹窗 */}
        {pendingChanges.length > 0 && activeTab === 'chat' && (
          <div style={styles.approvalBanner}>
            <div style={styles.approvalBannerHeader}>
              <span style={styles.approvalBannerTitle}>⚠ 待审批变更 ({pendingChanges.length})</span>
            </div>
            {pendingChanges.map(pc => (
              <button
                key={pc.id}
                style={styles.approvalItem}
                onClick={() => {
                  useEditorStore.getState().setDiffMode(pc)
                }}
                data-testid="approval-banner-item"
              >
                <span style={styles.approvalIcon}>⚠</span>
                <span style={styles.approvalTool}>{pc.tool_name}</span>
                <span style={styles.approvalFile}>{pc.file_path}</span>
                <span style={styles.approvalArrow}>审查 &gt;</span>
              </button>
            ))}
          </div>
        )}

        {activeTab !== 'chat' && (
          <div style={styles.panelHeader}>
            <button style={styles.backBtn} onClick={() => setActiveTab('chat')}>
              ← 返回对话
            </button>
            <span style={styles.panelTitle}>{PANEL_TABS.find(t => t.id === activeTab)?.label}</span>
          </div>
        )}

        {activeTab === 'chat' && (
          <ChatPane
            messages={messages}
            toolCalls={toolCalls}
            toolDisplayName={toolDisplayName}
            todoItems={todoItems}
            agentDecision={agentDecision}
            questionnaire={questionnaire}
            input={input}
            isLoading={isLoading}
            hoveredMsgId={hoveredMsgId}
            editingMsgId={editingMsgId}
            editMsgText={editMsgText}
            onInput={setInput}
            onSend={handleSend}
            onCancel={handleCancel}
            onQuestionnaireSubmit={(answers) => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'chat',
                  message: JSON.stringify({ type: 'questionnaire_answer', answers }),
                  turn_id: turnCounterRef.current++,
                }))
              }
              setQuestionnaire(null)
            }}
            onToggleReasoning={toggleReasoning}
            onMouseEnterMsg={setHoveredMsgId}
            onMouseLeaveMsg={() => setHoveredMsgId(null)}
            onStartEdit={handleStartEdit}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onEditMsgTextChange={setEditMsgText}
            onDeleteMsg={handleDeleteMessage}
            onRegenerate={handleRegenerateMessage}
            messagesEndRef={messagesEndRef}
          />
        )}

        {activeTab === 'knowledge' && (
          <KnowledgeCandidatesPanel projectId={projectId} refreshKey={refreshKey} />
        )}

        {activeTab === 'history' && (
          <div style={styles.historyPanel}>
            <div style={styles.historyHeader}>
              <span style={styles.historyTitle}>会话历史</span>
              <span style={styles.historyCount}>{sessions.length} 个会话</span>
            </div>
            <div style={styles.historyItems}>
              {sessions.map(s => (
                <div
                  key={s.id}
                  style={{
                    ...styles.historyItem,
                    background: s.id === sessionId ? '#1f2937' : 'transparent',
                  }}
                  onClick={() => {
                    setSessionId(s.id)
                    setActiveTab('chat')
                    fetch(`/api/agent/${projectId}/sessions/${s.id}/messages`)
                      .then(r => r.json())
                      .then(data => {
                        if (Array.isArray(data)) {
                          setMessages(data.map(normalizeSavedMessage))
                        }
                      })
                      .catch(() => {})
                  }}
                >
                  <div style={styles.historyItemTitle}>{s.title || '未命名会话'}</div>
                  <div style={styles.historyItemMeta}>
                    {new Date(s.last_modified * 1000).toLocaleDateString()}
                  </div>
                </div>
              ))}
              {sessions.length === 0 && (
                <div style={styles.emptyHistory}>暂无会话历史</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'debug' && sessionId && (
          <MemoryDebugPanel projectId={projectId} sessionId={sessionId} visible={activeTab === 'debug'} />
        )}

        {activeTab === 'plan' && (
          <PlanPanel />
        )}
      </div>

      <div style={styles.infoBar}>
        <span style={styles.infoModel}>DeepSeek V3</span>
        <span style={styles.infoDot}>·</span>
        <span style={styles.infoContext}>上下文 {messages.length > 0 ? Math.min(messages.length * 2, 128) : 0}k tokens</span>
        {pendingChanges.length > 0 && (
          <span style={styles.infoPending}> · {pendingChanges.length} 个待审批</span>
        )}
      </div>

      {showAISettings && <AISettingsModal onClose={() => setShowAISettings(false)} />}
      {showGlobalSoul && <GlobalSoulSettings visible={showGlobalSoul} onClose={() => setShowGlobalSoul(false)} />}
    </div>
  )
}

function ChatPane({
  messages,
  toolCalls,
  toolDisplayName,
  todoItems,
  agentDecision,
  questionnaire,
  input,
  isLoading,
  hoveredMsgId,
  editingMsgId,
  editMsgText,
  onInput,
  onSend,
  onCancel,
  onQuestionnaireSubmit,
  onToggleReasoning,
  onMouseEnterMsg,
  onMouseLeaveMsg,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditMsgTextChange,
  onDeleteMsg,
  onRegenerate,
  messagesEndRef,
}: {
  messages: ChatMessage[]
  toolCalls: ToolCallInfo[]
  toolDisplayName: Record<string, string>
  todoItems: TodoItem[]
  agentDecision: AgentDecision | null
  questionnaire: any
  input: string
  isLoading: boolean
  hoveredMsgId: string | null
  editingMsgId: string | null
  editMsgText: string
  onInput: (value: string) => void
  onSend: () => void
  onCancel: () => void
  onQuestionnaireSubmit: (answers: Record<string, string | string[]>) => void
  onToggleReasoning: (id: string) => void
  onMouseEnterMsg: (id: string) => void
  onMouseLeaveMsg: () => void
  onStartEdit: (msg: ChatMessage) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditMsgTextChange: (text: string) => void
  onDeleteMsg: (id: string) => void
  onRegenerate: (id: string) => void
  messagesEndRef: React.RefObject<HTMLDivElement | null>
}) {
  const [showSuggestions, setShowSuggestions] = useState(true)

  const guidePrompts = [
    { icon: '📋', text: '帮我规划这本小说的创作，先告诉我下一步怎么推进。' },
    { icon: '🔍', text: '根据项目基础信息，先帮我分析这本书最适合的创作方向。' },
    { icon: '🌍', text: '帮我构建世界观和核心设定，生成待审批变更。' },
    { icon: '👥', text: '帮我设计主角、核心配角和他们之间的关系张力。' },
    { icon: '✍️', text: '继续推进当前章节：先说明会参考哪些材料，再生成待审批正文。' },
  ]

  return (
    <div style={styles.chatPane}>
      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={ui.color.primary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div style={styles.emptyTitle}>开始对话</div>
            <div style={styles.emptySubtitle}>描述你的创作目标，AI 会给出建议或生成待审批变更</div>

            <div style={styles.suggestionSection}>
              <button
                style={styles.suggestionToggle}
                onClick={() => setShowSuggestions(v => !v)}
              >
                <span>下一步建议</span>
                <span style={{ ...styles.chevron, transform: showSuggestions ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
              </button>
              {showSuggestions && (
                <div style={styles.suggestionList}>
                  {guidePrompts.map((item, i) => (
                    <button
                      key={i}
                      style={styles.suggestionCard}
                      onClick={() => onInput(item.text)}
                    >
                      <span style={styles.suggestionIcon}>{item.icon}</span>
                      <span style={styles.suggestionText}>{item.text}</span>
                      <span style={styles.suggestionArrow}>›</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {messages.map((msg, index) => {
          const isPendingModelMessage = msg.role === 'model' && index === messages.length - 1 && isLoading && !msg.content
          const modelContent = msg.content || (isPendingModelMessage ? '思考中...' : '（空回复）')
          const isUser = msg.role === 'user'
          const isHovered = hoveredMsgId === msg.id
          const isEditing = editingMsgId === msg.id

          // 内联编辑模式
          if (isEditing && isUser) {
            return (
              <div key={msg.id} style={styles.editContainer}>
                <div style={styles.editBox}>
                  <textarea
                    style={styles.editTextarea}
                    value={editMsgText}
                    onChange={e => onEditMsgTextChange(e.target.value)}
                    rows={Math.min(10, Math.max(3, editMsgText.split('\n').length))}
                    autoFocus
                  />
                  <div style={styles.editActions}>
                    <button style={styles.editCancelBtn} onClick={onCancelEdit}>取消</button>
                    <button style={styles.editSaveBtn} onClick={onSaveEdit}>保存并重试</button>
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div
              key={msg.id}
              style={styles.messageGroup}
              onMouseEnter={() => onMouseEnterMsg(msg.id)}
              onMouseLeave={() => onMouseLeaveMsg()}
            >
              <div style={{
                ...styles.messageRow,
                justifyContent: isUser ? 'flex-end' : 'flex-start',
              }}>
                {!isUser && (
                  <div style={{ ...styles.avatar, ...styles.aiAvatar }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1.5h-4v-1.5c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z" />
                      <path d="M10 11h4" />
                      <path d="M9 22h6" />
                      <path d="M10 17h4" />
                    </svg>
                  </div>
                )}
                <div style={{
                  ...styles.messageBubble,
                  ...(isUser ? styles.userBubble : styles.aiBubble),
                }}>
                  {msg.role === 'model' && msg.reasoning_content && (
                    <div style={styles.reasoningBox}>
                      <button style={styles.reasoningToggle} onClick={() => onToggleReasoning(msg.id)}>
                        思考过程 {msg.reasoning_collapsed ?? true ? '展开' : '收起'}
                      </button>
                      {!(msg.reasoning_collapsed ?? true) && (
                        <div style={styles.reasoningContent}>{msg.reasoning_content}</div>
                      )}
                    </div>
                  )}
                  {msg.role === 'model' ? (
                    <MarkdownMessage content={modelContent} isPending={isPendingModelMessage} />
                  ) : (
                    <div style={styles.userMessageText}>{msg.content}</div>
                  )}
                </div>
                {isUser && (
                  <div style={{ ...styles.avatar, ...styles.userAvatar }}>U</div>
                )}
              </div>
              {!isPendingModelMessage && (
                <div style={{
                  ...styles.messageActions,
                  ...(isUser ? styles.actionsRight : styles.actionsLeft),
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.15s',
                }}>
                  {isUser ? (
                    <ActionButton icon="edit" title="编辑并重试" onClick={() => onStartEdit(msg)} />
                  ) : (
                    <ActionButton icon="refresh" title="重新生成" onClick={() => onRegenerate(msg.id)} />
                  )}
                  <ActionButton icon="trash" title="删除" onClick={() => onDeleteMsg(msg.id)} />
                </div>
              )}
            </div>
          )
        })}

        {agentDecision && (
          <div style={styles.agentDecision} data-testid="agent-intent-plan">
            <div style={styles.agentDecisionTitle}>
              Agent 决策 · {intentLabel(agentDecision.intent)}
              {typeof agentDecision.confidence === 'number' ? ` · ${Math.round(agentDecision.confidence * 100)}%` : ''}
            </div>
            <div style={styles.agentDecisionMeta}>
              {agentDecision.suggested_workflow ? `工作流：${workflowLabel(agentDecision.suggested_workflow)}` : '不触发固定工作流'}
            </div>
            {agentDecision.active_skills?.length ? (
              <div style={styles.agentDecisionSkills}>
                技能：{agentDecision.active_skills.map(skill => skill.name || skill.id).join('、')}
              </div>
            ) : (
              <div style={styles.agentDecisionMeta}>本次不注入技能。</div>
            )}
            {agentDecision.context_sources?.length ? (
              <div style={styles.agentDecisionMeta}>
                上下文：{agentDecision.context_sources.map(contextSourceLabel).join('、')}
              </div>
            ) : null}
            {agentDecision.pending_change_policy ? (
              <div style={styles.agentDecisionMeta}>
                写入策略：{agentDecision.pending_change_policy === 'required' ? '生成待审批变更' : '不写入，仅规划'}
              </div>
            ) : null}
            {agentDecision.warnings?.length ? (
              <div style={styles.agentDecisionWarning}>
                {agentDecision.warnings.slice(0, 2).map(item => item.message || item.code || '存在执行风险').join('；')}
              </div>
            ) : null}
            {agentDecision.reasons?.length ? (
              <div style={styles.agentDecisionReason}>{agentDecision.reasons.slice(0, 2).join('；')}</div>
            ) : null}
          </div>
        )}

        {toolCalls.length > 0 && (
          <div style={styles.toolCallsContainer}>
            {toolCalls.map((tc, i) => {
              const args = tc.args as Record<string, string>
              return (
                <div key={i} style={styles.toolCall}>
                  <span style={{ ...styles.toolIcon, color: tc.result ? '#16a34a' : '#14b8a6' }}>{tc.result ? '●' : '○'}</span>
                  <span style={styles.toolName}>{toolDisplayName[tc.name] || tc.name}</span>
                  {tc.name === 'read_file' && args.path && <span style={styles.toolDetail}>{args.path}</span>}
                  {tc.name === 'write_file' && args.path && <span style={styles.toolDetail}>{args.path}</span>}
                  {tc.name === 'grep' && args.query && <span style={styles.toolDetail}>"{args.query}"</span>}
                </div>
              )
            })}
          </div>
        )}

        {/* 问卷内联显示 */}
        {questionnaire && questionnaire.status === 'active' && (
          <div style={styles.questionnaireWrapper}>
            <QuestionnairePanel
              questionnaire={questionnaire}
              onSubmit={onQuestionnaireSubmit}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <AgentInput
        input={input}
        todoItems={todoItems}
        isLoading={isLoading}
        onInput={onInput}
        onSend={onSend}
        onCancel={onCancel}
      />
    </div>
  )
}

function ActionButton({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  const icons: Record<string, React.ReactNode> = {
    edit: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    refresh: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    ),
    trash: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
  }
  return (
    <button style={styles.actionBtn} title={title} onClick={(e) => { e.stopPropagation(); onClick() }}>
      {icons[icon]}
    </button>
  )
}

function MarkdownMessage({ content, isPending = false }: { content: string; isPending?: boolean }) {
  if (isPending) {
    return <div style={{ ...styles.aiMessageText, color: ui.color.faint, fontStyle: 'italic' }}>{content}</div>
  }
  return (
    <div style={styles.aiMessageText} data-testid="chat-markdown-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={styles.markdownH1} data-testid="chat-markdown-heading">{children}</h1>,
          h2: ({ children }) => <h2 style={styles.markdownH2} data-testid="chat-markdown-heading">{children}</h2>,
          h3: ({ children }) => <h3 style={styles.markdownH3} data-testid="chat-markdown-heading">{children}</h3>,
          p: ({ children }) => <p style={styles.markdownP}>{children}</p>,
          ul: ({ children }) => <ul style={styles.markdownList}>{children}</ul>,
          ol: ({ children }) => <ol style={styles.markdownList}>{children}</ol>,
          li: ({ children }) => <li style={styles.markdownListItem}>{children}</li>,
          blockquote: ({ children }) => <blockquote style={styles.markdownQuote}>{children}</blockquote>,
          code: ({ children }) => <code style={styles.markdownCode}>{children}</code>,
          pre: ({ children }) => <pre style={styles.markdownPre}>{children}</pre>,
          table: ({ children }) => <table style={styles.markdownTable}>{children}</table>,
          thead: ({ children }) => <thead style={styles.markdownThead}>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr style={styles.markdownTr}>{children}</tr>,
          th: ({ children }) => <th style={styles.markdownTh}>{children}</th>,
          td: ({ children }) => <td style={styles.markdownTd}>{children}</td>,
          a: ({ href, children }) => (
            <a style={styles.markdownLink} href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function statusLabel(state: WorkflowDisplayState) {
  const labels: Record<WorkflowDisplayState, string> = {
    idle: '就绪',
    running: '运行中',
    pending_approval: '待审批',
    completed: '已完成',
    failed: '失败',
  }
  return labels[state]
}

function intentLabel(intent?: string) {
  const labels: Record<string, string> = {
    chat: '项目对话',
    project_dialogue: '项目对话',
    creative_planning: '创作规划',
    world_build: '世界观构建',
    character_build: '角色设计',
    outline_build: '大纲规划',
    project_query: '项目事实查询',
    chapter_draft: '章节写作',
    chapter_review: '章节审稿',
    chapter_polish: '章节润色',
    chapter_task: '章节任务处理',
    character_world_maintenance: '创作资产维护',
    configuration_help: '配置或使用帮助',
  }
  return intent ? labels[intent] || intent : '未识别'
}

function workflowLabel(workflow?: string | null) {
  const labels: Record<string, string> = {
    project_init: '创作规划',
    character_build: '角色设计',
    outline_build: '大纲规划',
    chapter_draft: '章节初稿',
    chapter_review: '章节审稿',
    chapter_polish: '章节润色',
    chapter_task: '章节任务',
  }
  return workflow ? labels[workflow] || workflow : ''
}

function contextSourceLabel(source: string) {
  const labels: Record<string, string> = {
    project_soul: '项目 Soul',
    project_metadata: '项目基本信息',
    existing_files: '已有文件',
    preset_context: '题材技能包',
    writing_rules: '创作规范',
    target_outline: '目标章纲',
    previous_chapter_summary: '上一章摘要',
    recent_chapter_summaries: '最近章节摘要',
    characters: '角色状态',
    unresolved_foreshadows: '未回收伏笔',
    timeline_events: '时间线',
    world_knowledge: '世界观',
    chapter_file: '当前章节',
    latest_review: '最近审稿',
    task_gate: '章节任务',
  }
  return labels[source] || source
}

function stateStyle(state: WorkflowDisplayState): React.CSSProperties {
  if (state === 'failed') return { color: '#fecaca', background: '#3b1d24', borderColor: '#7f1d1d' }
  if (state === 'pending_approval') return { color: '#fde68a', background: '#3a2f17', borderColor: '#854d0e' }
  if (state === 'running') return { color: '#bfdbfe', background: '#172554', borderColor: '#1d4ed8' }
  if (state === 'completed') return { color: '#bbf7d0', background: '#143326', borderColor: '#166534' }
  return { color: ui.color.muted, background: ui.color.panelSoft, borderColor: ui.color.border }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: ui.color.panel,
    position: 'relative',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: `1px solid ${ui.color.border}`,
    flexShrink: 0,
  },
  headerTitle: { fontSize: 14, fontWeight: 700, color: ui.color.text },
  headerStatus: { fontSize: 11, color: ui.color.faint, marginTop: 2, lineHeight: 1.3 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  stateBadge: {
    border: '1px solid',
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 10,
    whiteSpace: 'nowrap',
  },
  settingsBtn: {
    background: 'transparent',
    border: `1px solid ${ui.color.border}`,
    borderRadius: ui.radius.sm,
    padding: 6,
    color: ui.color.muted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    background: ui.color.panelAlt,
    border: `1px solid ${ui.color.borderStrong}`,
    borderRadius: ui.radius.md,
    minWidth: 160,
    zIndex: 50,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  settingsItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    color: ui.color.text,
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
  },
  settingsItemActive: {
    background: ui.color.primary + '18',
    color: ui.color.primary,
  },
  settingsItemIcon: {
    fontSize: 14,
    width: 18,
    textAlign: 'center',
    color: ui.color.muted,
  },
  settingsDivider: {
    height: 1,
    background: ui.color.border,
    margin: '4px 0',
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderBottom: `1px solid ${ui.color.border}`,
    background: ui.color.panelAlt,
    flexShrink: 0,
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: ui.color.primary,
    fontSize: 12,
    cursor: 'pointer',
    padding: 0,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: ui.color.text,
  },
  infoBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '5px 14px',
    borderTop: `1px solid ${ui.color.border}`,
    background: ui.color.panelAlt,
    flexShrink: 0,
  },
  infoModel: { fontSize: 11, color: ui.color.muted },
  infoDot: { fontSize: 11, color: ui.color.border },
  infoContext: { fontSize: 11, color: ui.color.faint },
  chatPane: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '24px 16px',
  },
  emptyIcon: {
    marginBottom: 12,
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: ui.color.text,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    color: ui.color.faint,
    textAlign: 'center',
    lineHeight: 1.5,
    marginBottom: 20,
  },
  suggestionSection: {
    width: '100%',
    maxWidth: 400,
  },
  suggestionToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '8px 12px',
    background: ui.color.panelSoft,
    border: `1px solid ${ui.color.border}`,
    borderRadius: ui.radius.sm,
    color: ui.color.text,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: 6,
  },
  chevron: {
    fontSize: 12,
    color: ui.color.muted,
    transition: 'transform 0.15s',
  },
  suggestionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  suggestionCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    background: ui.color.panelSoft,
    border: `1px solid ${ui.color.border}`,
    borderRadius: ui.radius.sm,
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
  suggestionIcon: {
    fontSize: 14,
    flexShrink: 0,
  },
  suggestionText: {
    flex: 1,
    fontSize: 12,
    color: ui.color.text,
    lineHeight: 1.4,
  },
  suggestionArrow: {
    fontSize: 16,
    color: ui.color.muted,
    flexShrink: 0,
  },
  messageRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
  },
  aiAvatar: {
    background: ui.color.panelSoft,
    border: `1px solid ${ui.color.border}`,
  },
  userAvatar: {
    background: '#1a3a3a',
    border: `1px solid ${ui.color.primary}44`,
    color: ui.color.primary,
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: ui.radius.md,
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  userBubble: {
    background: '#1a3a3a',
    color: ui.color.text,
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    background: ui.color.panelSoft,
    color: ui.color.text,
    borderBottomLeftRadius: 4,
  },
  userMessageText: {
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
  },
  aiMessageText: {
    color: ui.color.text,
    fontSize: 13,
    lineHeight: 1.6,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  reasoningBox: {
    marginBottom: 8,
    border: `1px solid ${ui.color.border}`,
    borderRadius: ui.radius.sm,
    background: ui.color.bg,
    overflow: 'hidden',
  },
  reasoningToggle: {
    width: '100%',
    textAlign: 'left',
    background: ui.color.panelAlt,
    border: 'none',
    color: ui.color.muted,
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: 11,
  },
  reasoningContent: {
    padding: 8,
    color: ui.color.faint,
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    maxHeight: 180,
    overflow: 'auto',
  },
  markdownH1: { fontSize: 17, lineHeight: 1.35, margin: '2px 0 8px', color: ui.color.text },
  markdownH2: { fontSize: 15, lineHeight: 1.4, margin: '2px 0 6px', color: ui.color.text },
  markdownH3: { fontSize: 13, lineHeight: 1.4, margin: '2px 0 5px', color: ui.color.text },
  markdownP: { margin: '0 0 6px' },
  markdownList: { margin: '0 0 6px', paddingLeft: 16 },
  markdownListItem: { margin: '1px 0' },
  markdownQuote: {
    margin: '6px 0',
    padding: '5px 8px',
    borderLeft: '3px solid #2dd4bf',
    background: '#0f2f2f',
    color: '#d1fae5',
    fontSize: 12,
  },
  markdownPre: {
    margin: '6px 0',
    padding: 8,
    borderRadius: ui.radius.sm,
    background: '#0b1220',
    border: `1px solid ${ui.color.border}`,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    fontSize: 12,
  },
  markdownCode: {
    padding: '1px 4px',
    borderRadius: 4,
    background: '#0b1220',
    color: '#bfdbfe',
    fontFamily: 'Consolas, Monaco, monospace',
    fontSize: 12,
  },
  markdownLink: { color: '#67e8f9', textDecoration: 'none' },
  markdownTable: {
    borderCollapse: 'collapse' as const,
    width: '100%',
    margin: '8px 0',
    fontSize: 13,
  },
  markdownThead: {
    background: '#1e1e32',
  },
  markdownTr: {
    borderBottom: '1px solid #2a2a3e',
  },
  markdownTh: {
    padding: '6px 10px',
    textAlign: 'left' as const,
    fontWeight: 700,
    color: '#ffffff',
    borderBottom: '2px solid #3a3a5e',
  },
  markdownTd: {
    padding: '5px 10px',
    color: '#e0e0e0',
    borderBottom: '1px solid #2a2a3e',
  },
  toolCallsContainer: {
    margin: '4px 0',
    padding: '6px 10px',
    background: ui.color.panelSoft,
    borderRadius: ui.radius.sm,
    border: `1px solid ${ui.color.border}`,
    marginLeft: 36,
  },
  toolCall: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 0',
    fontSize: 11,
    color: ui.color.muted,
  },
  toolIcon: { fontSize: 8, flexShrink: 0 },
  toolName: { fontWeight: 600, color: '#99f6e4', fontSize: 11 },
  toolDetail: { color: ui.color.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 },
  agentDecision: {
    margin: '4px 0',
    padding: '8px 10px',
    background: '#161927',
    border: `1px solid ${ui.color.border}`,
    borderRadius: ui.radius.sm,
    fontSize: 11,
    marginLeft: 36,
  },
  agentDecisionTitle: { color: '#99f6e4', fontWeight: 700, marginBottom: 3 },
  agentDecisionMeta: { color: ui.color.muted, lineHeight: 1.4 },
  agentDecisionSkills: { color: '#bfdbfe', lineHeight: 1.4, marginTop: 2 },
  agentDecisionWarning: { color: '#fde68a', lineHeight: 1.4, marginTop: 2 },
  agentDecisionReason: { color: ui.color.faint, lineHeight: 1.4, marginTop: 2 },
  inputArea: {
    padding: '10px 14px 12px',
    borderTop: `1px solid ${ui.color.border}`,
    background: ui.color.panelAlt,
    flexShrink: 0,
  },
  inputWrapper: {
    background: ui.color.panelSoft,
    border: `1px solid ${ui.color.borderStrong}`,
    borderRadius: ui.radius.md,
    overflow: 'hidden',
  },
  input: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '10px 12px 4px',
    color: ui.color.text,
    fontSize: 13,
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    lineHeight: 1.5,
    minHeight: 20,
    maxHeight: 100,
  },
  inputToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px 6px',
  },
  toolbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  toolbarBtn: {
    background: 'transparent',
    border: 'none',
    color: ui.color.muted,
    padding: 4,
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    background: ui.color.primary,
    border: 'none',
    borderRadius: ui.radius.sm,
    padding: 6,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  headerTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    padding: '2px 0',
    userSelect: 'none',
  },
  sessionChevron: {
    fontSize: 11,
    color: ui.color.muted,
    transition: 'transform 0.15s',
  },
  sessionDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    background: ui.color.panelAlt,
    border: `1px solid ${ui.color.borderStrong}`,
    borderRadius: ui.radius.md,
    minWidth: 220,
    maxWidth: 300,
    maxHeight: 320,
    zIndex: 60,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  newSessionBtn: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px',
    background: 'transparent',
    border: 'none',
    color: ui.color.primary,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
    borderBottom: `1px solid ${ui.color.border}`,
  },
  sessionDivider: { display: 'none' },
  sessionListScroll: {
    flex: 1,
    overflow: 'auto',
  },
  sessionItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    color: ui.color.text,
    borderBottom: `1px solid ${ui.color.border}22`,
  },
  sessionItemActive: {
    background: ui.color.primary + '18',
    color: ui.color.primary,
  },
  sessionTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sessionTitleInput: {
    flex: 1,
    background: ui.color.bg,
    border: `1px solid ${ui.color.primary}`,
    borderRadius: 4,
    padding: '2px 6px',
    color: ui.color.text,
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  },
  sessionDeleteBtn: {
    background: 'transparent',
    border: 'none',
    color: ui.color.muted,
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
    padding: '0 2px',
    opacity: 0.5,
    flexShrink: 0,
  },
  messageGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  messageActions: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
    opacity: 1,
  },
  actionsLeft: {
    justifyContent: 'flex-start',
    paddingLeft: 36,
  },
  actionsRight: {
    justifyContent: 'flex-end',
    paddingRight: 36,
  },
  actionBtn: {
    background: ui.color.panelSoft,
    border: `1px solid ${ui.color.border}`,
    borderRadius: 6,
    padding: 5,
    color: ui.color.muted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s, background 0.15s',
  },
  editContainer: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '4px 0',
  },
  editBox: {
    width: '80%',
    background: ui.color.panelSoft,
    border: `1px solid ${ui.color.primary}80`,
    borderRadius: ui.radius.md,
    padding: 12,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  editTextarea: {
    width: '100%',
    background: ui.color.bg,
    border: `1px solid ${ui.color.border}`,
    borderRadius: ui.radius.sm,
    padding: 10,
    color: ui.color.text,
    fontSize: 13,
    lineHeight: 1.6,
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    minHeight: 60,
    maxHeight: 200,
  },
  editActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  editCancelBtn: {
    background: ui.color.panelAlt,
    border: `1px solid ${ui.color.border}`,
    borderRadius: ui.radius.sm,
    padding: '6px 14px',
    color: ui.color.muted,
    fontSize: 12,
    cursor: 'pointer',
  },
  editSaveBtn: {
    background: ui.color.primary,
    border: 'none',
    borderRadius: ui.radius.sm,
    padding: '6px 14px',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  infoPending: {
    fontSize: 11,
    color: '#fde68a',
  },
  approvalBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 14px',
    background: '#3a2f17',
    borderBottom: '1px solid #854d0e',
    flexShrink: 0,
  },
  approvalItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'transparent',
    border: '1px solid #854d0e',
    borderRadius: ui.radius.sm,
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    color: '#fde68a',
    fontSize: 12,
  },
  approvalIcon: {
    fontSize: 14,
    flexShrink: 0,
  },
  approvalTool: {
    fontWeight: 600,
    color: '#fbbf24',
    flexShrink: 0,
  },
  approvalFile: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#d4b896',
  },
  approvalArrow: {
    flexShrink: 0,
    color: '#fbbf24',
    fontSize: 11,
  },
  approvalBannerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  approvalBannerTitle: {
    color: '#fde68a',
    fontSize: 12,
    fontWeight: 600,
  },
  historyPanel: {
    display: 'flex', flexDirection: 'column', height: '100%',
  },
  historyHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 12px', borderBottom: '1px solid #1f2937',
  },
  historyTitle: { fontSize: 12, fontWeight: 600, color: '#9ca3af' },
  historyCount: { fontSize: 11, color: '#6b7280' },
  historyItems: { flex: 1, overflow: 'auto', padding: '4px 0' },
  historyItem: {
    padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #1f2937',
  },
  historyItemTitle: { fontSize: 12, color: '#e5e7eb', marginBottom: 2 },
  historyItemMeta: { fontSize: 10, color: '#6b7280' },
  emptyHistory: { color: '#4b5563', textAlign: 'center', padding: 20, fontSize: 12 },
  questionnaireWrapper: {
    padding: '0 16px 8px',
  },
}
