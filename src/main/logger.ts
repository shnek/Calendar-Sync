import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry } from '../shared/ipc'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_MEMORY_ENTRIES = 300

/** Small rotating file logger that also keeps recent entries for the Activity page. */
export class Logger {
  private readonly entries: LogEntry[] = []
  readonly file: string

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'calendar-sync.log')
  }

  info(message: string): void {
    this.log('info', message)
  }

  warn(message: string): void {
    this.log('warn', message)
  }

  error(message: string): void {
    this.log('error', message)
  }

  recent(): LogEntry[] {
    return [...this.entries].reverse()
  }

  private log(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { at: new Date().toISOString(), level, message }
    this.entries.push(entry)
    if (this.entries.length > MAX_MEMORY_ENTRIES) this.entries.shift()
    const line = `${entry.at} [${level}] ${message}\n`
    if (level === 'error') console.error(line.trimEnd())
    else console.log(line.trimEnd())
    try {
      if (existsSync(this.file) && statSync(this.file).size > MAX_FILE_BYTES) {
        renameSync(this.file, `${this.file}.1`)
      }
      appendFileSync(this.file, line, 'utf8')
    } catch {
      // Logging must never break syncing.
    }
  }
}
