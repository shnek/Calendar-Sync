import { describe, expect, it } from 'vitest'
import { feedIdentity, planSync } from '../src/core/sync/planner'
import { buildPreview, runSync } from '../src/core/sync/runner'
import { MemoryTarget } from '../src/core/targets/memory'
import type { DesiredEvent } from '../src/core/targets/target'
import { GOOGLE_SOURCE, NOW, OUTLOOK_SOURCE, fakeFetch, fixture, testConfig } from './helpers'

const routes = () => ({ 'calendar.google.com': fixture('google.ics'), 'outlook.office365.com': fixture('outlook.ics') })

describe('runSync', () => {
  it('creates detail-free events, then is idempotent', async () => {
    const target = new MemoryTarget()
    const config = testConfig()
    const first = await runSync(config, target, { now: NOW, fetchImpl: fakeFetch(routes()) })
    expect(first.errors).toEqual([])
    expect(first.created).toBeGreaterThan(0)
    expect(target.events.size).toBe(first.created)

    const titles = new Set([...target.events.values()].map((e) => e.title))
    expect(titles).toEqual(new Set(['Work - Acme', 'Work - Globex']))

    const second = await runSync(config, target, { now: NOW, fetchImpl: fakeFetch(routes()) })
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0, unchanged: first.created })
  })

  it('excludes events according to default rules', async () => {
    const preview = await buildPreview(testConfig(), { now: NOW, fetchImpl: fakeFetch(routes()) })
    const excluded = preview.decisions.filter((d) => !d.included).map((d) => d.event.title)
    expect(excluded).toEqual(expect.arrayContaining(['Lunch', 'Optional sync', 'Lunch break', 'Canceled: Architecture review']))
    const included = preview.decisions.filter((d) => d.included).map((d) => d.event.title)
    expect(included).toContain('Focus time')
    expect(included).toContain('Maybe review')
  })

  it('updates changed events and deletes removed ones', async () => {
    const target = new MemoryTarget()
    const config = testConfig()
    await runSync(config, target, { now: NOW, fetchImpl: fakeFetch(routes()) })

    const changed = fixture('google.ics')
      .replace('DTSTART:20261014T150000Z', 'DTSTART:20261014T170000Z')
      .replace('DTEND:20261014T160000Z', 'DTEND:20261014T180000Z')
      .replace(/BEGIN:VEVENT\r?\nDTSTART;TZID=America\/New_York:20261016T130000[\s\S]*?END:VEVENT\r?\n/, '')
    const report = await runSync(config, target, {
      now: NOW,
      fetchImpl: fakeFetch({ ...routes(), 'calendar.google.com': changed }),
    })
    expect(report).toMatchObject({ created: 0, updated: 1, deleted: 1 })
  })

  it('never deletes events of a source that failed to download', async () => {
    const target = new MemoryTarget()
    const config = testConfig()
    await runSync(config, target, { now: NOW, fetchImpl: fakeFetch(routes()) })
    const before = target.events.size

    const report = await runSync(config, target, {
      now: NOW,
      fetchImpl: fakeFetch({ ...routes(), 'calendar.google.com': 500 }),
    })
    expect(report.deleted).toBe(0)
    expect(report.errors[0]).toMatch(/Acme Google: Feed returned HTTP 500/)
    expect(target.events.size).toBe(before)
  })

  it('removes events of sources that were disabled or deleted', async () => {
    const target = new MemoryTarget()
    await runSync(testConfig(), target, { now: NOW, fetchImpl: fakeFetch(routes()) })
    const outlookCount = [...target.events.values()].filter((e) => e.sourceId === feedIdentity(OUTLOOK_SOURCE.url)).length

    const config = testConfig({ sources: [GOOGLE_SOURCE, { ...OUTLOOK_SOURCE, enabled: false }] })
    const report = await runSync(config, target, { now: NOW, fetchImpl: fakeFetch(routes()) })
    expect(report.deleted).toBe(outlookCount)
    expect([...target.events.values()].every((e) => e.sourceId === feedIdentity(GOOGLE_SOURCE.url))).toBe(true)
  })

  it('two machines with the same feeds share events instead of replacing each other', async () => {
    const target = new MemoryTarget()
    const first = await runSync(testConfig(), target, { now: NOW, fetchImpl: fakeFetch(routes()) })

    // A second install: same feed URLs, but its own random source ids.
    const other = testConfig({
      sources: [
        { ...GOOGLE_SOURCE, id: 'mac-google' },
        { ...OUTLOOK_SOURCE, id: 'mac-outlook', url: OUTLOOK_SOURCE.url.replace('webcal://', 'https://') },
      ],
    })
    const second = await runSync(other, target, { now: NOW, fetchImpl: fakeFetch(routes()) })
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0, unchanged: first.created })
  })

  it('dry run computes the plan without writing', async () => {
    const target = new MemoryTarget()
    const report = await runSync(testConfig(), target, { now: NOW, fetchImpl: fakeFetch(routes()), dryRun: true })
    expect(report.created).toBeGreaterThan(0)
    expect(target.calls).toEqual({ create: 0, update: 0, delete: 0 })
  })
})

describe('planSync', () => {
  const ev = (key: string, hash = 'h', sourceId = 's1'): DesiredEvent => ({
    key,
    sourceId,
    hash,
    title: 'Work',
    allDay: false,
    start: '2026-10-14T14:00:00.000Z',
    end: '2026-10-14T15:00:00.000Z',
  })

  it('removes duplicates that share a key', () => {
    const plan = planSync({
      desired: [ev('a')],
      existing: [
        { id: '1', key: 'a', sourceId: 's1', hash: 'h' },
        { id: '2', key: 'a', sourceId: 's1', hash: 'h' },
      ],
      syncedSourceIds: new Set(['s1']),
      activeSourceIds: new Set(['s1']),
    })
    expect(plan.unchanged).toBe(1)
    expect(plan.delete.map((d) => d.id)).toEqual(['2'])
  })
})
