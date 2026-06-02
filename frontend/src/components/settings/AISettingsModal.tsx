import { useState, useEffect } from 'react'
import { ui, buttons } from '../../styles/ui'

interface OpenAIBackend {
  id: string
  name: string
  base_url: string
  api_key: string
  model_name: string
  max_output_tokens?: number
  context_token_limit?: number
  thinking_enabled: boolean
  thinking_budget_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
}

interface ModelRoute {
  backend_id?: string
  model_name?: string
}

interface AutoExtraction {
  conversation: boolean
  document: boolean
  chapter_analysis: boolean
}

interface FullAISettings {
  api_key: string
  api_base_url: string
  model: string
  backends: OpenAIBackend[]
  active_backend_id: string
  max_output_tokens?: number
  context_token_limit: number
  safety_setting: string
  language: string
  temperature: number
  top_p: number
  top_k: number
  thinking_enabled: boolean
  thinking_budget_tokens?: number
  auto_extraction: AutoExtraction
  model_routes: Record<string, ModelRoute>
  has_api_key: boolean
  provider_hint: string
}

// 每个 Provider 的推荐配置
const RECOMMENDED_CONFIGS: Record<string, Partial<OpenAIBackend>> = {
  'blazeapi': {
    max_output_tokens: 4096,
    context_token_limit: 128000,
    thinking_enabled: false,
    temperature: 0.7,
    top_p: 0.95,
  },
  'blaze-thinking': {
    max_output_tokens: 8192,
    context_token_limit: 256000,
    thinking_enabled: true,
    thinking_budget_tokens: 10000,
    temperature: 0.7,
    top_p: 0.95,
  },
  'skyclaw': {
    max_output_tokens: 65536,
    context_token_limit: 131072,
    thinking_enabled: true,
    thinking_budget_tokens: 20000,
    temperature: 0.7,
    top_p: 0.95,
    top_k: 20,
  },
  'deepseek': {
    max_output_tokens: 4096,
    context_token_limit: 128000,
    thinking_enabled: false,
    temperature: 0.7,
    top_p: 0.95,
  },
  'openai': {
    max_output_tokens: 4096,
    context_token_limit: 128000,
    thinking_enabled: false,
    temperature: 0.7,
    top_p: 1.0,
  },
}

interface Props { onClose: () => void }

function optionalInt(value: string) {
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function intWithFallback(value: string, fallback: number) {
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function numberWithFallback(value: string, fallback: number) {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function AISettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<FullAISettings | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [modelList, setModelList] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/ai')
      .then(r => r.json())
      .then(data => {
        if (!data.backends || data.backends.length === 0) {
          data.backends = [
            { id: 'blazeapi', name: 'BlazeAPI', base_url: 'https://blazeai.boxu.dev/api/', api_key: '', model_name: 'qwen3.6-plus', thinking_enabled: false },
            { id: 'blaze-thinking', name: 'Blaze Thinking', base_url: 'https://blazeai.boxu.dev/api/', api_key: '', model_name: 'qwen3.6-max-preview-thinking', thinking_enabled: true },
            { id: 'skyclaw', name: 'SkyClaw', base_url: 'https://api.apifree.ai/v1', api_key: '', model_name: 'skywork-ai/skyclaw-v1', thinking_enabled: true },
            { id: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com', api_key: '', model_name: 'deepseek-chat', thinking_enabled: false },
            { id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', api_key: '', model_name: 'gpt-4o', thinking_enabled: false },
          ]
          data.active_backend_id = 'blazeapi'
        }
        if (!data.auto_extraction) data.auto_extraction = { conversation: true, document: true, chapter_analysis: true }
        if (!data.model_routes) data.model_routes = {}
        setSettings(data)
        setError('')
      })
      .catch(() => setError('AI 配置加载失败，请确认后端服务正在运行。'))
  }, [])

  const activeBackend = settings?.backends?.find(b => b.id === settings.active_backend_id)

  const updateActiveBackend = (updates: Partial<OpenAIBackend>) => {
    if (!settings) return
    setSettings(prev => ({
      ...prev!,
      backends: prev!.backends.map(b => b.id === prev!.active_backend_id ? { ...b, ...updates } : b),
    }))
  }

  const updateModelRoute = (routeId: string, updates: Partial<ModelRoute>) => {
    if (!settings) return
    setSettings(prev => {
      const current = prev!.model_routes[routeId] || {}
      const merged = { ...current, ...updates }
      const cleaned: ModelRoute = {}
      if (merged.backend_id) cleaned.backend_id = merged.backend_id
      if (merged.model_name) cleaned.model_name = merged.model_name
      return { ...prev!, model_routes: { ...prev!.model_routes, [routeId]: cleaned } }
    })
  }

  const handleAddBackend = () => {
    if (!settings) return
    const newId = `provider-${Date.now()}`
    setSettings(prev => ({
      ...prev!,
      backends: [...prev!.backends, { id: newId, name: 'New Provider', base_url: 'https://api.openai.com/v1', api_key: '', model_name: 'gpt-3.5-turbo', thinking_enabled: false }],
      active_backend_id: newId,
    }))
  }

  const handleDeleteBackend = () => {
    if (!settings || settings.backends.length <= 1) return
    if (!confirm('确定删除此配置？')) return
    const newBackends = settings.backends.filter(b => b.id !== settings.active_backend_id)
    setSettings(prev => ({ ...prev!, backends: newBackends, active_backend_id: newBackends[0].id }))
  }

  const fetchModels = async () => {
    if (!activeBackend) return
    setLoadingModels(true)
    setModelList([])
    try {
      const key = activeBackend.api_key === '***' ? '' : activeBackend.api_key
      const res = await fetch('/api/settings/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend_id: activeBackend.id, api_base_url: activeBackend.base_url, api_key: key }),
      })
      const data = await res.json()
      if (data.models && Array.isArray(data.models)) {
        setModelList(data.models.map((m: { id: string }) => m.id))
      }
    } catch {}
    setLoadingModels(false)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setError('')
    try {
      const active = settings.backends.find(b => b.id === settings.active_backend_id)
      const finalSettings = { ...settings }
      if (active) {
        finalSettings.api_base_url = active.base_url
        finalSettings.model = active.model_name
        finalSettings.max_output_tokens = active.max_output_tokens
        finalSettings.context_token_limit = active.context_token_limit || finalSettings.context_token_limit
        finalSettings.temperature = active.temperature ?? finalSettings.temperature
        finalSettings.top_p = active.top_p ?? finalSettings.top_p
        finalSettings.top_k = active.top_k ?? finalSettings.top_k
        finalSettings.thinking_enabled = active.thinking_enabled
        finalSettings.thinking_budget_tokens = active.thinking_budget_tokens
        // 只在用户输入了新 key 时才发送（*** 是后端返回的掩码，不发送）
        if (active.api_key && active.api_key !== '***') {
          finalSettings.api_key = active.api_key
        } else {
          finalSettings.api_key = ''  // 空字符串表示不更新
        }
      }
      const res = await fetch('/api/settings/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalSettings) })
      if (!res.ok) throw new Error('保存失败')
      onClose()
    } catch {
      setError('保存失败，请检查配置内容或后端日志。')
    }
    setSaving(false)
  }

  const handleTest = async () => {
    if (!activeBackend) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/settings/ai/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend_id: activeBackend.id, api_key: activeBackend.api_key === '***' ? '' : activeBackend.api_key, api_base_url: activeBackend.base_url, model: activeBackend.model_name }),
      })
      setTestResult(await res.json())
    } catch { setTestResult({ ok: false, error: '请求失败' }) }
    setTesting(false)
  }

  if (!settings || !activeBackend) {
    if (!error) return null
    return (
      <div style={s.overlay}>
        <div style={s.modal}>
          <div style={s.header}>
            <span style={s.title}>⚡ AI 模型配置</span>
            <button style={s.closeBtn} onClick={onClose}>✕</button>
          </div>
          <div style={s.body}>
            <div style={s.testError}>{error}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <span style={s.title}>⚡ AI 模型配置</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {/* Provider 选择器 */}
          <div style={s.section}>
            <div style={s.row}>
              <span style={s.label}>Provider</span>
              <button style={s.iconBtn} onClick={handleAddBackend} title="添加">＋</button>
            </div>
            <div style={s.row}>
              <select style={s.select} value={settings.active_backend_id} onChange={e => setSettings(prev => ({ ...prev!, active_backend_id: e.target.value }))}>
                {settings.backends.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button style={s.dangerBtn} onClick={handleDeleteBackend}>删除</button>
            </div>
          </div>

          <div style={s.divider} />

          {/* Provider 名称 + 推荐配置 */}
          <div style={s.section}>
            {isEditingName ? (
              <div style={s.row}>
                <input style={s.input} value={activeBackend.name} onChange={e => updateActiveBackend({ name: e.target.value })} autoFocus />
                <button style={s.primaryBtn} onClick={() => setIsEditingName(false)}>✓</button>
              </div>
            ) : (
              <div style={s.row}>
                <span style={s.providerName}>{activeBackend.name}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {RECOMMENDED_CONFIGS[activeBackend.id] && (
                    <button
                      style={s.recommendBtn}
                      onClick={() => updateActiveBackend(RECOMMENDED_CONFIGS[activeBackend.id])}
                      title="应用推荐配置"
                    >
                      ⚡ 推荐配置
                    </button>
                  )}
                  <button style={s.iconBtn} onClick={() => setIsEditingName(true)}>✎</button>
                </div>
              </div>
            )}
          </div>

          {/* Base URL */}
          <div style={s.section}>
            <label style={s.label}>Base URL</label>
            <input style={s.input} value={activeBackend.base_url} onChange={e => updateActiveBackend({ base_url: e.target.value })} placeholder="https://api.openai.com/v1" />
          </div>

          {/* API Key */}
          <div style={s.section}>
            <label style={s.label}>API Key</label>
            {activeBackend.api_key === '***' ? (
              <div style={s.row}>
                <div style={{ ...s.input, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: ui.color.success }}>● 已设置</span>
                  <span style={{ color: ui.color.faint, fontSize: ui.font.xs }}>（保存后无法查看，需重新输入才能修改）</span>
                </div>
                <button style={s.ghostBtn} onClick={() => updateActiveBackend({ api_key: '' })}>重置</button>
              </div>
            ) : (
              <div style={s.row}>
                <input style={{ ...s.input, flex: 1 }} type={showKey ? 'text' : 'password'} value={activeBackend.api_key} onChange={e => updateActiveBackend({ api_key: e.target.value })} placeholder="sk-..." />
                <button style={s.ghostBtn} onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button>
              </div>
            )}
          </div>

          {/* Model Name */}
          <div style={s.section}>
            <div style={s.row}>
              <label style={s.label}>模型名称</label>
              <button style={s.iconBtn} onClick={fetchModels} disabled={loadingModels}>
                {loadingModels ? '...' : '刷新列表'}
              </button>
            </div>
            {modelList.length > 0 ? (
              <select style={s.select} value={activeBackend.model_name} onChange={e => updateActiveBackend({ model_name: e.target.value })}>
                {modelList.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input style={s.input} value={activeBackend.model_name} onChange={e => updateActiveBackend({ model_name: e.target.value })} placeholder="gpt-4o" />
            )}
          </div>

          {/* Max Output Tokens */}
          <div style={s.section}>
            <label style={s.label}>最大输出 Tokens</label>
            <input style={s.input} type="number" value={activeBackend.max_output_tokens || ''} onChange={e => updateActiveBackend({ max_output_tokens: optionalInt(e.target.value) })} placeholder="8192" />
            <span style={s.hint}>限制单次回复的最大 token 数量</span>
          </div>

          {/* Context Token Limit */}
          <div style={s.section}>
            <label style={s.label}>上下文 Token 限制</label>
            <input style={s.input} type="number" min={8192} step={1024} value={activeBackend.context_token_limit ?? 256000} onChange={e => updateActiveBackend({ context_token_limit: intWithFallback(e.target.value, 256000) })} />
            <span style={s.hint}>用于上下文用量统计和预警，默认 256k</span>
          </div>

          {/* 采样参数 */}
          <div style={s.row}>
            <div style={{ ...s.section, flex: 1, marginBottom: 0 }}>
              <label style={s.label}>Temperature</label>
              <input style={s.input} type="number" min={0} max={2} step={0.1} value={activeBackend.temperature ?? 0.7} onChange={e => updateActiveBackend({ temperature: numberWithFallback(e.target.value, 0.7) })} />
              <span style={s.hint}>随机性：0=确定，1=创意</span>
            </div>
            <div style={{ ...s.section, flex: 1, marginBottom: 0 }}>
              <label style={s.label}>Top P</label>
              <input style={s.input} type="number" min={0} max={1} step={0.05} value={activeBackend.top_p ?? 0.95} onChange={e => updateActiveBackend({ top_p: numberWithFallback(e.target.value, 0.95) })} />
              <span style={s.hint}>核采样：控制多样性</span>
            </div>
            <div style={{ ...s.section, flex: 1, marginBottom: 0 }}>
              <label style={s.label}>Top K</label>
              <input style={s.input} type="number" min={1} max={100} step={1} value={activeBackend.top_k ?? 20} onChange={e => updateActiveBackend({ top_k: intWithFallback(e.target.value, 20) })} />
              <span style={s.hint}>Top-K 采样（SkyClaw）</span>
            </div>
          </div>

          {/* Thinking Mode */}
          <div style={s.card}>
            <div style={s.row}>
              <span style={s.label}>深度思考模式</span>
              <button style={activeBackend.thinking_enabled ? s.toggleOn : s.toggleOff} onClick={() => updateActiveBackend({ thinking_enabled: !activeBackend.thinking_enabled })}>
                <div style={activeBackend.thinking_enabled ? s.knobOn : s.knobOff} />
              </button>
            </div>
            <span style={s.hint}>启用后模型会先深度思考再回复</span>
            {activeBackend.thinking_enabled && (
              <div style={{ marginTop: 8 }}>
                <label style={s.label}>思考预算 Tokens</label>
                <input style={s.input} type="number" value={activeBackend.thinking_budget_tokens || ''} onChange={e => updateActiveBackend({ thinking_budget_tokens: optionalInt(e.target.value) })} placeholder="10000" />
              </div>
            )}
          </div>

          {/* Safety Settings */}
          <div style={s.section}>
            <label style={s.label}>安全设置 (Gemini)</label>
            <select style={s.select} value={settings.safety_setting} onChange={e => setSettings(prev => ({ ...prev!, safety_setting: e.target.value }))}>
              <option value="BLOCK_NONE">创意模式 (不限制)</option>
              <option value="BLOCK_ONLY_HIGH">标准模式</option>
              <option value="BLOCK_MEDIUM_AND_ABOVE">严格模式</option>
            </select>
          </div>

          {/* Auto Extraction */}
          <div style={s.card}>
            <span style={s.label}>自动知识提取</span>
            <span style={{ ...s.hint, marginBottom: 8 }}>对话结束后自动提取知识到知识图谱</span>
            {([
              { key: 'conversation' as const, label: '对话提取', desc: '从对话中提取角色、事件等知识' },
              { key: 'document' as const, label: '文档提取', desc: '从编辑的文档中提取知识' },
              { key: 'chapter_analysis' as const, label: '章节分析', desc: '自动分析章节内容' },
            ]).map(item => {
              const enabled = settings.auto_extraction[item.key]
              return (
                <div key={item.key} style={s.row}>
                  <div>
                    <div style={s.itemLabel}>{item.label}</div>
                    <span style={s.hint}>{item.desc}</span>
                  </div>
                  <button style={enabled ? s.toggleOn : s.toggleOff} onClick={() => setSettings(prev => ({ ...prev!, auto_extraction: { ...prev!.auto_extraction, [item.key]: !enabled } }))}>
                    <div style={enabled ? s.knobOn : s.knobOff} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Model Routes */}
          <div style={s.card}>
            <span style={s.label}>模型路由</span>
            <span style={{ ...s.hint, marginBottom: 8 }}>不同任务使用不同模型（留空使用默认）</span>
            {([
              { id: 'main', label: '主对话', desc: '日常对话和创作' },
              { id: 'polish', label: '润色', desc: '文本润色和修改' },
              { id: 'outline', label: '大纲', desc: '大纲规划和创建' },
              { id: 'extraction', label: '知识提取', desc: '从对话中提取知识' },
              { id: 'subAgent', label: '子 Agent', desc: '子任务执行' },
            ]).map(route => {
              const current = settings.model_routes[route.id]
              return (
                <div key={route.id} style={s.routeRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={s.itemLabel}>{route.label}</div>
                    <span style={s.hint}>{route.desc}</span>
                  </div>
                  <div style={s.routeControls}>
                    <select style={s.routeSelect} value={current?.backend_id || ''} onChange={e => updateModelRoute(route.id, { backend_id: e.target.value || undefined })}>
                      <option value="">默认</option>
                      {settings.backends.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <input style={s.routeInput} value={current?.model_name || ''} onChange={e => updateModelRoute(route.id, { model_name: e.target.value || undefined })} placeholder="模型名" />
                  </div>
                </div>
              )
            })}
          </div>

          {/* 测试连接 */}
          <button style={s.testBtn} onClick={handleTest} disabled={testing}>
            {testing ? '测试中...' : '🔗 测试连接'}
          </button>
          {testResult && (
            <div style={testResult.ok ? s.testSuccess : s.testError}>
              {testResult.ok ? `✓ 连接成功 (${testResult.model})` : `✗ ${testResult.error || '连接失败'}`}
            </div>
          )}
          {error && <div style={s.testError}>{error}</div>}
        </div>

        <div style={s.footer}>
          <button style={buttons.ghost} onClick={onClose}>取消</button>
          <button style={buttons.primary} onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存并应用'}</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: ui.color.panel, borderRadius: ui.radius.md, width: '90%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1px solid ${ui.color.borderStrong}`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${ui.color.border}` },
  title: { fontSize: ui.font.base, fontWeight: 700, color: ui.color.text },
  closeBtn: { background: 'none', border: 'none', color: ui.color.faint, fontSize: 16, cursor: 'pointer', padding: '4px 8px' },
  body: { flex: 1, overflow: 'auto', padding: '12px 16px' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: `1px solid ${ui.color.border}` },
  section: { marginBottom: 14 },
  card: { background: ui.color.panelSoft, border: `1px solid ${ui.color.border}`, borderRadius: ui.radius.sm, padding: 10, marginBottom: 14, display: 'flex', flexDirection: 'column' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  label: { fontSize: ui.font.sm, fontWeight: 600, color: ui.color.primary },
  hint: { fontSize: ui.font.xs, color: ui.color.faint, lineHeight: 1.4 },
  itemLabel: { fontSize: ui.font.sm, color: ui.color.text, fontWeight: 500 },
  providerName: { fontSize: ui.font.base, fontWeight: 700, color: ui.color.text },
  input: { width: '100%', background: ui.color.bg, border: `1px solid ${ui.color.border}`, borderRadius: ui.radius.sm, padding: '6px 10px', color: ui.color.text, fontSize: ui.font.sm, outline: 'none', fontFamily: 'Consolas, Monaco, monospace', boxSizing: 'border-box' as const },
  select: { flex: 1, background: ui.color.bg, border: `1px solid ${ui.color.border}`, borderRadius: ui.radius.sm, padding: '6px 10px', color: ui.color.text, fontSize: ui.font.sm, outline: 'none', appearance: 'none' as const },
  iconBtn: { background: 'transparent', border: `1px solid ${ui.color.border}`, borderRadius: ui.radius.sm, padding: '4px 8px', color: ui.color.primary, cursor: 'pointer', fontSize: ui.font.sm },
  recommendBtn: { background: ui.color.accentSoft, border: `1px solid ${ui.color.accent}`, borderRadius: ui.radius.sm, padding: '4px 10px', color: ui.color.accent, cursor: 'pointer', fontSize: ui.font.xs, fontWeight: 600 },
  primaryBtn: { ...buttons.primary, padding: '4px 10px' },
  ghostBtn: { ...buttons.ghost, padding: '4px 10px' },
  dangerBtn: { background: 'transparent', border: `1px solid ${ui.color.danger}`, borderRadius: ui.radius.sm, padding: '4px 10px', color: ui.color.danger, cursor: 'pointer', fontSize: ui.font.xs, flexShrink: 0 },
  divider: { height: 1, background: ui.color.border, margin: '12px 0' },
  toggleOn: { width: 36, height: 18, borderRadius: 9, background: ui.color.warning, position: 'relative' as const, border: 'none', cursor: 'pointer', flexShrink: 0 },
  toggleOff: { width: 36, height: 18, borderRadius: 9, background: ui.color.panelSoft, position: 'relative' as const, border: `1px solid ${ui.color.border}`, cursor: 'pointer', flexShrink: 0 },
  knobOn: { position: 'absolute' as const, top: 2, left: 18, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' },
  knobOff: { position: 'absolute' as const, top: 2, left: 2, width: 14, height: 14, borderRadius: '50%', background: ui.color.muted, transition: 'left 0.2s' },
  routeRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${ui.color.border}` },
  routeControls: { display: 'flex', gap: 4, flexShrink: 0 },
  routeSelect: { background: ui.color.bg, border: `1px solid ${ui.color.border}`, borderRadius: ui.radius.sm, padding: '3px 6px', color: ui.color.text, fontSize: ui.font.xs, width: 80, outline: 'none' },
  routeInput: { background: ui.color.bg, border: `1px solid ${ui.color.border}`, borderRadius: ui.radius.sm, padding: '3px 6px', color: ui.color.text, fontSize: ui.font.xs, width: 100, outline: 'none', fontFamily: 'Consolas, Monaco, monospace' },
  testBtn: { ...buttons.secondary, width: '100%', marginBottom: 8 },
  testSuccess: { padding: 8, background: '#143326', border: `1px solid ${ui.color.success}`, borderRadius: ui.radius.sm, color: '#bbf7d0', fontSize: ui.font.xs },
  testError: { padding: 8, background: '#3b1d24', border: `1px solid ${ui.color.danger}`, borderRadius: ui.radius.sm, color: '#fecaca', fontSize: ui.font.xs },
}
