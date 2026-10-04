import workletUrl from "./pcm-worklet.js?url"

const ENDPOINT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"
const SAMPLE_RATE = 16000

export type ScribePhase =
  | "offline"
  | "connecting"
  | "ready"
  | "listening"
  | "error"

export type ScribeOptions = {
  /** Backend route that mints a single-use realtime token. */
  tokenUrl?: string
  language?: string
  /**
   * The AudioContext to build the microphone graph on. Pass the one the page already plays through:
   * browsers only allow a handful, and a second context at a different sample rate can take the output
   * device with it, which silences everything else. Without it a 16 kHz context of its own is made (and
   * closed again by `dispose`).
   */
  context?: () => AudioContext
  /** In-progress guess, replaced on every update while speaking. */
  onPartial?: (text: string) => void
  /** Final text for a segment, emitted after a commit. */
  onCommitted?: (text: string) => void
  /** The segment held no speech worth transcribing. */
  onMiss?: () => void
  /** Connection state. `detail` carries a sentence only for "error". */
  onPhase?: (phase: ScribePhase, detail?: string) => void
}

type Frame = {
  message_type: "input_audio_chunk"
  audio_base_64: string
  sample_rate: number
  commit?: true
}

/**
 * Make-up gain for the captured voice, in place of the browser's automatic gain (see `listen`). The model
 * turns out to be forgiving about level — a clean word still came back right at -29 dBFS — so this is
 * insurance for a microphone quieter than that, not a fix for anything measured; the limiter after it
 * keeps a raised voice from clipping as the frames are encoded.
 */
const MIC_GAIN = 3

/**
 * How long the microphone is kept after a hold, in seconds; 0 keeps it until the game hands it back
 * (`sleep`), which is what a machine set up for this wants.
 *
 * It is worth keeping: opening a capture device is slow enough to swallow the first word of a command,
 * which is what makes one have to be repeated. The one reason not to is Windows, which by default drops
 * everything else the page is playing by 80% for as long as any capture device is open — the game's rain
 * and effects with it. That is a machine setting and the page cannot opt out of it: Sound control panel
 * (mmsys.cpl) → Communications → "Do nothing" turns it off, and then holding the device costs nothing.
 *
 * On a machine where that can't be changed, set this to a few seconds instead: the game's sound then
 * comes back shortly after the talking stops, at the price of the next command reopening the device.
 */
const MIC_IDLE_SECONDS = 0

/** Error message types that mean "say it again", not "something broke". */
const SOFT_ERRORS = new Set(["insufficient_audio_activity", "warning"])

export function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined
  )
}

/** Linear resample down to 16 kHz, after the graph has band-limited the audio. */
function resample(audio: Float32Array, from: number): Float32Array {
  if (from === SAMPLE_RATE) return audio
  const ratio = from / SAMPLE_RATE
  const length = Math.floor(audio.length / ratio)
  const output = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, audio.length - 1)
    output[index] =
      audio[left] + (audio[right] - audio[left]) * (position - left)
  }
  return output
}

function encodePcm16(audio: Float32Array): string {
  const samples = new Int16Array(audio.length)
  for (let index = 0; index < audio.length; index++) {
    const sample = Math.max(-1, Math.min(1, audio[index]))
    samples[index] = Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff))
  }
  const bytes = new Uint8Array(samples.buffer)
  let binary = ""
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

/**
 * Push-to-talk transcription over ElevenLabs Scribe v2 Realtime.
 *
 * The socket opens once at load so a command never pays connection time, and
 * audio only flows between `hold()` and `release()`. Manual commits are used
 * instead of the model's voice activity detection: in a loud room, hands-free
 * segmentation would let a neighbouring conversation command the dog.
 *
 * Nothing touches a capture device until the first hold; after that it is kept,
 * so no command pays to open one again (MIC_IDLE_SECONDS), and `sleep()` gives
 * it back when the game is done with it.
 */
export class ScribeSession {
  phase: ScribePhase = "offline"

  private readonly tokenUrl: string
  private readonly language?: string
  private socket?: WebSocket
  private opening?: Promise<void>
  private context?: AudioContext
  private stream?: MediaStream
  private source?: MediaStreamAudioSourceNode
  /** What the microphone feeds: the head of the band-limit, gain and limiter chain. */
  private micIn?: AudioNode
  private worklet?: AudioWorkletNode
  private readonly ownsContext: boolean
  private micTimer?: ReturnType<typeof setTimeout>
  private holding = false
  private committing = false
  private sentAudio = false
  private retries = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private disposed = false

  constructor(private readonly options: ScribeOptions = {}) {
    this.tokenUrl = options.tokenUrl ?? "/api/scribe-token"
    this.language = options.language ?? "en"
    this.ownsContext = options.context === undefined
  }

  /** Opens the socket. Safe to call repeatedly; later calls share the work. */
  connect(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    this.opening ??= this.open()
      .catch((error: unknown) => {
        this.fail(message(error))
        throw error
      })
      .finally(() => {
        this.opening = undefined
      })
    return this.opening
  }

  /**
   * Compiles the audio worklet before the first hold, so no words are lost while it loads. The microphone
   * is deliberately left alone: it would ask the player for permission at whatever moment the game had
   * reached, and the answer is theirs to give when they first hold the key.
   */
  async warm(): Promise<void> {
    await this.graph()
  }

  /** Starts streaming microphone audio. Prompts for the mic on first use. */
  async hold(): Promise<void> {
    if (this.disposed || this.holding) return
    this.holding = true
    clearTimeout(this.micTimer)
    try {
      await Promise.all([this.connect(), this.listen()])
    } catch (error) {
      this.holding = false
      this.closeMic()
      this.fail(message(error))
      return
    }
    if (!this.holding || this.disposed) return
    await this.context?.resume()
    this.committing = true
    this.sentAudio = false
    this.worklet?.port.postMessage("start")
    this.announce("listening")
  }

  /** Stops streaming and commits the segment for a final transcript. */
  release(): void {
    if (!this.holding) return
    this.holding = false
    this.worklet?.port.postMessage("stop")
    if (MIC_IDLE_SECONDS > 0)
      this.micTimer = setTimeout(() => this.closeMic(), MIC_IDLE_SECONDS * 1000)
    if (this.phase === "listening") this.announce("ready")
  }

  /** Stops talking and hands the microphone back at once (leaving the game, say). */
  sleep(): void {
    this.release()
    this.closeMic()
  }

  dispose(): void {
    this.disposed = true
    this.holding = false
    clearTimeout(this.retryTimer)
    clearTimeout(this.micTimer)
    this.worklet?.port.postMessage("stop")
    if (this.worklet) this.worklet.port.onmessage = null
    this.closeMic()
    this.worklet?.disconnect()
    // Only a context of its own; a borrowed one belongs to the page and closing it would end its sound.
    if (this.ownsContext) void this.context?.close().catch(() => undefined)
    const socket = this.socket
    this.socket = undefined
    socket?.close()
  }

  private async open(): Promise<void> {
    this.announce("connecting")
    const response = await fetch(this.tokenUrl, { method: "POST" })
    const payload = (await response.json().catch(() => ({}))) as {
      token?: string
      error?: string
    }
    if (!response.ok || !payload.token)
      throw new Error(
        payload.error ?? `Token request failed (${response.status})`,
      )
    const query = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: `pcm_${SAMPLE_RATE}`,
      commit_strategy: "manual",
      keepalive_interval_ms: "5000",
      token: payload.token,
    })
    if (this.language) query.set("language_code", this.language)
    const socket = new WebSocket(`${ENDPOINT}?${query}`)
    this.socket = socket
    socket.addEventListener("message", this.onMessage)
    socket.addEventListener("close", this.onClose)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener(
        "error",
        () => reject(new Error("Could not reach ElevenLabs")),
        { once: true },
      )
    })
    if (this.disposed) {
      socket.close()
      return
    }
    this.retries = 0
    this.announce("ready")
  }

  /** The context and worklet, built once and kept; no capture device is involved. */
  private async graph(): Promise<AudioWorkletNode | undefined> {
    if (this.disposed) return undefined
    if (this.worklet) return this.worklet
    const context = (this.context ??=
      this.options.context?.() ?? new AudioContext({ sampleRate: SAMPLE_RATE }))
    await context.audioWorklet.addModule(workletUrl)
    if (this.disposed) return undefined
    // No outputs: nothing of this reaches the speakers, it only collects frames.
    const worklet = new AudioWorkletNode(context, "push-to-talk", {
      numberOfOutputs: 0,
    })
    worklet.port.onmessage = this.onAudio
    this.worklet = worklet
    this.micIn = this.captureChain(context, worklet)
    return worklet
  }

  /**
   * What the microphone goes through on its way to the worklet, standing in for the processing `listen`
   * turns off: a low-pass where the context runs faster than 16 kHz, so the decimation on the way out
   * can't fold anything above 8 kHz back into speech; then make-up gain, and a limiter to catch the
   * peaks that gain would otherwise clip. None of it reaches the speakers.
   */
  private captureChain(context: AudioContext, worklet: AudioWorkletNode): AudioNode {
    const chain: AudioNode[] = []
    if (context.sampleRate !== SAMPLE_RATE) {
      const band = context.createBiquadFilter()
      band.type = "lowpass"
      band.frequency.value = SAMPLE_RATE * 0.45
      chain.push(band)
    }
    const gain = context.createGain()
    gain.gain.value = MIC_GAIN
    chain.push(gain)
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.1
    chain.push(limiter)
    for (let link = 0; link < chain.length - 1; link++)
      chain[link].connect(chain[link + 1])
    chain[chain.length - 1].connect(worklet)
    return chain[0]
  }

  /**
   * Opens the microphone and feeds the capture chain; kept afterwards for the next hold.
   *
   * Every one of the browser's processors is off on purpose. Echo cancellation is the one that asks the
   * platform for a communications-grade device, and that is what makes Windows duck or mute everything
   * else the page is playing for as long as the microphone is open — the game's rain and effects with it.
   * All three also cost time: the processors are set up as the stream opens, which is most of the wait
   * before a hold goes live, and the automatic gain then starts cold, so the first words of a command
   * come through faint and have to be repeated. The level is made up in `captureChain` instead.
   *
   * What that gives up is the speakers bleeding into the microphone, which measurement says is
   * affordable: with noise mixed in, a bare "sit" is heard as "see ya" by 15 dB SNR, but "Biscuit, sit"
   * comes back right down to 0 dB. Hence the UI asking for his name, which the parser drops as a filler.
   */
  private async listen(): Promise<void> {
    const worklet = await this.graph()
    if (!worklet || this.source) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    if (this.disposed) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    this.stream = stream
    // Unplugged, or taken by something else: let it go, so the next hold opens a working one instead of
    // streaming silence out of a dead track.
    for (const track of stream.getTracks())
      track.addEventListener("ended", () => this.closeMic())
    this.source = this.context!.createMediaStreamSource(stream)
    this.source.connect(this.micIn ?? worklet)
  }

  /** Gives the capture device back — and the page its own sound (the chain stays wired up for next time). */
  private closeMic(): void {
    clearTimeout(this.micTimer)
    this.source?.disconnect()
    this.source = undefined
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = undefined
  }

  private readonly onAudio = (
    event: MessageEvent<{ audio: Float32Array; final: boolean }>,
  ): void => {
    let data = event.data
    if (!data.final && !this.holding) return
    if (data.final && !this.committing) return
    if (data.final) this.committing = false
    // A tap too short to fill a frame has nothing to commit. With audio
    // already in flight the segment still needs closing, so commit a sliver
    // of silence rather than an empty chunk the service would reject.
    if (data.final && data.audio.length === 0) {
      if (!this.sentAudio) {
        this.options.onMiss?.()
        return
      }
      data = { audio: new Float32Array(160), final: true }
    }
    if (data.audio.length === 0) return
    const rate = this.context?.sampleRate ?? SAMPLE_RATE
    const frame: Frame = {
      message_type: "input_audio_chunk",
      audio_base_64: encodePcm16(resample(data.audio, rate)),
      sample_rate: SAMPLE_RATE,
    }
    if (data.final) frame.commit = true
    this.sentAudio = true
    this.send(frame)
  }

  private send(frame: Frame): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(frame))
  }

  private readonly onMessage = ({ data }: MessageEvent): void => {
    if (typeof data !== "string") return
    let payload: { message_type?: string; text?: string; error?: string }
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    const type = payload.message_type
    if (type === "partial_transcript")
      this.options.onPartial?.(payload.text ?? "")
    else if (type?.startsWith("committed_transcript"))
      this.options.onCommitted?.(payload.text ?? "")
    else if (type === "warning" || type?.includes("error") || payload.error) {
      if (type && SOFT_ERRORS.has(type)) this.options.onMiss?.()
      else this.fail(payload.error ?? type ?? "Transcription failed")
    }
  }

  private readonly onClose = (): void => {
    if (this.disposed) return
    this.holding = false
    this.socket = undefined
    this.announce("offline")
    // Tokens are single use and sessions have a time limit, so a reopen mints
    // a fresh one. Backing off keeps a dead backend from spinning.
    const delay = Math.min(8000, 400 * 2 ** this.retries++)
    this.retryTimer = setTimeout(() => {
      void this.connect().catch(() => undefined)
    }, delay)
  }

  private fail(detail: string): void {
    this.announce("error", detail)
  }

  private announce(phase: ScribePhase, detail?: string): void {
    this.phase = phase
    this.options.onPhase?.(phase, detail)
  }
}

function message(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "Microphone blocked. Allow it in your browser, then try again"
  return error instanceof Error ? error.message : "Voice control is unavailable"
}
