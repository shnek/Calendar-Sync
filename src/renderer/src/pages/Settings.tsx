import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, SyncSettings } from '../../../core/types'
import type { PageProps } from '../App'
import { Banner, Field, Switch, useAction } from '../components/ui'

export function SettingsPage({ config, status, save }: PageProps) {
  const [sync, setSync] = useState<SyncSettings>(config.sync)
  const [updateMessage, setUpdateMessage] = useState<string>()
  const action = useAction()
  useEffect(() => setSync(config.sync), [config.sync])

  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone')
    } catch {
      return []
    }
  }, [])
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const zoneInvalid = Boolean(sync.timeZone) && zones.length > 0 && !zones.includes(sync.timeZone!)
  const dirty = JSON.stringify(sync) !== JSON.stringify(config.sync)

  const setApp = (patch: Partial<AppSettings>) => action.run(() => save({ app: patch }))

  return (
    <div className="page">
      <div>
        <h1>Settings</h1>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Sync</h2>
        <Switch checked={sync.autoSync} onChange={(v) => setSync({ ...sync, autoSync: v })} label="Sync automatically in the background" />
        <div className="grid3">
          <Field label="Every (minutes)" hint="5 - 1440">
            <input
              type="number"
              min={5}
              max={1440}
              value={sync.intervalMinutes}
              onChange={(e) => setSync({ ...sync, intervalMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Days in the past" hint="0 - 90">
            <input
              type="number"
              min={0}
              max={90}
              value={sync.pastDays}
              onChange={(e) => setSync({ ...sync, pastDays: Number(e.target.value) })}
            />
          </Field>
          <Field label="Days ahead" hint="1 - 365">
            <input
              type="number"
              min={1}
              max={365}
              value={sync.futureDays}
              onChange={(e) => setSync({ ...sync, futureDays: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field
          label="Time zone for rules"
          hint={`Used by weekday and time-of-day conditions. Empty = this computer's zone (${systemZone}).`}
          error={zoneInvalid ? 'Unknown time zone' : undefined}
        >
          <input
            type="text"
            list="zones"
            value={sync.timeZone ?? ''}
            placeholder={systemZone}
            onChange={(e) => setSync({ ...sync, timeZone: e.target.value || undefined })}
          />
          <datalist id="zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Banner kind="info">
          Using Calendar Sync on more than one computer is safe - events are never duplicated - but it's simplest to keep automatic sync on
          for just one of them.
        </Banner>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button disabled={!dirty} onClick={() => setSync(config.sync)}>
            Discard
          </button>
          <button className="primary" disabled={!dirty || zoneInvalid || action.busy} onClick={() => action.run(() => save({ sync }))}>
            Save
          </button>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Application</h2>
        <Switch
          checked={config.app.launchAtLogin}
          onChange={(v) => setApp({ launchAtLogin: v })}
          label="Start Calendar Sync when I log in"
        />
        <Switch checked={config.app.autoUpdate} onChange={(v) => setApp({ autoUpdate: v })} label="Install updates automatically" />
        <div className="row">
          <button
            onClick={async () => {
              setUpdateMessage('Checking…')
              setUpdateMessage(await window.api.checkForUpdates())
            }}
          >
            Check for updates
          </button>
          <span className="hint">
            Version {status.version}
            {updateMessage ? ` - ${updateMessage}` : ''}
          </span>
        </div>
      </div>
      {action.error && <Banner kind="err">{action.error}</Banner>}
    </div>
  )
}
