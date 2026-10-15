import { randomBytes } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import type { GoogleScopeMode } from '../types'

const CALENDAR_APP_CREATED = 'https://www.googleapis.com/auth/calendar.app.created'
const CALENDAR_LIST_READONLY = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
const CALENDAR_FULL = 'https://www.googleapis.com/auth/calendar'

/**
 * `app-created` (default) lets the app manage only calendars it created itself;
 * `full` allows writing into any existing calendar.
 */
export function scopesFor(mode: GoogleScopeMode): string[] {
  const base = ['openid', 'email']
  return mode === 'full' ? [...base, CALENDAR_FULL] : [...base, CALENDAR_APP_CREATED, CALENDAR_LIST_READONLY]
}

export const MISSING_SCOPES_MESSAGE =
  'Calendar Sync was not given permission to manage your calendars. Connect again and tick every checkbox on the Google permission screen.'

/**
 * Returns the requested calendar scopes that Google did not grant. `granted` is
 * the space-separated `scope` from the token response; when Google omits it we
 * cannot tell, so nothing is reported missing.
 */
export function missingScopes(granted: string | undefined | null, requested: string[]): string[] {
  if (!granted) return []
  const have = new Set(granted.split(/\s+/))
  return requested.filter((s) => s.startsWith('https://www.googleapis.com/auth/calendar') && !have.has(s))
}

export interface GoogleClientCredentials {
  clientId: string
  clientSecret?: string
}

export interface AuthorizeOptions extends GoogleClientCredentials {
  scopes: string[]
  /** Opens the consent URL in the user's browser. */
  openUrl: (url: string) => void | Promise<void>
  timeoutMs?: number
  signal?: AbortSignal
}

export interface AuthorizeResult {
  refreshToken: string
  email?: string
}

const SUCCESS_PAGE = `<!doctype html><meta charset="utf-8"><title>Calendar Sync</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>Calendar Sync is connected</h2><p>You can close this tab and return to the app.</p></div>`

const failurePage = (message: string) => `<!doctype html><meta charset="utf-8"><title>Calendar Sync</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2>Sign-in failed</h2><p>${message.replace(/[<>&"]/g, '')}</p></div>`

/**
 * Runs the OAuth "installed app" flow: a temporary loopback HTTP server receives
 * the redirect, and PKCE protects the authorization code.
 */
export async function authorizeInteractive(options: AuthorizeOptions): Promise<AuthorizeResult> {
  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${port}`
  const client = new OAuth2Client({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri,
  })

  try {
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const state = randomBytes(16).toString('hex')
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: options.scopes,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge,
      state,
    })

    // The browser response is held until the token is verified, so the page
    // shows the real outcome.
    const { code, respond } = await new Promise<{ code: string; respond: (html: string) => void }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Google sign-in')), options.timeoutMs ?? 5 * 60_000)
      options.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('Sign-in cancelled'))
      })
      server.on('request', (req, res) => {
        const reqUrl = new URL(req.url ?? '/', redirectUri)
        if (reqUrl.pathname !== '/') {
          res.writeHead(404).end()
          return
        }
        const error = reqUrl.searchParams.get('error')
        const returnedCode = reqUrl.searchParams.get('code')
        if (reqUrl.searchParams.get('state') !== state || (!error && !returnedCode)) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(failurePage('Unexpected response.'))
          return
        }
        clearTimeout(timer)
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(failurePage(error))
          reject(new Error(error === 'access_denied' ? 'Google sign-in was cancelled' : `Google sign-in failed: ${error}`))
          return
        }
        resolve({ code: returnedCode!, respond: (html) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(html) })
      })
      Promise.resolve(options.openUrl(url)).catch(reject)
    })

    try {
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri })
      if (!tokens.refresh_token) {
        throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and try again.')
      }
      const missing = missingScopes(tokens.scope, options.scopes)
      if (missing.length) {
        // Google's consent screen lets users untick individual permissions;
        // without them every calendar call fails with "insufficient scopes".
        await revokeRefreshToken(options, tokens.refresh_token)
        throw new Error(MISSING_SCOPES_MESSAGE)
      }
      let email: string | undefined
      try {
        if (tokens.access_token) email = (await client.getTokenInfo(tokens.access_token)).email
      } catch {
        // Email is only cosmetic.
      }
      respond(SUCCESS_PAGE)
      return { refreshToken: tokens.refresh_token, email }
    } catch (err) {
      respond(failurePage((err as Error).message))
      throw err
    }
  } finally {
    server.closeAllConnections?.()
    server.close()
  }
}

export interface AuthorizedClientOptions extends GoogleClientCredentials {
  refreshToken: string
  /** Called when Google rotates the refresh token. */
  onRefreshToken?: (token: string) => void
}

export function createAuthorizedClient(options: AuthorizedClientOptions): OAuth2Client {
  const client = new OAuth2Client({ clientId: options.clientId, clientSecret: options.clientSecret })
  client.setCredentials({ refresh_token: options.refreshToken })
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token && tokens.refresh_token !== options.refreshToken) {
      options.onRefreshToken?.(tokens.refresh_token)
    }
  })
  return client
}

export async function revokeRefreshToken(credentials: GoogleClientCredentials, refreshToken: string): Promise<void> {
  const client = new OAuth2Client({ clientId: credentials.clientId, clientSecret: credentials.clientSecret })
  try {
    await client.revokeToken(refreshToken)
  } catch {
    // Already revoked or offline - the local token is discarded either way.
  }
}
