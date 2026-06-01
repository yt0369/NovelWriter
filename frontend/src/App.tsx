import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ProjectManager } from './components/ProjectManager'
import { MainLayout } from './components/layout/MainLayout'
import { Toast } from './components/common/Toast'
import { useProjectStore } from './stores/projectStore'

function RouteSync() {
  const location = useLocation()
  const currentProject = useProjectStore(s => s.currentProject)
  const setCurrentProject = useProjectStore(s => s.setCurrentProject)
  const initFromUrl = useProjectStore(s => s.initFromUrl)

  useEffect(() => {
    if (location.pathname === '/') {
      if (currentProject) setCurrentProject(null)
    } else {
      const match = location.pathname.match(/^\/project\/([^/]+)$/)
      if (match && (!currentProject || currentProject.id !== match[1])) {
        initFromUrl()
      }
    }
  }, [location.pathname])

  return null
}

export default function App() {
  const [backendReady, setBackendReady] = useState(false)
  const [initChecked, setInitChecked] = useState(false)
  const currentProject = useProjectStore(s => s.currentProject)
  const initFromUrl = useProjectStore(s => s.initFromUrl)

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health')
        if (res.ok) {
          setBackendReady(true)
          const found = await initFromUrl()
          if (!found && window.location.pathname !== '/') {
            window.history.replaceState(null, '', '/')
          }
          setInitChecked(true)
        }
      } catch {
        setTimeout(checkHealth, 1000)
      }
    }
    checkHealth()
  }, [initFromUrl])

  if (!backendReady || !initChecked) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#1a1a2e', color: '#e0e0e0' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 12 }}>NovelWriter</h2>
          <p style={{ color: '#888' }}>正在连接后端服务...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <RouteSync />
      <Toast />
      <Routes>
        <Route path="/" element={<ProjectManager />} />
        <Route
          path="/project/:projectId"
          element={currentProject ? <MainLayout /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
