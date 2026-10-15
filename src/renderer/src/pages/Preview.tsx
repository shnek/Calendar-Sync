import { useEffect, useMemo, useState } from 'react'
import type { PreviewResult } from '../../../core/types'
import type { PageProps } from '../App'
import { Banner, formatDateTime, useAction } from '../components/ui'

type Filter = 'all' | 'included' | 'excluded'

export function PreviewPage({ config, navigate }: PageProps) {
  const [preview, setPreview] = useState<PreviewResult>()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const action = useAction()

  const load = () => action.run(async () => setPreview(await window.api.preview()))
  useEffect(() => {
    if (config.sources.some((s) => s.enabled && s.url)) void load()
    // Reload when rules/sources/template change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.rules, config.sources, config.target.titleTemplate])

  const sourceName = useMemo(() => new Map(config.sources.map((s) => [s.id, s.name])), [config.sources])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (preview?.decisions ?? []).filter(
      (d) =>
        (filter === 'all' || (filter === 'included') === d.included) &&
        (!q || d.event.title.toLowerCase().includes(q) || d.title.toLowerCase().includes(q)),
    )
  }, [preview, filter, query])

  const included = preview?.decisions.filter((d) => d.included).length ?? 0
  const total = preview?.decisions.length ?? 0

  if (!config.sources.some((s) => s.enabled && s.url)) {
    return (
      <div className="page">
        <h1>Preview</h1>
        <Banner kind="info">
          Add a work calendar first - <a onClick={() => navigate('sources')}>Work calendars</a>.
        </Banner>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="row spread">
        <div>
          <h1>Preview</h1>
          <p className="subtitle">
            What the next sync will write, read live from your feeds. Original titles are only shown here, on this computer.
          </p>
        </div>
        <button onClick={load} disabled={action.busy}>
          {action.busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {action.error && <Banner kind="err">{action.error}</Banner>}

      {preview && (
        <>
          <div className="row">
            {preview.sources.map((s) =>
              s.ok ? (
                <span key={s.sourceId} className="badge ok">
                  {s.name}: {s.includedCount}/{s.eventCount}
                </span>
              ) : (
                <span key={s.sourceId} className="badge err" title={s.error}>
                  {s.name}: {s.error}
                </span>
              ),
            )}
          </div>
          <div className="card">
            <div className="row spread" style={{ marginBottom: 10 }}>
              <div className="row">
                {(['all', 'included', 'excluded'] as Filter[]).map((f) => (
                  <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                    {f === 'all' ? `All (${total})` : f === 'included' ? `Synced (${included})` : `Skipped (${total - included})`}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Search titles…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ maxWidth: 240 }}
              />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>When</th>
                    <th style={{ width: 130 }}>Calendar</th>
                    <th>Original title</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={`${d.event.sourceId}:${d.event.key}`} className={d.included ? '' : 'excluded'}>
                      <td>{d.event.allDay ? `${d.event.start} · all day` : formatDateTime(d.event.start)}</td>
                      <td>{sourceName.get(d.event.sourceId) ?? '?'}</td>
                      <td>{d.event.title || <i>(no title)</i>}</td>
                      <td>
                        {d.included ? (
                          <>
                            <b>{d.title}</b>
                            {d.appliedRules.length > 0 && <div className="hint">via {d.appliedRules.join(', ')}</div>}
                          </>
                        ) : (
                          <span>Skipped - {d.excludedBy?.ruleName}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="hint">
                        No events.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
