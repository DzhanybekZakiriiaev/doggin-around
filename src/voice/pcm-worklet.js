// Collects microphone audio into roughly 100 ms frames while push-to-talk is
// held. Nothing crosses to the main thread between holds, so a released key
// means no audio leaves this processor. Posting "start" or "stop" on the port
// opens and closes a hold; the frame flushed by "stop" is marked final so the
// session can commit the segment with it.
const FRAME = Math.round(sampleRate / 10)

class PushToTalkProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Float32Array(FRAME)
    this.filled = 0
    this.active = false
    this.port.onmessage = ({ data }) => {
      if (data === "start") {
        this.filled = 0
        this.active = true
      } else if (data === "stop" && this.active) {
        this.active = false
        this.flush(true)
      }
    }
  }

  flush(final) {
    if (!final && this.filled === 0) return
    const audio = this.frame.slice(0, this.filled)
    this.filled = 0
    this.port.postMessage({ audio, final }, [audio.buffer])
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!this.active || !channel) return true
    for (const sample of channel) {
      this.frame[this.filled++] = sample
      if (this.filled === FRAME) this.flush(false)
    }
    return true
  }
}

registerProcessor("push-to-talk", PushToTalkProcessor)
