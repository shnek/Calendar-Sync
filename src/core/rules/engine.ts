import type { EventDecision, NormalizedEvent, Rule, RuleMatch, SourceConfig } from '../types'
import { boundaryMs, parseClock, zonedParts } from '../time'

export interface RuleContext {
  source: SourceConfig
  titleTemplate: string
  timeZone: string
}

const regexCache = new Map<string, RegExp | null>()

/** Compiles a user-supplied pattern case-insensitively; invalid patterns never match. */
export function compilePattern(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, 'i'))
    } catch {
      regexCache.set(pattern, null)
    }
  }
  return regexCache.get(pattern) ?? null
}

export function validatePattern(pattern: string): string | undefined {
  try {
    new RegExp(pattern, 'i')
    return undefined
  } catch (err) {
    return (err as Error).message
  }
}

function hasValue<T>(list: T[] | undefined): list is T[] {
  return Array.isArray(list) && list.length > 0
}

export function matchesRule(event: NormalizedEvent, match: RuleMatch, timeZone: string): boolean {
  if (match.titleRegex) {
    const re = compilePattern(match.titleRegex)
    if (!re || !re.test(event.title)) return false
  }
  if (match.descriptionRegex) {
    const re = compilePattern(match.descriptionRegex)
    if (!re || !(re.test(event.description) || re.test(event.location))) return false
  }
  if (match.allDay !== undefined && match.allDay !== event.allDay) return false
  if (match.recurring !== undefined && match.recurring !== event.recurring) return false
  if (hasValue(match.showAs) && !match.showAs.includes(event.showAs)) return false
  if (hasValue(match.status) && !match.status.includes(event.status)) return false
  if (hasValue(match.response) && !match.response.includes(event.response)) return false

  const needsDuration = match.minDurationMinutes != null || match.maxDurationMinutes != null
  if (needsDuration) {
    const minutes = (boundaryMs(event.end, timeZone) - boundaryMs(event.start, timeZone)) / 60_000
    if (match.minDurationMinutes != null && minutes < match.minDurationMinutes) return false
    if (match.maxDurationMinutes != null && minutes > match.maxDurationMinutes) return false
  }

  const after = parseClock(match.startsAtOrAfter)
  const before = parseClock(match.startsBefore)
  if (hasValue(match.weekdays) || after != null || before != null) {
    const parts = zonedParts(new Date(boundaryMs(event.start, timeZone)), timeZone)
    if (hasValue(match.weekdays) && !match.weekdays.includes(parts.weekday)) return false
    // Time-of-day conditions only make sense for timed events.
    if ((after != null || before != null) && event.allDay) return false
    const minuteOfDay = parts.hour * 60 + parts.minute
    if (after != null && minuteOfDay < after) return false
    if (before != null && minuteOfDay >= before) return false
  }
  return true
}

export function renderTitle(template: string, event: NormalizedEvent, source: SourceConfig): string {
  const rendered = template
    .replace(/\{project\}/gi, source.project || source.name)
    .replace(/\{source\}/gi, source.name)
    .replace(/\{title\}/gi, event.title)
    .trim()
  return rendered || 'Busy'
}

/**
 * Runs the ordered rule list against an event. The first matching `exclude`
 * rule stops evaluation; `setTitle` rules replace the title template and later
 * ones win.
 */
export function evaluateRules(event: NormalizedEvent, rules: Rule[], ctx: RuleContext): EventDecision {
  let template = ctx.titleTemplate
  const appliedRules: string[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.sourceIds.length > 0 && !rule.sourceIds.includes(event.sourceId)) continue
    if (!matchesRule(event, rule.match, ctx.timeZone)) continue
    if (rule.action.type === 'exclude') {
      return {
        event,
        included: false,
        title: renderTitle(template, event, ctx.source),
        excludedBy: { ruleId: rule.id, ruleName: rule.name },
        appliedRules,
      }
    }
    template = rule.action.title
    appliedRules.push(rule.name)
  }
  return { event, included: true, title: renderTitle(template, event, ctx.source), appliedRules }
}
