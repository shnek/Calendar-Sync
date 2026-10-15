import { useEffect, useState } from 'react'
import type { ReportSummary } from '../../../shared/ipc'
import type { PageId, PageProps } from '../App'
import { Banner, cleanError, formatRelative } from '../components/ui'

export function OverviewPage({ config, status, navigate }: PageProps) {
  const [last, setLast] = useState<ReportSummary>()
  const [syncError, setSyncError] = useState<string>()

  useEffect(() => {
    void window.api.getReports().then((r) => setLast(r[0]))
  }, [status.lastSyncAt])

  const steps: { label: string; done: boolean; page: PageId }[] = [
    { label: 'Add your work calendar feeds (ICS links)', done: config.sources.some((s) => s.enabled && s.url), page: 'sources' },
    {
      label: 'Set up a Google OAuth client',
      done: Boolean(config.google.clientId || config.google.builtInClientAvailable),
      page: 'google',
    },
    { label: 'Connect your personal Google account', done: config.google.connected, page: 'google' },
    { label: 'Create or choose the calendar to sync into', done: Boolean(config.target.calendarId), page: 'google' },
    { label: 'Check the preview and tune rules', done: false, page: 'preview' },
  ]
  const setupDone = status.setupIssues.length === 0

  const syncNow = async () => {
    setSyncError(undefined)
    try {
      await window.api.syncNow()
    } catch (err) {
      setSyncError(cleanError(err))
    }
  }

  return (
    <div className="page">
      <div>
        <h1>Overview</h1>
        <p className="subtitle">
          Mirrors your work calendars into a private Google Calendar as detail-free "{config.target.titleTemplate}" blocks.
        </p>
      </div>

      {!setupDone && (
        <div className="card">
          <h2>Get started</h2>
          <ol className="checklist">
            {steps.map((s, i) => (
              <li key={s.label}>
                <span className={`step${s.done ? ' done' : ''}`}>{s.done ? '✓' : i + 1}</span>
                <a onClick={() => navigate(s.page)}>{s.label}</a>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="card">
        <div className="row spread">
          <div>
            <h2>Status</h2>
            <div className="row">
              <StateBadge state={status.state} />
              <span>{status.message}</span>
            </div>
          </div>
          <button className="primary" disabled={!setupDone || status.state === 'syncing'} onClick={syncNow}>
            {status.state === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        {syncError && <Banner kind="err">{syncError}</Banner>}
        <div className="stats" style={{ marginTop: 14 }}>
          <div className="stat">
            <span>Last successful sync</span>
            <b style={{ fontSize: 15 }}>{formatRelative(status.lastSuccessAt)}</b>
          </div>
          <div className="stat">
            <span>Next sync</span>
            <b style={{ fontSize: 15 }}>
              {!setupDone
                ? 'after setup'
                : !config.sync.autoSync
                  ? 'paused'
                  : status.state === 'syncing'
                    ? 'now'
                    : status.nextSyncAt
                      ? formatRelative(status.nextSyncAt)
                      : '-'}
            </b>
          </div>
          <div className="stat">
            <span>Target calendar</span>
            <b style={{ fontSize: 15 }}>{config.target.calendarName ?? 'not set'}</b>
          </div>
          <div className="stat">
            <span>Work calendars</span>
            <b style={{ fontSize: 15 }}>{config.sources.filter((s) => s.enabled).length} enabled</b>
          </div>
        </div>
      </div>

      {last && (
        <div className="card">
          <h2>Last sync</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {formatRelative(last.finishedAt)}
          </p>
          <div className="stats">
            <div className="stat">
              <b>{last.created}</b>
              <span>created</span>
            </div>
            <div className="stat">
              <b>{last.updated}</b>
              <span>updated</span>
            </div>
            <div className="stat">
              <b>{last.deleted}</b>
              <span>deleted</span>
            </div>
            <div className="stat">
              <b>{last.unchanged}</b>
              <span>unchanged</span>
            </div>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Calendar</th>
                <th>Status</th>
                <th>Events in window</th>
                <th>Synced</th>
              </tr>
            </thead>
            <tbody>
              {last.sources.map((s) => (
                <tr key={s.sourceId}>
                  <td>{s.name}</td>
                  <td>
                    {s.ok ? (
                      <span className="badge ok">OK</span>
                    ) : (
                      <span className="badge err" title={s.error}>
                        {s.error}
                      </span>
                    )}
                  </td>
                  <td>{s.eventCount}</td>
                  <td>{s.includedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {last.errors.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Banner kind="warn">
                {last.errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </Banner>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, [string, string]> = {
    idle: ['ok', 'Healthy'],
    syncing: ['muted', 'Syncing'],
    error: ['err', 'Problem'],
    unconfigured: ['warn', 'Setup needed'],
    paused: ['warn', 'Paused'],
  }
  const [kind, label] = map[state] ?? ['muted', state]
  return <span className={`badge ${kind}`}>{label}</span>
}
