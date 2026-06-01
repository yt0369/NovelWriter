import { useTodoStore } from '../../stores/todoStore'

interface Props {
  items?: { id: string; text: string; done: boolean }[]
}

export function AgentTodoList({ items: propItems }: Props) {
  const { todos, toggleTodo } = useTodoStore()
  const items = propItems || todos

  if (!items || items.length === 0) return null

  const doneCount = items.filter(i => i.done).length

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>任务清单</span>
        <span style={styles.count}>{doneCount}/{items.length}</span>
      </div>
      <div style={styles.list}>
        {items.map(item => (
          <div key={item.id} style={styles.item} onClick={() => toggleTodo(item.id)}>
            <span style={{
              ...styles.checkbox,
              ...(item.done ? styles.checkboxDone : {}),
            }}>
              {item.done ? '✓' : ''}
            </span>
            <span style={{
              ...styles.text,
              ...(item.done ? styles.textDone : {}),
            }}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    margin: '0 16px 8px',
    background: '#12121f',
    borderRadius: 8,
    border: '1px solid #2a2a3e',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #2a2a3e',
    background: '#1a1a2e',
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: '#a78bfa',
  },
  count: {
    fontSize: 11,
    color: '#888',
  },
  list: {
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  checkbox: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    borderRadius: 3,
    border: '1px solid #3a3a5e',
    fontSize: 10,
    color: '#888',
    flexShrink: 0,
  },
  checkboxDone: {
    background: '#22c55e',
    borderColor: '#22c55e',
    color: '#fff',
  },
  text: {
    fontSize: 12,
    color: '#e0e0e0',
    lineHeight: 1.5,
  },
  textDone: {
    textDecoration: 'line-through',
    color: '#555',
  },
}
