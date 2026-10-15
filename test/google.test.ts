import { describe, expect, it } from 'vitest'
import { missingScopes, scopesFor } from '../src/core/google/auth'
import { describeGoogleError } from '../src/core/targets/google'

describe('missingScopes', () => {
  const requested = scopesFor('app-created')

  it('reports calendar scopes the user unticked on the consent screen', () => {
    const granted = 'openid https://www.googleapis.com/auth/userinfo.email'
    expect(missingScopes(granted, requested)).toEqual([
      'https://www.googleapis.com/auth/calendar.app.created',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ])
  })

  it('accepts a full grant and unknown grants', () => {
    expect(missingScopes(requested.join(' '), requested)).toEqual([])
    expect(missingScopes(undefined, requested)).toEqual([])
  })
})

describe('describeGoogleError', () => {
  it('turns insufficient-scope 403s into reconnect instructions', () => {
    const err = {
      response: {
        status: 403,
        data: {
          error: { message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] },
        },
      },
    }
    expect(describeGoogleError(err)).toMatch(/connect again, and tick every checkbox/)
  })
})
