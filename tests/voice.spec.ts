import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'

async function setup(page: Page) {
  await page.route('**/voice-test', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><script type="module">
      import { DogVoice } from '/src/game/voice.ts'
      window.commands = []
      window.micRequests = 0
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = (...args) => { window.micRequests++
        return capture(...args) }
      const voice = new DogVoice(document.body, {
        perform: action => { window.commands.push(action)
          return true },
        come: () => window.commands.push('come'), stop: () => window.commands.push('stop'),
        pet: () => true, fetch: () => true,
      })
      window.addEventListener('keydown', event => { if (event.code === 'KeyF' && !event.repeat) void voice.hold() })
      window.addEventListener('keyup', event => { if (event.code === 'KeyF') voice.release() })
      voice.connect()
    </script></body></html>` }))
}

async function token(page: Page) {
  await page.route('**/api/scribe-token', route => route.fulfill({ json: { token: 'test-token' } }))
}

const commands = (page: Page) => page.evaluate(() => (window as any).commands)
const phase = (page: Page) => page.locator('.voice-chip span')

test('missing credentials explain the failure without opening the microphone', async ({ page }) => {
  await setup(page)
  await page.route('**/api/scribe-token', route => route.fulfill({ status: 503, json: { error: 'Voice needs ELEVENLABS_API_KEY on the server.' } }))
  await page.goto('/voice-test')
  await expect(phase(page)).toHaveText('Voice is off')
  await page.keyboard.down('f')
  await expect(page.locator('.voice-bubble__note')).toContainText('ELEVENLABS_API_KEY')
  await page.keyboard.up('f')
  expect(await page.evaluate(() => (window as any).micRequests)).toBe(0)
})

test('a short spoken command flushes audio and fires once across partial and final text', async ({ page }) => {
  await setup(page)
  await token(page)
  const frames: any[] = []
  await page.routeWebSocket('**/speech-to-text/realtime?*', socket => {
    socket.send(JSON.stringify({ message_type: 'session_started' }))
    socket.onMessage(data => {
      const frame = JSON.parse(String(data))
      frames.push(frame)
      socket.send(JSON.stringify({ message_type: frame.commit ? 'committed_transcript' : 'partial_transcript', text: 'Biscuit, sit' }))
    })
  })
  await page.goto('/voice-test')
  await expect(phase(page)).toHaveText('Hold to talk')
  await page.keyboard.down('f')
  await expect(phase(page)).toHaveText('Listening…')
  await expect.poll(() => frames.length).toBeGreaterThan(0)
  await page.keyboard.up('f')
  await expect.poll(() => frames.some(frame => frame.commit)).toBe(true)
  expect(frames.reduce((sum, frame) => sum + Buffer.from(frame.audio_base_64, 'base64').length / 2, 0)).toBeGreaterThanOrEqual(32000)
  await expect.poll(() => commands(page)).toEqual(['sit'])
  await expect(page.locator('.voice-bubble__text')).toHaveText('Biscuit, sit')
})

test('waits for session readiness and reconnects after an idle close', async ({ page }) => {
  await setup(page)
  await token(page)
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket('**/speech-to-text/realtime?*', socket => { sockets.push(socket) })
  await page.goto('/voice-test')
  await expect.poll(() => sockets.length).toBe(1)
  await page.keyboard.down('f')
  await expect(phase(page)).toHaveText('Getting ready…')
  expect(await page.evaluate(() => (window as any).micRequests)).toBe(0)
  sockets[0].send(JSON.stringify({ message_type: 'session_started' }))
  await expect(phase(page)).toHaveText('Listening…')
  await page.keyboard.up('f')
  sockets[0].close()
  await expect(phase(page)).toHaveText('Hold to talk')
  await page.keyboard.down('f')
  await expect.poll(() => sockets.length).toBe(2)
  sockets[1].send(JSON.stringify({ message_type: 'session_started' }))
  await expect(phase(page)).toHaveText('Listening…')
  await page.keyboard.up('f')
})

test('a connection closed before ready can be retried instead of hanging', async ({ page }) => {
  await setup(page)
  await token(page)
  let attempts = 0
  await page.routeWebSocket('**/speech-to-text/realtime?*', socket => {
    if (++attempts === 1) socket.close()
    else socket.send(JSON.stringify({ message_type: 'session_started' }))
  })
  await page.goto('/voice-test')
  await expect(phase(page)).toHaveText('Voice is off')
  await page.keyboard.down('f')
  await expect(phase(page)).toHaveText('Listening…')
  await page.keyboard.up('f')
  expect(attempts).toBe(2)
})

test('holding F in the comic dispatches a transcript to the real dog animation', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await token(page)
  let committed = false
  await page.routeWebSocket('**/speech-to-text/realtime?*', socket => {
    socket.send(JSON.stringify({ message_type: 'session_started' }))
    socket.onMessage(data => {
      const frame = JSON.parse(String(data))
      if (frame.commit) committed = true
      socket.send(JSON.stringify({ message_type: frame.commit ? 'committed_transcript' : 'partial_transcript', text: 'Biscuit, sit' }))
    })
  })
  await page.goto('/')
  await page.locator('.intro-splash').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'BRING IT TO LIFE' }).click()
  await page.getByRole('button', { name: /SKIP/ }).click()
  await page.getByRole('button', { name: /Step into panel 1/ }).click()
  await page.locator('.game-layer--play').waitFor({ timeout: 60000 })
  await page.locator('.panel-portal').waitFor({ state: 'detached', timeout: 60000 })
  await page.evaluate(() => {
    const state = window as any
    const dog = state.game.biscuit
    const perform = dog.perform.bind(dog)
    state.spokenActions = []
    dog.perform = (action: string) => {
      const accepted = perform(action)
      state.spokenActions.push({ action, accepted, playing: dog.dog.action })
      return accepted
    }
  })
  await page.keyboard.down('f')
  await expect(phase(page)).toHaveText('Listening…')
  await expect.poll(() => page.evaluate(() => (window as any).spokenActions)).toEqual([{ action: 'sit', accepted: true, playing: 'sit' }])
  await page.keyboard.up('f')
  await expect.poll(() => committed).toBe(true)
  await expect(page.locator('.voice-bubble__text')).toHaveText('Biscuit, sit')
  expect(await page.evaluate(() => (window as any).spokenActions)).toHaveLength(1)
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/voice-sit.png' })
})
