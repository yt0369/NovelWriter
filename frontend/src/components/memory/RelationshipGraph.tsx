import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

interface GraphNode {
  id: string
  name: string
  summary: string
  wing: string
  importance?: string
}

interface GraphEdge {
  source: string
  target: string
  relation_type: string
  note: string
}

interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

interface Props {
  projectId: string
}

const WING_COLORS: Record<string, string> = {
  '世界': '#3b82f6',
  '角色': '#22c55e',
  '剧情': '#ef4444',
  '灵感': '#eab308',
  '物品': '#a855f7',
  '设定': '#f97316',
}

const WING_ICONS: Record<string, string> = {
  '世界': '🌍',
  '角色': '👤',
  '剧情': '📖',
  '灵感': '💡',
  '物品': '📦',
  '设定': '⚙️',
}

const IMPORTANCE_RADIUS: Record<string, number> = {
  critical: 28,
  important: 22,
  normal: 16,
}

export function RelationshipGraph({ projectId }: Props) {
  const [nodes, setNodes] = useState<SimNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [hoverNode, setHoverNode] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterWing, setFilterWing] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const animRef = useRef<number>(0)
  const nodesRef = useRef<SimNode[]>([])
  const edgesRef = useRef<GraphEdge[]>([])

  nodesRef.current = nodes
  edgesRef.current = edges

  const fetchGraph = async () => {
    try {
      const res = await fetch(`/api/memory/${projectId}/graph`)
      const data = await res.json()
      const graphNodes: GraphNode[] = data.nodes || []
      const graphEdges: GraphEdge[] = data.edges || []
      const simNodes: SimNode[] = graphNodes.map((n, i) => ({
        ...n,
        x: 200 + Math.cos((2 * Math.PI * i) / graphNodes.length) * 120 + Math.random() * 40,
        y: 200 + Math.sin((2 * Math.PI * i) / graphNodes.length) * 120 + Math.random() * 40,
        vx: 0,
        vy: 0,
        radius: IMPORTANCE_RADIUS[n.importance || 'normal'] || 16,
      }))
      setNodes(simNodes)
      setEdges(graphEdges)
    } catch {}
  }

  useEffect(() => {
    fetchGraph()
  }, [projectId])

  const simulate = useCallback(() => {
    const ns = nodesRef.current
    const es = edgesRef.current
    if (ns.length === 0) {
      animRef.current = requestAnimationFrame(simulate)
      return
    }

    const updated = ns.map(n => ({ ...n, vx: n.vx * 0.85, vy: n.vy * 0.85 }))

    for (let i = 0; i < updated.length; i++) {
      for (let j = i + 1; j < updated.length; j++) {
        const dx = updated[j].x - updated[i].x
        const dy = updated[j].y - updated[i].y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = 3000 / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        updated[i].vx -= fx
        updated[i].vy -= fy
        updated[j].vx += fx
        updated[j].vy += fy
      }
    }

    for (const edge of es) {
      const si = updated.findIndex(n => n.id === edge.source)
      const ti = updated.findIndex(n => n.id === edge.target)
      if (si === -1 || ti === -1) continue
      const dx = updated[ti].x - updated[si].x
      const dy = updated[ti].y - updated[si].y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - 150) * 0.01
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      updated[si].vx += fx
      updated[si].vy += fy
      updated[ti].vx -= fx
      updated[ti].vy -= fy
    }

    for (const n of updated) {
      n.vx += (400 - n.x) * 0.001
      n.vy += (300 - n.y) * 0.001
      if (dragging !== n.id) {
        n.x += n.vx
        n.y += n.vy
        n.x = Math.max(30, Math.min(770, n.x))
        n.y = Math.max(30, Math.min(570, n.y))
      }
    }

    setNodes(updated)
    animRef.current = requestAnimationFrame(simulate)
  }, [dragging])

  useEffect(() => {
    animRef.current = requestAnimationFrame(simulate)
    return () => cancelAnimationFrame(animRef.current)
  }, [simulate])

  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(nodeId)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setNodes(prev => prev.map(n => n.id === dragging ? { ...n, x, y, vx: 0, vy: 0 } : n))
  }

  const handleMouseUp = () => {
    setDragging(null)
  }

  const handleNodeClick = (node: SimNode) => {
    setSelectedNode(node)
    setSelectedEdge(null)
  }

  const handleEdgeClick = (edge: GraphEdge) => {
    setSelectedEdge(edge)
    setSelectedNode(null)
  }

  // 缩放处理
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.3, Math.min(3, prev * delta)))
  }, [])

  // 平移处理
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) { // 中键或Alt+左键
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [pan])

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    }
  }, [isPanning, panStart])

  const handlePanEnd = useCallback(() => {
    setIsPanning(false)
  }, [])

  // 搜索过滤
  const filteredNodes = useMemo(() => {
    let result = nodes
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(n => n.name.toLowerCase().includes(q) || n.summary?.toLowerCase().includes(q))
    }
    if (filterWing) {
      result = result.filter(n => n.wing === filterWing)
    }
    return result
  }, [nodes, searchQuery, filterWing])

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes])

  const filteredEdges = useMemo(() => {
    if (!searchQuery && !filterWing) return edges
    return edges.filter(e => filteredNodeIds.has(e.source) || filteredNodeIds.has(e.target))
  }, [edges, filteredNodeIds, searchQuery, filterWing])

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // 统计各翼节点数
  const wingStats = useMemo(() => {
    const stats: Record<string, number> = {}
    for (const n of nodes) {
      stats[n.wing] = (stats[n.wing] || 0) + 1
    }
    return stats
  }, [nodes])

  return (
    <div style={styles.container}>
      {/* 工具栏 */}
      <div style={styles.toolbar}>
        <div style={styles.legend}>
          {Object.entries(WING_COLORS).map(([wing, color]) => (
            <button
              key={wing}
              style={{
                ...styles.legendItem,
                opacity: filterWing && filterWing !== wing ? 0.4 : 1,
                background: filterWing === wing ? `${color}22` : 'transparent',
              }}
              onClick={() => setFilterWing(filterWing === wing ? null : wing)}
            >
              <span style={{ ...styles.legendDot, background: color }} />
              <span style={styles.legendText}>{wing} ({wingStats[wing] || 0})</span>
            </button>
          ))}
        </div>
        <div style={styles.searchBox}>
          <input
            style={styles.searchInput}
            placeholder="搜索节点..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 图谱 */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox="0 0 800 600"
        style={styles.svg}
        onMouseMove={e => { handleMouseMove(e); handlePanMove(e) }}
        onMouseUp={() => { handleMouseUp(); handlePanEnd() }}
        onMouseLeave={() => { handleMouseUp(); handlePanEnd() }}
        onMouseDown={handlePanStart}
        onWheel={handleWheel}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* 边 */}
          {filteredEdges.map((edge, i) => {
            const source = nodeMap.get(edge.source)
            const target = nodeMap.get(edge.target)
            if (!source || !target) return null
            const isHighlighted = hoverNode && (edge.source === hoverNode || edge.target === hoverNode)
            return (
              <g key={i} onClick={() => handleEdgeClick(edge)} style={{ cursor: 'pointer' }}>
                <line
                  x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                  stroke={isHighlighted ? '#14b8a6' : '#3a3a5e'}
                  strokeWidth={isHighlighted ? 2 : 1.5}
                  strokeOpacity={isHighlighted ? 1 : 0.6}
                />
                <line
                  x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                  stroke="transparent" strokeWidth={10}
                />
                {edge.relation_type && (
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2 - 6}
                    textAnchor="middle"
                    fill={isHighlighted ? '#14b8a6' : '#666'}
                    fontSize={10}
                  >
                    {edge.relation_type}
                  </text>
                )}
              </g>
            )
          })}
          {/* 节点 */}
          {filteredNodes.map(node => {
            const isSelected = selectedNode?.id === node.id
            const isHovered = hoverNode === node.id
            const color = WING_COLORS[node.wing] || '#6b7280'
            return (
              <g
                key={node.id}
                onMouseDown={e => handleMouseDown(e, node.id)}
                onClick={() => handleNodeClick(node)}
                onMouseEnter={() => setHoverNode(node.id)}
                onMouseLeave={() => setHoverNode(null)}
                style={{ cursor: 'grab' }}
              >
                {/* 光晕效果 */}
                {(isSelected || isHovered) && (
                  <circle
                    cx={node.x} cy={node.y} r={node.radius + 6}
                    fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.3}
                  />
                )}
                {/* 主圆 */}
                <circle
                  cx={node.x} cy={node.y} r={node.radius}
                  fill={color} fillOpacity={isSelected ? 0.5 : 0.3}
                  stroke={color} strokeWidth={isSelected ? 3 : 2}
                />
                {/* 透明点击区域 */}
                <circle
                  cx={node.x} cy={node.y} r={node.radius + 5}
                  fill="transparent" stroke="transparent"
                />
                {/* 图标 */}
                <text
                  x={node.x} y={node.y - 2}
                  textAnchor="middle" fontSize={12}
                >
                  {WING_ICONS[node.wing] || '●'}
                </text>
                {/* 名称 */}
                <text
                  x={node.x} y={node.y + node.radius + 12}
                  textAnchor="middle" fill="#e0e0e0"
                  fontSize={10} fontWeight={600}
                >
                  {node.name.length > 6 ? node.name.slice(0, 6) + '..' : node.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* 缩放控制 */}
      <div style={styles.zoomControls}>
        <button style={styles.zoomBtn} onClick={() => setZoom(z => Math.min(3, z * 1.2))}>+</button>
        <span style={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button style={styles.zoomBtn} onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}>-</button>
        <button style={styles.zoomBtn} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>⟲</button>
      </div>

      {selectedNode && (
        <div style={styles.detailPanel}>
          <div style={styles.detailHeader}>
            <span style={styles.detailTitle}>{selectedNode.name}</span>
            <span style={styles.detailClose} onClick={() => setSelectedNode(null)}>✕</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ ...styles.wingBadge, background: WING_COLORS[selectedNode.wing] || '#6b7280' }}>
              {selectedNode.wing}
            </span>
          </div>
          {selectedNode.summary && (
            <div style={styles.detailSummary}>{selectedNode.summary}</div>
          )}
        </div>
      )}

      {selectedEdge && (
        <div style={styles.detailPanel}>
          <div style={styles.detailHeader}>
            <span style={styles.detailTitle}>关系详情</span>
            <span style={styles.detailClose} onClick={() => setSelectedEdge(null)}>✕</span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: '#888', fontSize: 12 }}>类型: </span>
            <span style={{ color: '#a78bfa', fontSize: 13 }}>{selectedEdge.relation_type || '未命名'}</span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: '#888', fontSize: 12 }}>源: </span>
            <span style={{ color: '#e0e0e0', fontSize: 13 }}>{nodeMap.get(selectedEdge.source)?.name || selectedEdge.source}</span>
            <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>目标: </span>
            <span style={{ color: '#e0e0e0', fontSize: 13 }}>{nodeMap.get(selectedEdge.target)?.name || selectedEdge.target}</span>
          </div>
          {selectedEdge.note && (
            <div style={styles.detailSummary}>{selectedEdge.note}</div>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#0f0f1a', position: 'relative',
  },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 12px', borderBottom: '1px solid #2a2a3e', gap: 12,
  },
  svg: {
    flex: 1, background: '#0f0f1a',
  },
  legend: {
    display: 'flex', gap: 4, flexWrap: 'wrap',
  },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 4, border: 'none',
    cursor: 'pointer', transition: 'all 0.2s',
  },
  legendDot: {
    width: 8, height: 8, borderRadius: '50%',
  },
  legendText: {
    fontSize: 11, color: '#888',
  },
  searchBox: {
    flexShrink: 0,
  },
  searchInput: {
    background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6,
    padding: '4px 10px', color: '#e0e0e0', fontSize: 12, outline: 'none',
    width: 140,
  },
  zoomControls: {
    position: 'absolute', bottom: 12, right: 12,
    display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10,
  },
  zoomBtn: {
    width: 28, height: 28, background: '#1a1a2e', border: '1px solid #2a2a3e',
    borderRadius: 6, color: '#e0e0e0', fontSize: 14, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  zoomLabel: {
    fontSize: 10, color: '#888', textAlign: 'center',
  },
  detailPanel: {
    position: 'absolute', bottom: 12, left: 12, width: 240,
    background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 10,
    padding: 14, zIndex: 10,
  },
  detailHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  detailTitle: {
    fontSize: 14, fontWeight: 700, color: '#e0e0e0',
  },
  detailClose: {
    cursor: 'pointer', color: '#888', fontSize: 14,
  },
  wingBadge: {
    fontSize: 11, color: '#fff', padding: '2px 8px', borderRadius: 4,
  },
  detailSummary: {
    fontSize: 12, color: '#aaa', lineHeight: 1.5,
  },
}
