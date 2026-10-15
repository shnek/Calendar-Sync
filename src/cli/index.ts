/**
 * Headless CLI around the core engine - handy for debugging feeds and rules.
 *
 *   npm run cli -- <command> [--config path] [--dry-run]
 *
 * Commands: init, auth, calendars, create-calendar <name>, preview, sync
 * The config file is plain JSON (unencrypted) - keep it out of git.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultConfig, normalizeConfig } from '../core/config'
import { authorizeInteractive, createAuthorizedClient, scopesFor } from '../core/google/auth'
import { GoogleCalendarApi, GoogleCalendarTarget } from '../core/targets/google'
import { buildPreview, effectiveTimeZone, runSync } from '../core/sync/runner'
import type { AppConfig, PreviewResult } from '../core/types'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--config'))
const command = positional[0] ?? 'help'
const configPath = resolve(option('config') ?? 'calendar-sync.config.json')

function load(): AppConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}. Run "npm run cli -- init" first.`)
  }
  return normalizeConfig(JSON.parse(readFileSync(configPath, 'utf8')))
}

function save(config: AppConfig): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

function credentials(config: AppConfig) {
  const clientId = config.google.clientId || process.env.GOOGLE_CLIENT_ID
  const clientSecret = config.google.clientSecret || process.env.GOOGLE_CLIENT_SECRET
  if (!clientId) throw new Error('Set google.clientId in the config (or GOOGLE_CLIENT_ID). See docs/SETUP.md.')
  return { clientId, clientSecret }
}

function googleClient(config: AppConfig) {
  if (!config.google.refreshToken) throw new Error('Not connected to Google. Run "npm run cli -- auth".')
  return createAuthorizedClient({
    ...credentials(config),
    refreshToken: config.google.refreshToken,
    onRefreshToken: (token) => save({ ...config, google: { ...config.google, refreshToken: token } }),
  })
}

function openBrowser(url: string): void {
  console.log(`\nOpen this URL to sign in (trying to open your browser):\n${url}\n`)
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' })
    .on('error', () => {})
    .unref()
}

function printPreview(preview: PreviewResult, timeZone: string): void {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  for (const s of preview.sources) {
    console.log(s.ok ? `OK   ${s.name}: ${s.eventCount} events, ${s.includedCount} to sync` : `FAIL ${s.name}: ${s.error}`)
  }
  console.log('')
  for (const d of preview.decisions) {
    const when = d.event.allDay ? `${d.event.start} (all day)` : fmt.format(new Date(d.event.start))
    const verdict = d.included ? `-> ${d.title}` : `   skipped by "${d.excludedBy?.ruleName}"`
    console.log(`${when.padEnd(26)} ${d.event.title.slice(0, 40).padEnd(40)} ${verdict}`)
  }
}

async function main(): Promise<void> {
  switch (command) {
    case 'init': {
      if (existsSync(configPath) && !flag('force')) throw new Error(`${configPath} already exists (use --force).`)
      const config = defaultConfig()
      config.sources.push({
        id: 'work-1',
        name: 'Work calendar',
        url: 'https://calendar.google.com/calendar/ical/.../basic.ics',
        project: 'ProjectName',
        enabled: true,
      })
      save(config)
      console.log(`Wrote ${configPath}. Add your ICS URLs and Google OAuth client, then run "auth".`)
      return
    }
    case 'auth': {
      const config = load()
      const result = await authorizeInteractive({
        ...credentials(config),
        scopes: scopesFor(config.google.scopeMode),
        openUrl: openBrowser,
      })
      save({ ...config, google: { ...config.google, refreshToken: result.refreshToken, accountEmail: result.email } })
      console.log(`Connected${result.email ? ` as ${result.email}` : ''}.`)
      return
    }
    case 'calendars': {
      const config = load()
      const calendars = await new GoogleCalendarApi(googleClient(config)).listCalendars()
      for (const c of calendars) console.log(`${c.id}  ${c.summary}${c.primary ? ' (primary)' : ''} [${c.accessRole}]`)
      return
    }
    case 'create-calendar': {
      const config = load()
      const name = positional[1] ?? 'Work'
      const cal = await new GoogleCalendarApi(googleClient(config)).createCalendar(name, effectiveTimeZone(config))
      save({ ...config, target: { ...config.target, calendarId: cal.id, calendarName: cal.summary } })
      console.log(`Created "${cal.summary}" (${cal.id}) and set it as the target.`)
      return
    }
    case 'preview': {
      const config = load()
      printPreview(await buildPreview(config, { log: console.warn }), effectiveTimeZone(config))
      return
    }
    case 'sync': {
      const config = load()
      if (!config.target.calendarId) throw new Error('No target calendar. Run "create-calendar" or set target.calendarId.')
      const target = new GoogleCalendarTarget(googleClient(config), config.target.calendarId)
      const report = await runSync(config, target, { dryRun: flag('dry-run'), log: console.log })
      if (flag('verbose')) printPreview(report, effectiveTimeZone(config))
      console.log(
        `${report.dryRun ? '[dry run] would create' : 'Created'} ${report.created}, updated ${report.updated}, deleted ${report.deleted}, unchanged ${report.unchanged}.`,
      )
      for (const e of report.errors) console.error(`Error: ${e}`)
      process.exitCode = report.errors.length ? 1 : 0
      return
    }
    default:
      console.log(`Usage: npm run cli -- <command> [--config file] [options]

  init                     Write a starter config file
  auth                     Connect a Google account (opens browser)
  calendars                List your Google calendars
  create-calendar [name]   Create a dedicated target calendar
  preview                  Show which events would sync and which rules skip them
  sync [--dry-run]         Sync now (--verbose prints every event)`)
  }
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`)
  process.exitCode = 1
})
