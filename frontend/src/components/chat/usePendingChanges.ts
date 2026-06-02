import { useEffect, useRef, useState } from 'react'
import { emitFileUpdated, emitKnowledgeUpdated, emitPendingUpdated, WORKSPACE_REFRESH_EVENT } from '../../utils/workspaceEvents'
import { useEditorStore } from '../../stores/editorStore'
import type { PendingChange } from './PendingChangesPanel'

type WorkflowDisplayState = 'idle' | 'running' | 'pending_approval' | 'completed' | 'failed'

interface UsePendingChangesParams {
  projectId: string
  workflowState: WorkflowDisplayState
  setWorkflowState: (state: WorkflowDisplayState) => void
  setWorkflowStatus: (status: string) => void
}

export function usePendingChanges({
  projectId,
  workflowState,
  setWorkflowState,
  setWorkflowStatus,
}: UsePendingChangesParams) {
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const pendingChangesRef = useRef<PendingChange[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    pendingChangesRef.current = pendingChanges
  }, [pendingChanges])

  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1)
    window.addEventListener(WORKSPACE_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await fetch(`/api/agent/${projectId}/pending-changes`)
        if (!res.ok) throw new Error('待审批变更加载失败')
        const data = await res.json()
        if (Array.isArray(data)) {
          setPendingChanges(data)
          if (data.length === 0) {
            useEditorStore.getState().setDiffMode(null)
            if (workflowState === 'pending_approval') {
              setWorkflowState('completed')
              setWorkflowStatus('所有变更已处理')
            }
          }
        }
      } catch (e) {
        setWorkflowState('failed')
        setWorkflowStatus(e instanceof Error ? e.message : '待审批变更加载失败')
      }
    }
    fetchPending()
  }, [projectId, refreshKey, setWorkflowState, setWorkflowStatus, workflowState])

  const handleApprove = async (changeId: string) => {
    const change = pendingChangesRef.current.find(c => c.id === changeId)
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes/${changeId}/approve`, { method: 'POST' })
      if (res.ok || res.status === 404) {
        const data = res.ok ? await res.json().catch(() => ({})) : {}
        const filePath = (data.file_path as string) || change?.file_path || ''
        emitFileUpdated(filePath)
        emitKnowledgeUpdated()
        emitPendingUpdated('pending-approved')
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
      setWorkflowStatus('批准失败: 网络或后端异常')
      setWorkflowState('failed')
    }
  }

  const handleReject = async (changeId: string) => {
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes/${changeId}/reject`, { method: 'POST' })
      if (res.ok || res.status === 404) {
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
      setWorkflowStatus('拒绝失败: 网络或后端异常')
      setWorkflowState('failed')
    }
  }

  const handleRevise = async (changeId: string, newContent: string, description: string) => {
    try {
      const res = await fetch(`/api/agent/${projectId}/pending-changes/${changeId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_content: newContent, description }),
      })
      const data = await res.json().catch(() => ({}))
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
    } catch {
      setWorkflowStatus('修订失败: 网络或后端异常')
      setWorkflowState('failed')
    }
  }

  return {
    pendingChanges,
    setPendingChanges,
    pendingChangesRef,
    refreshKey,
    setRefreshKey,
    handleApprove,
    handleReject,
    handleRevise,
  }
}
