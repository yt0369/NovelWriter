import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import { useChatStore, type ChatMessage } from '../../stores/chatStore'

type WorkflowDisplayState = 'idle' | 'running' | 'pending_approval' | 'completed' | 'failed'

interface UseAgentQuestionnaireParams {
  projectId: string
  sessionId: string | null
  activeFilePath?: string | null
  wsRef: MutableRefObject<WebSocket | null>
  loadingTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  turnCounterRef: MutableRefObject<number>
  connectWs: () => void
  addMessage: (msg: ChatMessage) => void
  setIsLoading: (loading: boolean) => void
  setWorkflowState: (state: WorkflowDisplayState) => void
  setWorkflowStatus: (status: string) => void
  updateLastModelMessage: (content: string) => void
}

export function useAgentQuestionnaire({
  projectId,
  sessionId,
  activeFilePath,
  wsRef,
  loadingTimerRef,
  turnCounterRef,
  connectWs,
  addMessage,
  setIsLoading,
  setWorkflowState,
  setWorkflowStatus,
  updateLastModelMessage,
}: UseAgentQuestionnaireParams) {
  const [questionnaire, setQuestionnaire] = useState<any>(null)

  useEffect(() => {
    const fetchQuestionnaire = async () => {
      if (!sessionId) {
        setQuestionnaire(null)
        return
      }
      try {
        const res = await fetch(`/api/agent/${projectId}/questionnaire?session_id=${encodeURIComponent(sessionId)}`)
        if (!res.ok) throw new Error('问卷恢复失败')
        const data = await res.json()
        setQuestionnaire(data?.status === 'active' ? data : null)
      } catch (e) {
        setQuestionnaire(null)
        setWorkflowState('failed')
        setWorkflowStatus(e instanceof Error ? e.message : '问卷恢复失败')
      }
    }
    fetchQuestionnaire()
  }, [projectId, sessionId])

  const handleQuestionnaireSubmit = useCallback((answers: Record<string, string | string[]>) => {
    if (!sessionId) return
    const message = JSON.stringify({ type: 'questionnaire_answer', answers })
    const turnId = ++turnCounterRef.current

    setQuestionnaire(null)
    setIsLoading(true)
    setWorkflowState('running')
    setWorkflowStatus('正在提交问卷回答')

    const lastMessage = useChatStore.getState().messages.at(-1)
    if (!lastMessage || lastMessage.role !== 'model' || lastMessage.content) {
      addMessage({
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: '',
        timestamp: Date.now(),
      })
    }

    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current)
    loadingTimerRef.current = setTimeout(() => {
      setIsLoading(false)
      setWorkflowState('failed')
      setWorkflowStatus('问卷提交后响应超时，请重试')
      updateLastModelMessage(useChatStore.getState().messages.at(-1)?.content || '（响应超时，请重试）')
    }, 300000)

    const sendAnswer = () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return false
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        message,
        active_file_path: activeFilePath || '',
        turn_id: turnId,
      }))
      return true
    }

    if (sendAnswer()) return

    connectWs()
    let check: ReturnType<typeof setInterval>
    const connectTimeout = setTimeout(() => {
      clearInterval(check)
      if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current)
        loadingTimerRef.current = null
      }
      setIsLoading(false)
      setWorkflowState('failed')
      setWorkflowStatus('连接超时，请确认后端服务正在运行。')
      updateLastModelMessage('连接超时，请确认后端服务正在运行后重试。')
    }, 10000)
    check = setInterval(() => {
      if (sendAnswer()) {
        clearInterval(check)
        clearTimeout(connectTimeout)
      }
    }, 100)
  }, [
    activeFilePath,
    addMessage,
    connectWs,
    loadingTimerRef,
    sessionId,
    setIsLoading,
    setWorkflowState,
    setWorkflowStatus,
    turnCounterRef,
    updateLastModelMessage,
    wsRef,
  ])

  return { questionnaire, setQuestionnaire, handleQuestionnaireSubmit }
}
