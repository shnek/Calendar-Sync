import { describe, expect, it } from 'vitest'
import { defaultRules } from '../src/core/config'
import { evaluateRules, matchesRule, renderTitle, validatePattern } from '../src/core/rules/engine'
import type { Rule } from '../src/core/types'
import { GOOGLE_SOURCE, makeEvent } from './helpers'

const ctx = { source: GOOGLE_SOURCE, titleTemplate: 'Work - {project}', timeZone: 'America/New_York' }
const rule = (overrides: Partial<Rule>): Rule => ({
  id: 'r',
  name: 'Rule',
  enabled: true,
  sourceIds: [],
  match: {},
  action: { type: 'exclude' },
  ...overrides,
})

describe('evaluateRules', () => {
  it('includes ordinary events with the templated title', () => {
    const d = evaluateRules(makeEvent(), defaultRules(), ctx)
    expect(d).toMatchObject({ included: true, title: 'Work - Acme' })
  })

  it.each([
    [{ status: 'cancelled' as const }, 'Skip cancelled events'],
    [{ response: 'declined' as const }, 'Skip invites I declined'],
    [{ showAs: 'free' as const }, 'Skip events marked as free'],
  ])('default rules exclude %o', (overrides, ruleName) => {
    const d = evaluateRules(makeEvent(overrides), defaultRules(), ctx)
    expect(d.included).toBe(false)
    expect(d.excludedBy?.ruleName).toBe(ruleName)
  })

  it('focus rule is off by default and works when enabled', () => {
    const focus = makeEvent({ title: 'Focus time' })
    expect(evaluateRules(focus, defaultRules(), ctx).included).toBe(true)
    const rules = defaultRules().map((r) => (r.id === 'default-focus' ? { ...r, enabled: true } : r))
    expect(evaluateRules(focus, rules, ctx).included).toBe(false)
    expect(evaluateRules(makeEvent({ title: 'Refocus planning' }), rules, ctx).included).toBe(true)
  })

  it('respects source scoping', () => {
    const r = rule({ sourceIds: ['other'], match: { titleRegex: 'Planning' } })
    expect(evaluateRules(makeEvent(), [r], ctx).included).toBe(true)
    expect(evaluateRules(makeEvent(), [{ ...r, sourceIds: ['src-google'] }], ctx).included).toBe(false)
  })

  it('setTitle rules change the title; first exclude wins', () => {
    const rename = rule({
      id: 'a',
      name: 'Rename',
      match: { titleRegex: '^1:1' },
      action: { type: 'setTitle', title: 'Work - {project} 1:1' },
    })
    const d = evaluateRules(makeEvent({ title: '1:1 with Bob' }), [rename], ctx)
    expect(d).toMatchObject({ included: true, title: 'Work - Acme 1:1', appliedRules: ['Rename'] })
    const excl = rule({ id: 'b', name: 'Drop', match: {} })
    expect(evaluateRules(makeEvent(), [excl, rename], ctx).excludedBy?.ruleId).toBe('b')
  })
})

describe('matchesRule', () => {
  const tz = 'America/New_York'
  // 2026-10-14T14:00Z is Wednesday 10:00 in New York.
  const ev = makeEvent()

  it('matches weekday and time of day in the configured zone', () => {
    expect(matchesRule(ev, { weekdays: [3] }, tz)).toBe(true)
    expect(matchesRule(ev, { weekdays: [1, 2] }, tz)).toBe(false)
    expect(matchesRule(ev, { startsAtOrAfter: '10:00', startsBefore: '12:00' }, tz)).toBe(true)
    expect(matchesRule(ev, { startsBefore: '10:00' }, tz)).toBe(false)
    expect(matchesRule(makeEvent({ allDay: true, start: '2026-10-14', end: '2026-10-15' }), { startsBefore: '23:00' }, tz)).toBe(false)
  })

  it('matches duration bounds', () => {
    expect(matchesRule(ev, { minDurationMinutes: 60 }, tz)).toBe(true)
    expect(matchesRule(ev, { maxDurationMinutes: 30 }, tz)).toBe(false)
  })

  it('matches description or location and treats invalid regex as no match', () => {
    expect(matchesRule(makeEvent({ location: 'Room 5' }), { descriptionRegex: 'room' }, tz)).toBe(true)
    expect(matchesRule(ev, { titleRegex: '([' }, tz)).toBe(false)
    expect(validatePattern('([')).toBeTruthy()
    expect(validatePattern('focus')).toBeUndefined()
  })
})

describe('renderTitle', () => {
  it('supports placeholders and falls back to Busy', () => {
    expect(renderTitle('{source}: {title}', makeEvent(), GOOGLE_SOURCE)).toBe('Acme Google: Planning')
    expect(renderTitle('  ', makeEvent(), GOOGLE_SOURCE)).toBe('Busy')
  })
})
