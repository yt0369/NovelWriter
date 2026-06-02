import { NodeDetail } from './NodeDetail'

interface Props {
  projectId: string
  nodeId: string
  onClose: () => void
  onDeleted: () => void
}

export function KnowledgeNodeEditor(props: Props) {
  return <NodeDetail {...props} />
}
