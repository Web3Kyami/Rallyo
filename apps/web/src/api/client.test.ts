import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, request } from './client'

describe('web API client errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('turns a non-JSON route failure into a useful safe error', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html><body>Vercel</body></html>', {
          status: 405,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    )

    await expect(request('/api/app/me/nickname', { method: 'PATCH' })).rejects.toMatchObject({
      status: 405,
      code: 'API_ROUTE_UNAVAILABLE',
      message: 'Rallyo could not reach the Player profile service. Please try again later.',
    })
    expect(warning).toHaveBeenCalledWith('Rallyo API request failed', {
      path: '/api/app/me/nickname',
      method: 'PATCH',
      status: 405,
      contentType: 'text/html',
    })
  })

  it('preserves structured Rallyo API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'WALLET_AUTH_FAILED', message: 'Invalid signature.' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    await expect(request('/api/app/wallet/complete', { method: 'POST' })).rejects.toEqual(
      expect.objectContaining(
        new ApiError(400, { code: 'WALLET_AUTH_FAILED', message: 'Invalid signature.' }),
      ),
    )
  })

  it('reports a network failure without exposing fetch internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1:443')))

    await expect(request('/api/app/wallet/challenge')).rejects.toMatchObject({
      status: 503,
      code: 'API_UNAVAILABLE',
      message: 'Rallyo could not reach its service. Check your connection and try again.',
    })
  })
})
