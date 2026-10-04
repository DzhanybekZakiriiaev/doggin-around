import { type Connect, defineConfig, loadEnv, type Plugin } from "vite"

const ROUTE = "/api/scribe-token"
const MINT = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe"

/**
 * Mints the short-lived realtime token the browser connects with, so the
 * ElevenLabs API key stays on this machine. `loadEnv` reads it with an empty
 * prefix, which keeps it out of the client bundle: Vite only inlines variables
 * matching `envPrefix`, and `VITE_` is deliberately not used here.
 */
function scribeToken(apiKey: string): Plugin {
  const handler: Connect.NextHandleFunction = (request, response, next) => {
    if (!request.url?.startsWith(ROUTE)) {
      next()
      return
    }
    const reply = (status: number, body: unknown): void => {
      response.statusCode = status
      response.setHeader("content-type", "application/json")
      response.setHeader("cache-control", "no-store")
      response.end(JSON.stringify(body))
    }
    if (request.method !== "POST") {
      reply(405, { error: "Use POST" })
      return
    }
    if (!apiKey) {
      reply(503, {
        error: "Set ELEVENLABS_API_KEY in .env, then restart the dev server",
      })
      return
    }
    void fetch(MINT, { method: "POST", headers: { "xi-api-key": apiKey } })
      .then(async (minted) => {
        const payload = (await minted.json().catch(() => ({}))) as {
          token?: string
        }
        if (!minted.ok || !payload.token) {
          reply(minted.ok ? 502 : minted.status, {
            error: `ElevenLabs refused the token request (${minted.status})`,
          })
          return
        }
        reply(200, { token: payload.token })
      })
      .catch(() => {
        reply(502, { error: "Could not reach ElevenLabs" })
      })
  }
  return {
    name: "scribe-token",
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [scribeToken(loadEnv(mode, process.cwd(), "").ELEVENLABS_API_KEY)],
  build: {
    // Keep the audio worklet a real file. `addModule` would accept the inlined
    // data URL, but a served module is what every browser handles alike.
    assetsInlineLimit: (file: string) =>
      file.endsWith("pcm-worklet.js") ? false : undefined,
  },
}))
