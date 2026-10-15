import { useEffect, useState } from 'react'
import type { LogEntry, ReportSummary } from '../../../shared/ipc'
import type { PageProps } from '../App'
import { formatDateTime } from '../components/ui'

export function ActivityPage({ status }: PageProps) {
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [log, setLog] = useState<LogEntry[]>([])

  useEffect(() => {
    void window.api.getReports().then(setReports)
    void window.api.getLog().then(setLog)
  }, [status])

  return (
    <div className="page">
      <div className="row spread">
        <div>
          <h1>Activity</h1>
          <p className="subtitle">Recent syncs and log messages.</p>
        </div>
        <button onClick={() => window.api.openLogFolder()}>Open log folder</button>
      </div>

      <div className="card">
        <h2>Recent syncs</h2>
        {reports.length === 0 ? (
          <p className="hint">No syncs yet in this session.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Finished</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Deleted</th>
                <th>Unchanged</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.finishedAt}>
                  <td>{formatDateTime(r.finishedAt)}</td>
                  <td>{r.created}</td>
                  <td>{r.updated}</td>
                  <td>{r.deleted}</td>
                  <td>{r.unchanged}</td>
                  <td>
                    {r.errors.length ? (
                      <span className="badge err" title={r.errors.join('\n')}>
                        {r.errors.length}
                      </span>
                    ) : (
                      <span className="badge ok">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Log</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {log.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td className="mono" style={{ width: 160, whiteSpace: 'nowrap' }}>
                    {new Date(e.at).toLocaleString()}
                  </td>
                  <td style={{ width: 60 }}>
                    <span className={`badge ${e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : 'muted'}`}>{e.level}</span>
                  </td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
