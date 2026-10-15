import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { normalizeConfig } from '../core/config'
import type { AppConfig } from '../core/types'

const PREFIX = 'enc:v1:'

/**
 * Persists the config as JSON in the user data folder. Secrets (feed URLs,
 * Google client secret and refresh token) are encrypted with the OS keychain
 * via Electron safeStorage (DPAPI on Windows, Keychain on macOS).
 */
export class ConfigStore {
  private config: AppConfig

  constructor(private readonly file: string) {
    this.config = this.read()
  }

  get(): AppConfig {
    return structuredClone(this.config)
  }

  update(mutate: (config: AppConfig) => AppConfig | void): AppConfig {
    const draft = this.get()
    const next = normalizeConfig(mutate(draft) ?? draft)
    this.config = next
    this.write(next)
    return this.get()
  }

  private encrypt(value: string | undefined): string | undefined {
    if (!value) return value
    if (!safeStorage.isEncryptionAvailable()) return value
    return PREFIX + safeStorage.encryptString(value).toString('base64')
  }

  private decrypt(value: string | undefined): string | undefined {
    if (!value || !value.startsWith(PREFIX)) return value
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'))
    } catch {
      // Keychain changed (e.g. config copied from another machine) - secret must be re-entered.
      return undefined
    }
  }

  private read(): AppConfig {
    if (!existsSync(this.file)) return normalizeConfig(undefined)
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as AppConfig
      const config = normalizeConfig(raw)
      config.sources = config.sources.map((s) => ({ ...s, url: this.decrypt(s.url) ?? '' }))
      config.google.clientSecret = this.decrypt(config.google.clientSecret)
      config.google.refreshToken = this.decrypt(config.google.refreshToken)
      return config
    } catch {
      // Corrupt file: keep a copy for inspection and start fresh.
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return normalizeConfig(undefined)
    }
  }

  private write(config: AppConfig): void {
    const onDisk: AppConfig = structuredClone(config)
    onDisk.sources = onDisk.sources.map((s) => ({ ...s, url: this.encrypt(s.url) ?? '' }))
    onDisk.google.clientSecret = this.encrypt(onDisk.google.clientSecret)
    onDisk.google.refreshToken = this.encrypt(onDisk.google.refreshToken)
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(onDisk, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.file)
  }
}
