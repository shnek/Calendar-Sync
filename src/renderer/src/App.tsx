import { useCallback, useEffect, useState } from 'react'
import type { ConfigPatch, PublicConfig, StatusInfo } from '../../shared/ipc'
import { ActivityPage } from './pages/Activity'
import { GooglePage } from './pages/Google'
import { OverviewPage } from './pages/Overview'
import { PreviewPage } from './pages/Preview'
import { RulesPage } from './pages/Rules'
import { SettingsPage } from './pages/Settings'
import { SourcesPage } from './pages/Sources'

export type PageId = 'overview' | 'sources' | 'google' | 'rules' | 'preview' | 'activity' | 'settings'

const PAGES: { id: PageId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sources', label: 'Work calendars' },
  { id: 'google', label: 'Google calendar' },
  { id: 'rules', label: 'Rules' },
  { id: 'preview', label: 'Preview' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
]

export interface PageProps {
  config: PublicConfig
  status: StatusInfo
  save: (patch: ConfigPatch) => Promise<void>
  setConfig: (config: PublicConfig) => void
  navigate: (page: PageId) => void
}

function initialPage(): PageId {
  const hash = window.location.hash.replace('#', '')
  return PAGES.some((p) => p.id === hash) ? (hash as PageId) : 'overview'
}

export function App() {
  const [config, setConfig] = useState<PublicConfig>()
  const [status, setStatus] = useState<StatusInfo>()
  const [page, setPage] = useState<PageId>(initialPage)

  useEffect(() => {
    void window.api.getConfig().then(setConfig)
    void window.api.getStatus().then(setStatus)
    const off = window.api.onStatus((s) => {
      setStatus(s)
      // Setup state can change from the main process (e.g. token rotation).
      void window.api.getConfig().then(setConfig)
    })
    window.onNavigate((p) => {
      if (PAGES.some((x) => x.id === p)) setPage(p as PageId)
    })
    return off
  }, [])

  const save = useCallback(async (patch: ConfigPatch) => {
    setConfig(await window.api.updateConfig(patch))
  }, [])

  if (!config || !status) return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading…</div>

  const props: PageProps = { config, status, save, setConfig, navigate: setPage }
  const needsSetup = (id: PageId) =>
    (id === 'sources' && !config.sources.some((s) => s.enabled && s.url)) ||
    (id === 'google' && (!config.google.connected || !config.target.calendarId))

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand">
          <span className={`brand-dot ${status.state}`} title={status.message} />
          Calendar Sync
        </div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`nav-item${page === p.id ? ' active' : ''}`}
            aria-current={page === p.id ? 'page' : undefined}
            onClick={() => setPage(p.id)}
          >
            {p.label}
            {needsSetup(p.id) && <span className="badge warn">!</span>}
          </button>
        ))}
        <div className="sidebar-footer">v{status.version}</div>
      </nav>
      <main>
        {page === 'overview' && <OverviewPage {...props} />}
        {page === 'sources' && <SourcesPage {...props} />}
        {page === 'google' && <GooglePage {...props} />}
        {page === 'rules' && <RulesPage {...props} />}
        {page === 'preview' && <PreviewPage {...props} />}
        {page === 'activity' && <ActivityPage {...props} />}
        {page === 'settings' && <SettingsPage {...props} />}
      </main>
    </div>
  )
}
