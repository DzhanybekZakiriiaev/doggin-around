import type { IncomingMessage, ServerResponse } from 'node:http'

const MINT = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'

export async function scribeToken(request: IncomingMessage, response: ServerResponse, apiKey = process.env.ELEVENLABS_API_KEY) {
  const reply = (status: number, body: unknown) => {
    response.statusCode = status
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', 'no-store')
    response.end(JSON.stringify(body))
  }
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST')
    return reply(405, { error: 'Use POST' })
  }
  if (!apiKey?.trim()) return reply(503, { error: 'Voice needs ELEVENLABS_API_KEY on the server. Add it to your environment and restart or redeploy.' })
  try {
    const minted = await fetch(MINT, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
    })
    const payload = await minted.json().catch(() => ({})) as { token?: unknown }
    if (!minted.ok || typeof payload.token !== 'string' || !payload.token) {
      const error = minted.status === 401 || minted.status === 403
        ? 'ElevenLabs rejected the server key. Check its Speech to Text permission.'
        : minted.status === 429 ? 'ElevenLabs is busy or the account limit was reached. Try again shortly.'
          : 'ElevenLabs could not start voice control. Try again shortly.'
      return reply(minted.status === 429 ? 429 : 502, { error })
    }
    reply(200, { token: payload.token })
  } catch {
    reply(502, { error: 'Could not reach ElevenLabs. Try again shortly.' })
  }
}
