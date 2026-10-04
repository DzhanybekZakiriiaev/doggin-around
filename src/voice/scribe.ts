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

/** Error message types that mean "say it again", not "something broke". */
const SOFT_ERRORS = new Set(["insufficient_audio_activity", "warning"])

export function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined
  )
}

/** Linear resample, used only when the browser refuses a 16 kHz context. */
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
  private worklet?: AudioWorkletNode
  private holding = false
  private committing = false
  private sentAudio = false
  private retries = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private disposed = false

  constructor(private readonly options: ScribeOptions = {}) {
    this.tokenUrl = options.tokenUrl ?? "/api/scribe-token"
    this.language = options.language ?? "en"
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

  /** Starts streaming microphone audio. Prompts for the mic on first use. */
  async hold(): Promise<void> {
    if (this.disposed || this.holding) return
    this.holding = true
    try {
      await Promise.all([this.connect(), this.listen()])
    } catch (error) {
      this.holding = false
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
    if (this.phase === "listening") this.announce("ready")
  }

  dispose(): void {
    this.disposed = true
    this.holding = false
    clearTimeout(this.retryTimer)
    this.worklet?.port.postMessage("stop")
    if (this.worklet) this.worklet.port.onmessage = null
    this.source?.disconnect()
    this.worklet?.disconnect()
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    void this.context?.close().catch(() => undefined)
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

  /** Builds the microphone graph once and keeps it for later holds. */
  private async listen(): Promise<void> {
    if (this.worklet) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    this.context = context
    await context.audioWorklet.addModule(workletUrl)
    if (this.disposed) return
    const worklet = new AudioWorkletNode(context, "push-to-talk", {
      numberOfOutputs: 0,
    })
    worklet.port.onmessage = this.onAudio
    this.source = context.createMediaStreamSource(this.stream)
    this.source.connect(worklet)
    this.worklet = worklet
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
