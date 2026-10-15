import { useEffect, useState } from 'react'
import { newId } from '../../../core/config'
import type { SourceConfig } from '../../../core/types'
import type { SourceTestResult } from '../../../shared/ipc'
import type { PageProps } from '../App'
import { Banner, Field, SecretInput, Switch, useAction } from '../components/ui'

export function SourcesPage({ config, save }: PageProps) {
  const [sources, setSources] = useState<SourceConfig[]>(config.sources)
  const [tests, setTests] = useState<Record<string, SourceTestResult | 'running'>>({})
  const saving = useAction()
  const [saved, setSaved] = useState(false)

  useEffect(() => setSources(config.sources), [config.sources])

  const dirty = JSON.stringify(sources) !== JSON.stringify(config.sources)
  const update = (id: string, patch: Partial<SourceConfig>) => {
    setSaved(false)
    setSources((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }
  const add = () =>
    setSources((list) => [...list, { id: newId(), name: `Work calendar ${list.length + 1}`, project: '', url: '', enabled: true }])
  const remove = (id: string) => setSources((list) => list.filter((s) => s.id !== id))

  const test = async (source: SourceConfig) => {
    setTests((t) => ({ ...t, [source.id]: 'running' }))
    const result = await window.api.testSource(source.url, source.ownerEmail)
    setTests((t) => ({ ...t, [source.id]: result }))
    if (result.ok && !source.ownerEmail && result.ownerEmail) update(source.id, { ownerEmail: result.ownerEmail })
  }

  const problems = sources.flatMap((s) => {
    const out: string[] = []
    if (!s.name.trim()) out.push('Every calendar needs a name')
    if (s.enabled && !s.url.trim()) out.push(`"${s.name}" has no feed URL`)
    else if (s.url && !/^(https?|webcals?):\/\//i.test(s.url.trim())) out.push(`"${s.name}" URL must start with https:// or webcal://`)
    return out
  })

  const onSave = async () => {
    const cleaned = sources.map((s) => ({ ...s, name: s.name.trim(), project: s.project.trim(), url: s.url.trim() }))
    await saving.run(async () => {
      await save({ sources: cleaned })
      setSaved(true)
    })
  }

  return (
    <div className="page">
      <div>
        <h1>Work calendars</h1>
        <p className="subtitle">
          Each work calendar is read through its private ICS link (read-only). Titles become "{config.target.titleTemplate}" using the
          project name below.
        </p>
      </div>

      <details className="card">
        <summary>Where do I find the ICS link?</summary>
        <div className="grid2" style={{ marginTop: 10 }}>
          <div>
            <h3>Google Calendar (work account)</h3>
            <ol className="help">
              <li>Open Google Calendar → ⚙ Settings.</li>
              <li>Under "Settings for my calendars", pick the calendar.</li>
              <li>Scroll to "Integrate calendar".</li>
              <li>Copy "Secret address in iCal format".</li>
            </ol>
            <p className="hint">If it is missing, your Workspace admin has disabled it.</p>
          </div>
          <div>
            <h3>Outlook / Microsoft 365</h3>
            <ol className="help">
              <li>Outlook on the web → ⚙ Settings → Calendar.</li>
              <li>Shared calendars → "Publish a calendar".</li>
              <li>Choose the calendar and "Can view all details" (or titles and locations).</li>
              <li>Publish, then copy the ICS link.</li>
            </ol>
            <p className="hint">Outlook feeds may lag behind by up to a few hours.</p>
          </div>
        </div>
      </details>

      {sources.length === 0 && <Banner kind="info">No work calendars yet - add one to get started.</Banner>}

      {sources.map((s) => {
        const t = tests[s.id]
        return (
          <div className="card" key={s.id} style={{ opacity: s.enabled ? 1 : 0.7 }}>
            <div className="row spread" style={{ marginBottom: 12 }}>
              <Switch checked={s.enabled} onChange={(v) => update(s.id, { enabled: v })} label={s.enabled ? 'Enabled' : 'Disabled'} />
              <div className="row">
                <button className="small" disabled={!s.url || t === 'running'} onClick={() => test(s)}>
                  {t === 'running' ? 'Testing…' : 'Test link'}
                </button>
                <button className="small danger" onClick={() => remove(s.id)}>
                  Remove
                </button>
              </div>
            </div>
            <div className="grid2">
              <Field label="Name" hint="Only shown in this app.">
                <input type="text" value={s.name} onChange={(e) => update(s.id, { name: e.target.value })} />
              </Field>
              <Field
                label="Project / client"
                hint={`Used in titles: "${config.target.titleTemplate.replace(/\{project\}/gi, s.project || s.name)}"`}
              >
                <input type="text" value={s.project} placeholder={s.name} onChange={(e) => update(s.id, { project: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field
                label="ICS / iCal feed URL"
                hint="Treat this like a password - anyone with it can read the calendar. Stored encrypted."
              >
                <SecretInput value={s.url} placeholder="https://… or webcal://…" onChange={(v) => update(s.id, { url: v })} />
              </Field>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary>Advanced</summary>
              <div style={{ marginTop: 8 }}>
                <Field label="Your email in this calendar" hint="Used to detect invites you declined. Auto-detected for Google feeds.">
                  <input
                    type="email"
                    value={s.ownerEmail ?? ''}
                    placeholder="you@company.com"
                    onChange={(e) => update(s.id, { ownerEmail: e.target.value.trim() || undefined })}
                  />
                </Field>
              </div>
            </details>
            {t && t !== 'running' && (
              <div style={{ marginTop: 10 }}>
                {t.ok ? (
                  <Banner kind="ok">
                    Feed works{t.calendarName ? ` - "${t.calendarName}"` : ''}: {t.eventCount} event(s) in the sync window.
                  </Banner>
                ) : (
                  <Banner kind="err">{t.error}</Banner>
                )}
              </div>
            )}
          </div>
        )
      })}

      <div className="row">
        <button onClick={add}>+ Add work calendar</button>
      </div>

      {problems.length > 0 && dirty && (
        <Banner kind="warn">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Banner>
      )}
      {saving.error && <Banner kind="err">{saving.error}</Banner>}

      <div className="savebar">
        {saved && !dirty && (
          <span className="hint" style={{ alignSelf: 'center' }}>
            Saved
          </span>
        )}
        <button disabled={!dirty} onClick={() => setSources(config.sources)}>
          Discard
        </button>
        <button className="primary" disabled={!dirty || problems.length > 0 || saving.busy} onClick={onSave}>
          Save calendars
        </button>
      </div>
    </div>
  )
}
