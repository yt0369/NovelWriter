export type RefreshSection =
  | 'files'
  | 'editor'
  | 'versions'
  | 'pending'
  | 'knowledge'
  | 'history'
  | 'health'
  | 'characters'
  | 'timeline'
  | 'foreshadowing'

export interface WorkspaceRefreshDetail {
  path?: string | null
  reason?: string
  sections?: RefreshSection[]
}

export type WorkspaceNavigateTarget =
  | 'files'
  | 'outline'
  | 'knowledge'
  | 'characters'
  | 'timeline'
  | 'foreshadowing'

export interface WorkspaceNavigateDetail {
  target: WorkspaceNavigateTarget
  reason?: string
}

export const WORKSPACE_REFRESH_EVENT = 'novelwriter:workspace-refresh'
export const FILE_UPDATED_EVENT = 'novelwriter:file-updated'
export const KNOWLEDGE_UPDATED_EVENT = 'novelwriter:knowledge-updated'
export const WORKSPACE_NAVIGATE_EVENT = 'novelwriter:workspace-navigate'

export function emitWorkspaceRefresh(detail: WorkspaceRefreshDetail = {}) {
  window.dispatchEvent(new CustomEvent<WorkspaceRefreshDetail>(WORKSPACE_REFRESH_EVENT, { detail }))
}

export function emitFileUpdated(path?: string | null) {
  const detail: WorkspaceRefreshDetail = {
    path,
    reason: 'file-updated',
    sections: ['files', 'editor', 'versions', 'pending', 'knowledge', 'history', 'health', 'characters', 'timeline', 'foreshadowing'],
  }
  window.dispatchEvent(new CustomEvent<WorkspaceRefreshDetail>(FILE_UPDATED_EVENT, { detail }))
  emitWorkspaceRefresh(detail)
}

export function emitKnowledgeUpdated() {
  const detail: WorkspaceRefreshDetail = {
    reason: 'knowledge-updated',
    sections: ['knowledge', 'history', 'health', 'characters', 'timeline', 'foreshadowing'],
  }
  window.dispatchEvent(new CustomEvent<WorkspaceRefreshDetail>(KNOWLEDGE_UPDATED_EVENT, { detail }))
  emitWorkspaceRefresh(detail)
}

export function emitPendingUpdated(reason = 'pending-updated') {
  emitWorkspaceRefresh({
    reason,
    sections: ['pending', 'history', 'health'],
  })
}

export function emitWorkspaceNavigate(target: WorkspaceNavigateTarget, reason = 'readiness-action') {
  window.dispatchEvent(new CustomEvent<WorkspaceNavigateDetail>(WORKSPACE_NAVIGATE_EVENT, {
    detail: { target, reason },
  }))
}

export function refreshMatchesPath(detail: WorkspaceRefreshDetail | undefined, path: string | null) {
  if (!path) return false
  return !detail?.path || detail.path === path
}
