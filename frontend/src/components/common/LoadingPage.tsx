import { useState, useEffect } from 'react'

interface Props {
  message?: string
  timeout?: number
}

export function LoadingPage({ message = '正在加载...', timeout = 10000 }: Props) {
  const [showTimeout, setShowTimeout] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowTimeout(true), timeout)
    return () => clearTimeout(timer)
  }, [timeout])

  return (
    <div style={styles.container}>
      <div style={styles.spinner} />
      <p style={styles.message}>{message}</p>
      {showTimeout && (
        <p style={styles.timeout}>
          加载时间较长，请检查网络连接或刷新页面重试
        </p>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#0f1117',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #1f2937',
    borderTop: '3px solid #14b8a6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  message: {
    marginTop: 16,
    fontSize: 14,
    color: '#9ca3af',
  },
  timeout: {
    marginTop: 8,
    fontSize: 12,
    color: '#6b7280',
  },
}
