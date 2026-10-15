import { useEffect, useState } from 'react'
import { defaultRules, newId } from '../../../core/config'
import { validatePattern } from '../../../core/rules/engine'
import type { EventStatus, ResponseStatus, Rule, RuleMatch, ShowAs, SourceConfig } from '../../../core/types'
import type { PageProps } from '../App'
import { Banner, Chips, Field, Switch, useAction } from '../components/ui'

const SHOW_AS: { value: ShowAs; label: string }[] = [
  { value: 'busy', label: 'Busy' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'free', label: 'Free' },
  { value: 'oof', label: 'Out of office' },
  { value: 'workingElsewhere', label: 'Working elsewhere' },
]
const STATUS: { value: EventStatus; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'cancelled', label: 'Cancelled' },
]
const RESPONSE: { value: ResponseStatus; label: string }[] = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'tentative', label: 'Maybe' },
  { value: 'needsAction', label: 'Not answered' },
  { value: 'declined', label: 'Declined' },
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, value) => ({ value, label }))

function tri(value: boolean | undefined): string {
  return value === undefined ? '' : value ? 'yes' : 'no'
}
function fromTri(value: string): boolean | undefined {
  return value === '' ? undefined : value === 'yes'
}
function num(value: string): number | undefined {
  const n = Number(value)
  return value.trim() === '' || !Number.isFinite(n) ? undefined : n
}

function describeMatch(m: RuleMatch): string {
  const parts: string[] = []
  if (m.titleRegex) parts.push(`title matches /${m.titleRegex}/`)
  if (m.descriptionRegex) parts.push(`details match /${m.descriptionRegex}/`)
  if (m.showAs?.length) parts.push(`shown as ${m.showAs.join('/')}`)
  if (m.status?.length) parts.push(`status ${m.status.join('/')}`)
  if (m.response?.length) parts.push(`my response ${m.response.join('/')}`)
  if (m.allDay !== undefined) parts.push(m.allDay ? 'all-day' : 'not all-day')
  if (m.recurring !== undefined) parts.push(m.recurring ? 'recurring' : 'one-off')
  if (m.minDurationMinutes != null) parts.push(`≥ ${m.minDurationMinutes} min`)
  if (m.maxDurationMinutes != null) parts.push(`≤ ${m.maxDurationMinutes} min`)
  if (m.weekdays?.length) parts.push(m.weekdays.map((d) => WEEKDAYS[d].label).join(','))
  if (m.startsAtOrAfter) parts.push(`starts ≥ ${m.startsAtOrAfter}`)
  if (m.startsBefore) parts.push(`starts < ${m.startsBefore}`)
  return parts.length ? parts.join(' and ') : 'every event'
}

export function RulesPage({ config, save, navigate }: PageProps) {
  const [rules, setRules] = useState<Rule[]>(config.rules)
  const action = useAction()
  useEffect(() => setRules(config.rules), [config.rules])

  const dirty = JSON.stringify(rules) !== JSON.stringify(config.rules)
  const update = (id: string, patch: Partial<Rule>) => setRules((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const updateMatch = (id: string, patch: Partial<RuleMatch>) =>
    setRules((list) => list.map((r) => (r.id === id ? { ...r, match: { ...r.match, ...patch } } : r)))
  const move = (index: number, delta: number) =>
    setRules((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + delta, 0, item)
      return next
    })
  const add = () =>
    setRules((list) => [
      ...list,
      { id: newId(), name: 'New rule', enabled: true, sourceIds: [], match: { titleRegex: '' }, action: { type: 'exclude' } },
    ])

  const errors = rules.flatMap((r) => {
    const e: string[] = []
    if (r.match.titleRegex && validatePattern(r.match.titleRegex)) e.push(`"${r.name}": invalid title pattern`)
    if (r.match.descriptionRegex && validatePattern(r.match.descriptionRegex)) e.push(`"${r.name}": invalid details pattern`)
    if (r.action.type === 'setTitle' && !r.action.title.trim()) e.push(`"${r.name}": title cannot be empty`)
    return e
  })
  const catchAll = rules.find((r) => r.enabled && r.action.type === 'exclude' && describeMatch(cleanMatch(r.match)) === 'every event')

  const onSave = () =>
    action.run(() => save({ rules: rules.map((r) => ({ ...r, name: r.name.trim() || 'Rule', match: cleanMatch(r.match) })) }))

  return (
    <div className="page">
      <div>
        <h1>Rules</h1>
        <p className="subtitle">
          Rules run top to bottom. The first matching "skip" rule removes the event; "rename" rules change the title. Use{' '}
          <a onClick={() => navigate('preview')}>Preview</a> to see exactly what each rule does.
        </p>
      </div>

      {rules.map((r, i) => (
        <RuleCard
          key={r.id}
          rule={r}
          sources={config.sources}
          first={i === 0}
          last={i === rules.length - 1}
          onChange={(patch) => update(r.id, patch)}
          onMatch={(patch) => updateMatch(r.id, patch)}
          onMove={(d) => move(i, d)}
          onRemove={() => setRules((list) => list.filter((x) => x.id !== r.id))}
        />
      ))}

      <div className="row">
        <button onClick={add}>+ Add rule</button>
        <button
          onClick={() => {
            const missing = defaultRules().filter((d) => !rules.some((r) => r.id === d.id))
            setRules([...rules, ...missing])
          }}
        >
          Restore default rules
        </button>
      </div>

      {catchAll && <Banner kind="warn">"{catchAll.name}" has no conditions and will skip every event.</Banner>}
      {errors.length > 0 && (
        <Banner kind="err">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Banner>
      )}
      {action.error && <Banner kind="err">{action.error}</Banner>}

      <div className="savebar">
        <button disabled={!dirty} onClick={() => setRules(config.rules)}>
          Discard
        </button>
        <button className="primary" disabled={!dirty || errors.length > 0 || action.busy} onClick={onSave}>
          Save rules
        </button>
      </div>
    </div>
  )
}

/** Drops empty conditions so they don't accidentally restrict matching. */
function cleanMatch(m: RuleMatch): RuleMatch {
  const out: RuleMatch = {}
  for (const [k, v] of Object.entries(m) as [keyof RuleMatch, unknown][]) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  return out
}

function RuleCard(props: {
  rule: Rule
  sources: SourceConfig[]
  first: boolean
  last: boolean
  onChange: (patch: Partial<Rule>) => void
  onMatch: (patch: Partial<RuleMatch>) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const { rule: r, onChange, onMatch } = props
  const m = r.match
  const titleError = m.titleRegex ? validatePattern(m.titleRegex) : undefined
  const descError = m.descriptionRegex ? validatePattern(m.descriptionRegex) : undefined

  return (
    <div className={`card rule${r.enabled ? '' : ' disabled'}`}>
      <div className="rule-head">
        <Switch checked={r.enabled} onChange={(v) => onChange({ enabled: v })} title={r.enabled ? 'Enabled' : 'Disabled'} />
        <input type="text" value={r.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Rule name" />
        <button className="icon small" disabled={props.first} onClick={() => props.onMove(-1)} title="Move up" aria-label="Move up">
          ↑
        </button>
        <button className="icon small" disabled={props.last} onClick={() => props.onMove(1)} title="Move down" aria-label="Move down">
          ↓
        </button>
        <button className="small danger" onClick={props.onRemove}>
          Delete
        </button>
      </div>
      <div className="hint">
        {r.action.type === 'exclude' ? 'Skip' : 'Rename'} when {describeMatch(cleanMatch(m))}
        {r.sourceIds.length
          ? ` (only ${r.sourceIds.map((id) => props.sources.find((s) => s.id === id)?.name ?? 'removed calendar').join(', ')})`
          : ''}
        .
      </div>

      <div className="grid2">
        <Field label="Title matches (regular expression, case-insensitive)" error={titleError}>
          <input
            type="text"
            className={titleError ? 'invalid' : ''}
            value={m.titleRegex ?? ''}
            placeholder="e.g. focus|lunch|^hold"
            spellCheck={false}
            onChange={(e) => onMatch({ titleRegex: e.target.value || undefined })}
          />
        </Field>
        <Field label="Then">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select
              value={r.action.type}
              style={{ width: 'auto' }}
              onChange={(e) =>
                onChange({ action: e.target.value === 'exclude' ? { type: 'exclude' } : { type: 'setTitle', title: 'Work - {project}' } })
              }
            >
              <option value="exclude">Skip the event</option>
              <option value="setTitle">Use title…</option>
            </select>
            {r.action.type === 'setTitle' && (
              <input
                type="text"
                value={r.action.title}
                onChange={(e) => onChange({ action: { type: 'setTitle', title: e.target.value } })}
                aria-label="Replacement title"
              />
            )}
          </div>
        </Field>
      </div>

      <details>
        <summary>More conditions</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
          <Field label="Only for these calendars (none selected = all)">
            <Chips
              options={props.sources.map((s) => ({ value: s.id, label: s.name }))}
              selected={r.sourceIds}
              onChange={(v) => onChange({ sourceIds: v ?? [] })}
            />
          </Field>
          <div className="grid3">
            <Field label="Shown as">
              <Chips options={SHOW_AS} selected={m.showAs} onChange={(v) => onMatch({ showAs: v })} />
            </Field>
            <Field label="Status">
              <Chips options={STATUS} selected={m.status} onChange={(v) => onMatch({ status: v })} />
            </Field>
            <Field label="My response">
              <Chips options={RESPONSE} selected={m.response} onChange={(v) => onMatch({ response: v })} />
            </Field>
          </div>
          <div className="grid3">
            <Field label="All-day">
              <select value={tri(m.allDay)} onChange={(e) => onMatch({ allDay: fromTri(e.target.value) })}>
                <option value="">Any</option>
                <option value="yes">Only all-day</option>
                <option value="no">Only timed</option>
              </select>
            </Field>
            <Field label="Recurring">
              <select value={tri(m.recurring)} onChange={(e) => onMatch({ recurring: fromTri(e.target.value) })}>
                <option value="">Any</option>
                <option value="yes">Only recurring</option>
                <option value="no">Only one-off</option>
              </select>
            </Field>
            <Field label="Details / location match (regex)" error={descError}>
              <input
                type="text"
                className={descError ? 'invalid' : ''}
                value={m.descriptionRegex ?? ''}
                spellCheck={false}
                onChange={(e) => onMatch({ descriptionRegex: e.target.value || undefined })}
              />
            </Field>
          </div>
          <div className="grid3">
            <Field label="Min duration (minutes)">
              <input
                type="number"
                min={0}
                value={m.minDurationMinutes ?? ''}
                onChange={(e) => onMatch({ minDurationMinutes: num(e.target.value) })}
              />
            </Field>
            <Field label="Max duration (minutes)">
              <input
                type="number"
                min={0}
                value={m.maxDurationMinutes ?? ''}
                onChange={(e) => onMatch({ maxDurationMinutes: num(e.target.value) })}
              />
            </Field>
            <div />
          </div>
          <Field label="Weekdays">
            <Chips options={WEEKDAYS} selected={m.weekdays} onChange={(v) => onMatch({ weekdays: v })} />
          </Field>
          <div className="grid3">
            <Field label="Starts at or after">
              <input
                type="time"
                value={m.startsAtOrAfter ?? ''}
                onChange={(e) => onMatch({ startsAtOrAfter: e.target.value || undefined })}
              />
            </Field>
            <Field label="Starts before">
              <input type="time" value={m.startsBefore ?? ''} onChange={(e) => onMatch({ startsBefore: e.target.value || undefined })} />
            </Field>
            <div />
          </div>
        </div>
      </details>
    </div>
  )
}
