import { useState, type ReactNode } from 'react'

export function Field(props: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.error ? <div className="error-text">{props.error}</div> : props.hint ? <div className="hint">{props.hint}</div> : null}
    </label>
  )
}

export function Switch(props: { checked: boolean; onChange: (value: boolean) => void; label?: ReactNode; title?: string }) {
  return (
    <label className="switch" title={props.title}>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  )
}

export function Chips<T extends string | number>(props: {
  options: { value: T; label: string }[]
  selected: T[] | undefined
  onChange: (value: T[] | undefined) => void
}) {
  const selected = props.selected ?? []
  return (
    <div className="chips">
      {props.options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            type="button"
            key={String(o.value)}
            className={`chip${on ? ' on' : ''}`}
            aria-pressed={on}
            onClick={() => {
              const next = on ? selected.filter((v) => v !== o.value) : [...selected, o.value]
              props.onChange(next.length ? next : undefined)
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Banner(props: { kind: 'info' | 'warn' | 'err' | 'ok'; children: ReactNode }) {
  return (
    <div className={`banner ${props.kind}`} role={props.kind === 'err' ? 'alert' : undefined}>
      {props.children}
    </div>
  )
}

export function SecretInput(props: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input
        type={shown ? 'text' : 'password'}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <button type="button" className="icon small" onClick={() => setShown(!shown)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

export function ExternalLink(props: { href: string; children: ReactNode }) {
  return (
    <a
      href={props.href}
      onClick={(e) => {
        e.preventDefault()
        void window.api.openExternal(props.href)
      }}
    >
      {props.children}
    </a>
  )
}

/** Runs an async action while tracking busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setError(undefined)
    try {
      return await fn()
    } catch (err) {
      setError(cleanError(err))
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

/** Strips Electron's "Error invoking remote method 'x': Error: " prefix. */
export function cleanError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelative(iso: string | undefined): string {
  if (!iso) return 'never'
  const diff = Date.parse(iso) - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < 60_000) return diff < 0 ? 'just now' : 'in a moment'
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  return formatDateTime(iso)
}
