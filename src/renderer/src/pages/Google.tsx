import { useEffect, useState } from 'react'
import type { GoogleScopeMode } from '../../../core/types'
import type { CalendarInfo } from '../../../shared/ipc'
import type { PageProps } from '../App'
import { Banner, ExternalLink, Field, SecretInput, useAction } from '../components/ui'

export function GooglePage({ config, save, setConfig }: PageProps) {
  const g = config.google
  const usingBuiltIn = !g.clientId && g.builtInClientAvailable
  const hasClient = Boolean(g.clientId) || g.builtInClientAvailable

  return (
    <div className="page">
      <div>
        <h1>Google calendar</h1>
        <p className="subtitle">Where the busy blocks are written - a calendar in your personal Google account that you can share.</p>
      </div>
      <ClientCard config={config} save={save} usingBuiltIn={usingBuiltIn} />
      {hasClient && <AccountCard config={config} setConfig={setConfig} />}
      {g.connected && <CalendarCard config={config} setConfig={setConfig} />}
      {g.connected && <TitleCard config={config} save={save} />}
      {config.target.calendarId && (
        <div className="card">
          <h2>Share with family</h2>
          <ol className="help">
            <li>
              Open <ExternalLink href="https://calendar.google.com/calendar/r/settings">Google Calendar settings</ExternalLink> and select "
              {config.target.calendarName}".
            </li>
            <li>Under "Share with specific people or groups", add their Google account.</li>
            <li>Choose "See all event details" - only "{config.target.titleTemplate}" titles are ever written here.</li>
          </ol>
        </div>
      )}
    </div>
  )
}

function ClientCard({ config, save, usingBuiltIn }: Pick<PageProps, 'config' | 'save'> & { usingBuiltIn: boolean }) {
  const g = config.google
  const [open, setOpen] = useState(!g.clientId && !g.builtInClientAvailable)
  const [clientId, setClientId] = useState(g.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [scopeMode, setScopeMode] = useState<GoogleScopeMode>(g.scopeMode)
  const action = useAction()

  useEffect(() => {
    setClientId(g.clientId ?? '')
    setScopeMode(g.scopeMode)
  }, [g.clientId, g.scopeMode])

  const authChanges = clientId.trim() !== (g.clientId ?? '') || scopeMode !== g.scopeMode
  const dirty = authChanges || clientSecret.length > 0
  const idLooksWrong = clientId.trim() !== '' && !/\.apps\.googleusercontent\.com$/.test(clientId.trim())

  const onSave = () =>
    action.run(async () => {
      if (
        authChanges &&
        g.connected &&
        !confirm('Changing the OAuth client or permission level disconnects your Google account. Continue?')
      )
        return
      await save({ google: { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined, scopeMode } })
      setClientSecret('')
    })

  return (
    <div className="card">
      <div className="row spread">
        <div>
          <h2>1. OAuth client</h2>
          <div className="hint">
            {usingBuiltIn
              ? 'Using the OAuth client built into this release.'
              : g.clientId
                ? `Using your own client (${g.clientId.slice(0, 12)}…)`
                : 'Calendar Sync needs a Google OAuth "Desktop app" client to talk to Google Calendar.'}
          </div>
        </div>
        {!open && (
          <button className="small" onClick={() => setOpen(true)}>
            {usingBuiltIn ? 'Use my own client' : 'Edit'}
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Banner kind="info">
            Create a free Google Cloud OAuth client (about 5 minutes; the full guide is in docs/SETUP.md):
            <ol className="help">
              <li>
                In the <ExternalLink href="https://console.cloud.google.com/projectcreate">Google Cloud console</ExternalLink>, create a
                project.
              </li>
              <li>
                Enable the{' '}
                <ExternalLink href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">
                  Google Calendar API
                </ExternalLink>
                .
              </li>
              <li>
                Set up the <ExternalLink href="https://console.cloud.google.com/auth/overview">OAuth consent screen</ExternalLink>{' '}
                (External), then under Audience click "Publish app" so sign-ins don't expire after 7 days.
              </li>
              <li>
                Under <ExternalLink href="https://console.cloud.google.com/auth/clients">Clients</ExternalLink>, create a "Desktop app"
                client and paste its ID and secret below.
              </li>
            </ol>
          </Banner>
          <div className="grid2">
            <Field
              label="Client ID"
              error={idLooksWrong ? 'Client IDs end with .apps.googleusercontent.com' : undefined}
              hint={g.builtInClientAvailable ? 'Leave empty to use the built-in client.' : undefined}
            >
              <input type="text" value={clientId} spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
            </Field>
            <Field
              label="Client secret"
              hint={g.hasClientSecret ? 'Saved - leave empty to keep it.' : 'Shown next to the client ID in Google Cloud.'}
            >
              <SecretInput value={clientSecret} placeholder={g.hasClientSecret ? '••••••••' : ''} onChange={setClientSecret} />
            </Field>
          </div>
          <Field
            label="Permission level"
            hint={
              scopeMode === 'app-created'
                ? 'Recommended. Calendar Sync can only change calendars it created itself, so it can never touch your other calendars.'
                : 'Lets you sync into an existing calendar (e.g. your main one). Calendar Sync still only edits events it created.'
            }
          >
            <select value={scopeMode} onChange={(e) => setScopeMode(e.target.value as GoogleScopeMode)}>
              <option value="app-created">Only calendars created by Calendar Sync</option>
              <option value="full">All my calendars</option>
            </select>
          </Field>
          {action.error && <Banner kind="err">{action.error}</Banner>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {(g.clientId || g.builtInClientAvailable) && (
              <button onClick={() => setOpen(false)} disabled={action.busy}>
                Close
              </button>
            )}
            <button className="primary" disabled={!dirty || idLooksWrong || action.busy} onClick={onSave}>
              Save client
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AccountCard({ config, setConfig }: Pick<PageProps, 'config' | 'setConfig'>) {
  const g = config.google
  const action = useAction()

  const connect = () =>
    action.run(async () => {
      setConfig(await window.api.connectGoogle())
    })
  const disconnect = () =>
    action.run(async () => {
      if (!confirm('Disconnect your Google account? Already synced events stay in the calendar.')) return
      setConfig(await window.api.disconnectGoogle())
    })

  return (
    <div className="card">
      <div className="row spread">
        <div>
          <h2>2. Google account</h2>
          <div className="hint">
            {g.connected ? (
              <>
                Connected
                {g.accountEmail ? (
                  <>
                    {' '}
                    as <b>{g.accountEmail}</b>
                  </>
                ) : (
                  ''
                )}
                .
              </>
            ) : (
              'Sign in with the personal account that owns the shared calendar.'
            )}
          </div>
        </div>
        <div className="row">
          {action.busy && !g.connected && <button onClick={() => window.api.cancelConnectGoogle()}>Cancel</button>}
          {g.connected ? (
            <button onClick={disconnect} disabled={action.busy}>
              Disconnect
            </button>
          ) : (
            <button className="primary" onClick={connect} disabled={action.busy}>
              {action.busy ? 'Waiting for browser…' : 'Connect Google account'}
            </button>
          )}
        </div>
      </div>
      {action.busy && !g.connected && (
        <p className="hint">
          Finish signing in in your browser. If Google warns that the app isn't verified, choose "Advanced" → "Go to … (unsafe)" - it's your
          own OAuth client. On the permissions screen, tick every checkbox - Calendar Sync needs all of them.
        </p>
      )}
      {action.error && <Banner kind="err">{action.error}</Banner>}
    </div>
  )
}

function CalendarCard({ config, setConfig }: Pick<PageProps, 'config' | 'setConfig'>) {
  const [name, setName] = useState('Work')
  const [calendars, setCalendars] = useState<CalendarInfo[]>()
  const [selected, setSelected] = useState(config.target.calendarId ?? '')
  const action = useAction()
  const appCreated = config.google.scopeMode === 'app-created'

  const create = () => action.run(async () => setConfig(await window.api.createCalendar(name.trim() || 'Work')))
  const load = () => action.run(async () => setCalendars(await window.api.listCalendars()))
  const choose = () => action.run(async () => setConfig(await window.api.selectCalendar(selected)))

  return (
    <div className="card">
      <h2>3. Target calendar</h2>
      {config.target.calendarId ? (
        <p style={{ margin: '0 0 12px' }}>
          Syncing into <b>{config.target.calendarName}</b>.
        </p>
      ) : (
        <p className="hint" style={{ marginTop: 0 }}>
          A dedicated calendar is recommended - it's the one you share, and removing it removes everything Calendar Sync created.
        </p>
      )}
      <div className="grid2">
        <Field label="Create a new calendar">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            <button className={config.target.calendarId ? '' : 'primary'} disabled={action.busy} onClick={create}>
              Create
            </button>
          </div>
        </Field>
        <Field
          label="…or use an existing one"
          hint={appCreated ? 'With the default permission level, only calendars created by Calendar Sync can be used.' : undefined}
        >
          {calendars ? (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Choose…</option>
                {calendars
                  .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? ' (main)' : ''}
                    </option>
                  ))}
              </select>
              <button disabled={!selected || action.busy || selected === config.target.calendarId} onClick={choose}>
                Use
              </button>
            </div>
          ) : (
            <button disabled={action.busy} onClick={load}>
              Load my calendars
            </button>
          )}
        </Field>
      </div>
      {action.error && (
        <div style={{ marginTop: 12 }}>
          <Banner kind="err">{action.error}</Banner>
        </div>
      )}
    </div>
  )
}

function TitleCard({ config, save }: Pick<PageProps, 'config' | 'save'>) {
  const [template, setTemplate] = useState(config.target.titleTemplate)
  const action = useAction()
  useEffect(() => setTemplate(config.target.titleTemplate), [config.target.titleTemplate])
  const example = config.sources[0]
  const leaksTitle = /\{title\}/i.test(template)

  return (
    <div className="card">
      <h2>4. Event title</h2>
      <Field
        label="Title template"
        hint={
          <>
            Placeholders: <code>{'{project}'}</code>, <code>{'{source}'}</code>, <code>{'{title}'}</code>. Example: "
            {template
              .replace(/\{project\}/gi, example?.project || example?.name || 'Acme')
              .replace(/\{source\}/gi, example?.name || 'Work calendar')
              .replace(/\{title\}/gi, 'Quarterly planning')}
            "
          </>
        }
      >
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input type="text" value={template} onChange={(e) => setTemplate(e.target.value)} />
          <button
            className="primary"
            disabled={template === config.target.titleTemplate || action.busy}
            onClick={() => action.run(() => save({ target: { titleTemplate: template } }))}
          >
            Save
          </button>
        </div>
      </Field>
      {leaksTitle && (
        <div style={{ marginTop: 10 }}>
          <Banner kind="warn">{'{title}'} copies the real meeting title into the shared calendar.</Banner>
        </div>
      )}
      {action.error && <Banner kind="err">{action.error}</Banner>}
    </div>
  )
}
