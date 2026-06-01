import { useState, useEffect } from 'react'
import {
  useCharacterProfileStore,
  CHARACTER_CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_COLORS,
  SubCategoryEntry,
} from '../../stores/characterProfileStore'

interface Props {
  projectId: string
  characterId: string
  visible: boolean
  onClose: () => void
}

export function CharacterProfileView({ projectId, characterId, visible, onClose }: Props) {
  const {
    profiles, selectedProfile, loading,
    loadProfiles, selectProfile,
    addEntry, updateEntry, deleteEntry,
    archiveEntry, unarchiveEntry,
    getActiveEntries, getArchivedEntries,
    syncToBackend,
  } = useCharacterProfileStore()

  const [activeCategory, setActiveCategory] = useState<string>('状态')
  const [showArchived, setShowArchived] = useState(false)
  const [editingEntry, setEditingEntry] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newEntry, setNewEntry] = useState({ title: '', content: '', importance: 'medium' as const })

  useEffect(() => {
    if (visible) {
      loadProfiles(projectId).then(() => selectProfile(characterId))
    }
  }, [projectId, characterId, visible])

  const profile = selectedProfile

  if (!visible) return null

  const activeEntries = profile ? getActiveEntries(characterId, activeCategory) : []
  const archivedEntries = profile ? getArchivedEntries(characterId, activeCategory) : []
  const categoryType = CHARACTER_CATEGORIES[activeCategory] || 'overwrite'

  const handleCreate = () => {
    if (!newEntry.title || !profile) return
    addEntry(characterId, activeCategory, newEntry)
    setNewEntry({ title: '', content: '', importance: 'medium' })
    setShowCreate(false)
    syncToBackend(projectId)
  }

  const handleUpdate = (entryId: string, updates: Partial<SubCategoryEntry>) => {
    updateEntry(characterId, activeCategory, entryId, updates)
    setEditingEntry(null)
    syncToBackend(projectId)
  }

  const handleDelete = (entryId: string) => {
    if (!confirm('确定删除此条目？')) return
    deleteEntry(characterId, activeCategory, entryId)
    syncToBackend(projectId)
  }

  const handleArchive = (entryId: string) => {
    archiveEntry(characterId, activeCategory, entryId)
    syncToBackend(projectId)
  }

  const handleUnarchive = (entryId: string) => {
    unarchiveEntry(characterId, activeCategory, entryId)
    syncToBackend(projectId)
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: 16 }}>
            {profile?.characterName || '角色档案'}
          </h3>
          <span style={styles.closeBtn} onClick={onClose}>&times;</span>
        </div>

        <div style={styles.body}>
          {/* 分类标签 */}
          <div style={styles.categoryTabs}>
            {Object.entries(CHARACTER_CATEGORIES).map(([name, type]) => (
              <button
                key={name}
                style={{
                  ...styles.categoryTab,
                  background: activeCategory === name ? CATEGORY_COLORS[name] : 'transparent',
                  color: activeCategory === name ? '#fff' : CATEGORY_COLORS[name],
                  borderColor: CATEGORY_COLORS[name],
                }}
                onClick={() => setActiveCategory(name)}
              >
                <span>{CATEGORY_ICONS[name]}</span>
                <span>{name}</span>
              </button>
            ))}
          </div>

          {/* 分类信息 */}
          <div style={styles.categoryInfo}>
            <span style={styles.categoryType}>
              {categoryType === 'overwrite' ? '覆盖型' : '累加型'}
            </span>
            <span style={styles.categoryDesc}>
              {categoryType === 'overwrite'
                ? '每个子分类只保留最新条目'
                : '子分类可积累多条历史记录'}
            </span>
          </div>

          {/* 操作栏 */}
          <div style={styles.actionBar}>
            <button style={styles.addBtn} onClick={() => setShowCreate(true)}>
              + 添加条目
            </button>
            {categoryType === 'accumulate' && (
              <button
                style={styles.archiveToggle}
                onClick={() => setShowArchived(!showArchived)}
              >
                {showArchived ? '隐藏归档' : `显示归档 (${archivedEntries.length})`}
              </button>
            )}
          </div>

          {/* 条目列表 */}
          <div style={styles.entryList}>
            {activeEntries.length === 0 && !showCreate ? (
              <div style={styles.empty}>暂无条目</div>
            ) : (
              <>
                {activeEntries.map(entry => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    isEditing={editingEntry === entry.id}
                    onEdit={() => setEditingEntry(entry.id)}
                    onSave={(updates) => handleUpdate(entry.id, updates)}
                    onCancel={() => setEditingEntry(null)}
                    onDelete={() => handleDelete(entry.id)}
                    onArchive={categoryType === 'accumulate' ? () => handleArchive(entry.id) : undefined}
                  />
                ))}

                {showArchived && archivedEntries.map(entry => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    isArchived
                    onUnarchive={() => handleUnarchive(entry.id)}
                  />
                ))}
              </>
            )}
          </div>

          {/* 创建表单 */}
          {showCreate && (
            <div style={styles.createForm}>
              <input
                style={styles.input}
                placeholder="标题"
                value={newEntry.title}
                onChange={e => setNewEntry({ ...newEntry, title: e.target.value })}
                autoFocus
              />
              <textarea
                style={{ ...styles.input, minHeight: 80 }}
                placeholder="内容"
                value={newEntry.content}
                onChange={e => setNewEntry({ ...newEntry, content: e.target.value })}
              />
              <select
                style={styles.input}
                value={newEntry.importance}
                onChange={e => setNewEntry({ ...newEntry, importance: e.target.value as any })}
              >
                <option value="low">次要</option>
                <option value="medium">一般</option>
                <option value="high">重要</option>
                <option value="critical">关键</option>
              </select>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button style={styles.cancelBtn} onClick={() => setShowCreate(false)}>取消</button>
                <button style={styles.confirmBtn} onClick={handleCreate} disabled={!newEntry.title}>
                  创建
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 条目卡片组件 ─────────────────────────────────────

function EntryCard({ entry, isEditing, isArchived, onEdit, onSave, onCancel, onDelete, onArchive, onUnarchive }: {
  entry: SubCategoryEntry
  isEditing?: boolean
  isArchived?: boolean
  onEdit?: () => void
  onSave?: (updates: Partial<SubCategoryEntry>) => void
  onCancel?: () => void
  onDelete?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
}) {
  const [editTitle, setEditTitle] = useState(entry.title)
  const [editContent, setEditContent] = useState(entry.content)
  const [editImportance, setEditImportance] = useState(entry.importance)

  const importanceColors: Record<string, string> = {
    low: '#6b7280',
    medium: '#3b82f6',
    high: '#f59e0b',
    critical: '#ef4444',
  }

  if (isEditing && onSave && onCancel) {
    return (
      <div style={styles.entryCard}>
        <input
          style={styles.input}
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
        />
        <textarea
          style={{ ...styles.input, minHeight: 60 }}
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
        />
        <select
          style={styles.input}
          value={editImportance}
          onChange={e => setEditImportance(e.target.value as any)}
        >
          <option value="low">次要</option>
          <option value="medium">一般</option>
          <option value="high">重要</option>
          <option value="critical">关键</option>
        </select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={styles.cancelBtn} onClick={onCancel}>取消</button>
          <button style={styles.confirmBtn} onClick={() => onSave({ title: editTitle, content: editContent, importance: editImportance })}>
            保存
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...styles.entryCard, opacity: isArchived ? 0.6 : 1 }}>
      <div style={styles.entryHeader}>
        <span style={{ ...styles.importanceDot, background: importanceColors[entry.importance] }} />
        <span style={styles.entryTitle}>{entry.title}</span>
        <div style={styles.entryActions}>
          {onEdit && <button style={styles.actionBtn} onClick={onEdit}>编辑</button>}
          {onArchive && <button style={styles.actionBtn} onClick={onArchive}>归档</button>}
          {onUnarchive && <button style={styles.actionBtn} onClick={onUnarchive}>取消归档</button>}
          {onDelete && <button style={styles.deleteBtn} onClick={onDelete}>删除</button>}
        </div>
      </div>
      {entry.content && <div style={styles.entryContent}>{entry.content}</div>}
      <div style={styles.entryMeta}>
        <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
        {entry.archivedAt && <span>归档于 {new Date(entry.archivedAt).toLocaleDateString()}</span>}
      </div>
    </div>
  )
}

// ─── 样式 ─────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200,
  },
  modal: {
    background: '#111827', borderRadius: 12, width: 700, maxWidth: '90vw',
    maxHeight: '85vh', display: 'flex', flexDirection: 'column',
    border: '1px solid #1f2937',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid #1f2937',
  },
  closeBtn: { cursor: 'pointer', fontSize: 20, color: '#6b7280' },
  body: { flex: 1, overflow: 'auto', padding: '12px 20px' },
  categoryTabs: {
    display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12,
  },
  categoryTab: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '6px 12px', borderRadius: 6, border: '1px solid',
    fontSize: 12, cursor: 'pointer', background: 'transparent',
  },
  categoryInfo: {
    display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12,
    fontSize: 11, color: '#6b7280',
  },
  categoryType: {
    background: '#1f2937', padding: '2px 6px', borderRadius: 4,
    color: '#9ca3af',
  },
  categoryDesc: {},
  actionBar: {
    display: 'flex', gap: 8, marginBottom: 12,
  },
  addBtn: {
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  },
  archiveToggle: {
    background: 'transparent', border: '1px solid #374151',
    borderRadius: 6, padding: '6px 12px', color: '#9ca3af', fontSize: 12,
    cursor: 'pointer',
  },
  entryList: { display: 'flex', flexDirection: 'column', gap: 8 },
  empty: { color: '#4b5563', textAlign: 'center', padding: 20, fontSize: 13 },
  entryCard: {
    background: '#1f2937', borderRadius: 8, padding: 10,
    border: '1px solid #374151',
  },
  entryHeader: { display: 'flex', alignItems: 'center', gap: 8 },
  importanceDot: { width: 8, height: 8, borderRadius: '50%' },
  entryTitle: { fontSize: 13, color: '#e5e7eb', flex: 1, fontWeight: 600 },
  entryActions: { display: 'flex', gap: 4 },
  actionBtn: {
    background: 'transparent', border: 'none', color: '#14b8a6',
    fontSize: 11, cursor: 'pointer', padding: '2px 6px',
  },
  deleteBtn: {
    background: 'transparent', border: 'none', color: '#ef4444',
    fontSize: 11, cursor: 'pointer', padding: '2px 6px',
  },
  entryContent: { fontSize: 12, color: '#9ca3af', marginTop: 6, lineHeight: 1.5 },
  entryMeta: { fontSize: 10, color: '#4b5563', marginTop: 6, display: 'flex', gap: 8 },
  createForm: {
    background: '#1f2937', borderRadius: 8, padding: 12, marginTop: 12,
    border: '1px solid #374151', display: 'flex', flexDirection: 'column', gap: 8,
  },
  input: {
    width: '100%', background: '#0f172a', border: '1px solid #374151',
    borderRadius: 6, padding: '8px 10px', color: '#e5e7eb', fontSize: 12,
    outline: 'none', boxSizing: 'border-box',
  },
  cancelBtn: {
    background: '#1f2937', color: '#d1d5db', border: '1px solid #374151',
    borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
  },
  confirmBtn: {
    background: '#14b8a6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
  },
}
