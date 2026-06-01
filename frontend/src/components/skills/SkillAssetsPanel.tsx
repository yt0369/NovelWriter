import { useEffect, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'

interface Asset {
  id: string
  name: string
  category: string
  summary: string
  tags: string[]
  tools: string[]
  source: string
  preset: string
  path: string
  content_length: number
  usage_scenarios?: string[]
  input_requirements?: string[]
  output_contract?: string[]
  forbidden_rules?: string[]
  activation_hints?: string[]
  is_preset_asset?: boolean
  matches_project_preset?: boolean
  project_preset_id?: string | null
  project_enabled?: boolean
  can_be_creative_reference?: boolean
}

interface Props {
  projectId: string
}

export function SkillAssetsPanel({ projectId }: Props) {
  const [assets, setAssets] = useState<Asset[]>([])
  const { setActiveFile, setActiveContent, setIsDirty } = useEditorStore()

  const handleEditAsset = async (asset: Asset) => {
    if (!asset.path) return
    try {
      const res = await fetch(`/api/skills/asset-content?path=${encodeURIComponent(asset.path)}`)
      const data = await res.json()
      if (data.content !== undefined) {
        setActiveFile(`skills/${asset.path}`)
        setActiveContent(data.content)
        setIsDirty(false)
      }
    } catch {}
  }

  useEffect(() => {
    fetch(`/api/skills/${projectId}/assets`)
      .then(r => r.json())
      .then(data => setAssets(Array.isArray(data) ? data : []))
      .catch(() => setAssets([]))
  }, [projectId])

  const grouped = assets.reduce<Record<string, Asset[]>>((acc, asset) => {
    const key = asset.preset ? '题材技能' : asset.category || '其他'
    acc[key] = acc[key] || []
    acc[key].push(asset)
    return acc
  }, {})

  return (
    <div style={styles.container}>
      <div style={styles.title}>技能资产</div>
      {Object.entries(grouped).map(([group, items]) => (
        <div key={group} style={styles.group}>
          <div style={styles.groupTitle}>{group}</div>
          {items.map(asset => (
            <div key={asset.path} style={styles.asset}>
              <div style={styles.assetHeader}>
                <span style={styles.name}>{asset.name}</span>
                <button
                  style={styles.editBtn}
                  onClick={() => handleEditAsset(asset)}
                  title="编辑技能资产"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
              <PresetStatus asset={asset} />
              <div style={styles.summary}>{asset.summary || asset.path}</div>
              <AssetContract asset={asset} />
              <div style={styles.meta}>
                <span>{asset.tools.length} 工具</span>
                <span>{asset.preset || 'core'}</span>
                <span>{asset.content_length} 字符</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function PresetStatus({ asset }: { asset: Asset }) {
  if (!asset.is_preset_asset) {
    return <div style={styles.statusLine} data-testid="skill-asset-core-status">核心技能 · 项目可用</div>
  }
  if (asset.matches_project_preset) {
    return (
      <div style={styles.statusLine} data-testid="skill-asset-current-preset">
        当前主题材 · {asset.project_enabled ? '默认注入' : '已关闭'}
      </div>
    )
  }
  return (
    <div style={styles.statusLineMuted} data-testid="skill-asset-creative-reference">
      非当前题材 · 可按本章创作自由指令临时参考
    </div>
  )
}

function AssetContract({ asset }: { asset: Asset }) {
  const rows = [
    ['适用', asset.usage_scenarios],
    ['输入', asset.input_requirements],
    ['禁止', asset.forbidden_rules],
  ] as const
  if (!rows.some(([, items]) => items?.length)) return null
  return (
    <div style={styles.contract} data-testid="skill-asset-contract">
      {rows.map(([label, items]) => items?.length ? (
        <div key={label} style={styles.contractLine}>
          <span style={styles.contractLabel}>{label}</span>
          <span>{items[0]}</span>
        </div>
      ) : null)}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { borderTop: '1px solid #2a2a3e', padding: '10px 12px' },
  title: { color: '#888', fontSize: 12, fontWeight: 700, marginBottom: 8 },
  group: { marginBottom: 10 },
  groupTitle: { color: '#a78bfa', fontSize: 12, marginBottom: 6 },
  asset: { background: '#111827', border: '1px solid #263045', borderRadius: 8, padding: 8, marginBottom: 6 },
  assetHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: '#e0e0e0', fontSize: 12, fontWeight: 700 },
  editBtn: {
    background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer',
    padding: 2, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  statusLine: { color: '#a7f3d0', fontSize: 10, lineHeight: 1.35, marginTop: 3 },
  statusLineMuted: { color: '#93c5fd', fontSize: 10, lineHeight: 1.35, marginTop: 3 },
  summary: { color: '#888', fontSize: 11, lineHeight: 1.4, marginTop: 3 },
  contract: { marginTop: 6, display: 'grid', gap: 3 },
  contractLine: { display: 'flex', gap: 6, color: '#9ca3af', fontSize: 10, lineHeight: 1.35 },
  contractLabel: { color: '#c4b5fd', fontWeight: 700, flex: '0 0 auto' },
  meta: { display: 'flex', gap: 8, color: '#555', fontSize: 10, marginTop: 5, flexWrap: 'wrap' },
}
