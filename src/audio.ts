/** One context for every sound in the game; browsers only allow a handful. */
let shared: AudioContext | undefined;
export const audioContext = () => (shared ??= new AudioContext());

/** Fetches a clip and decodes it to samples. */
async function decode(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return audioContext().decodeAudioData(await response.arrayBuffer());
}

/** ~-50 dBFS. Below this it's MP3 encoder padding, not rain. */
const SILENCE = 0.003;

/** The first and last sample of the decoded buffer that carry real signal. */
function trimSilence(buffer: AudioBuffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const quiet = (frame: number) => channels.every((data) => Math.abs(data[frame]) <= SILENCE);
  let start = 0;
  let end = buffer.length;
  while (start < end && quiet(start)) start++;
  while (end > start && quiet(end - 1)) end--;
  return { start, end };
}

/**
 * Rebuilds a decoded clip so it loops without a seam.
 *
 * MP3 only encodes whole 1152-sample frames, so the encoder pads the head (decoder delay) and the
 * tail (out to a frame boundary) with silence. The LAME tag says how much to strip, and clips
 * without one — like rain.mp3 — decode with that padding included, which is the gap you hear at the
 * wrap. So: cut the near-silent ends, then mix the tail back over the head with an equal-power
 * crossfade. The wrap then lands mid-blend rather than on a discontinuity, which also covers any
 * fade baked into the recording itself.
 */
function seamlessLoop(ctx: BaseAudioContext, clip: AudioBuffer, fadeSeconds: number) {
  const { start, end } = trimSilence(clip);
  const trimmed = end - start;
  const fade = Math.min(Math.round(fadeSeconds * clip.sampleRate), Math.floor(trimmed / 2));
  const length = trimmed - fade;
  const loop = ctx.createBuffer(clip.numberOfChannels, length, clip.sampleRate);
  for (let channel = 0; channel < clip.numberOfChannels; channel++) {
    const from = clip.getChannelData(channel);
    const into = loop.getChannelData(channel);
    into.set(from.subarray(start, start + length));
    // sin/cos rather than a linear ramp: rain is noise, and crossfading noise linearly dips ~3 dB.
    for (let i = 0; i < fade; i++) {
      const turn = (i / fade) * (Math.PI / 2);
      into[i] = into[i] * Math.sin(turn) + from[start + length + i] * Math.cos(turn);
    }
  }
  return loop;
}

/** Moves an audio parameter to a new value over `seconds`, replacing any ramp already running. */
function ramp(param: AudioParam, to: number, seconds: number, curve: 'linear' | 'exponential' = 'linear') {
  const ctx = audioContext();
  const now = ctx.currentTime;
  // cancelAndHoldAtTime pins a ramp already in flight at where it has got to; cancelScheduledValues
  // alone can snap the value back to the last anchor instead.
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else param.cancelScheduledValues(now);
  // A suspended context's clock is stopped, so a ramp scheduled on it would never arrive.
  if (ctx.state !== 'running' || seconds <= 0) {
    param.value = to;
    return;
  }
  param.setValueAtTime(param.value, now);
  if (curve === 'exponential' && to > 0 && param.value > 0) param.exponentialRampToValueAtTime(to, now + seconds);
  else param.linearRampToValueAtTime(to, now + seconds);
}

const OPEN_AIR = 18000; // lowpass cutoff out in the open: high enough to be no filter at all
const THROUGH_WALL = 900; // ...and with a wall in the way
const THROUGH_WALL_LEVEL = 0.95; // how much of the volume survives that wall

/**
 * A sound that runs for as long as the game is open (rain, room tone), looping seamlessly.
 *
 * Browsers start the audio context suspended and only let a user gesture resume it, so `start()`
 * keeps the sound pending and picks it up on the first click or keypress — usually the "Click to
 * walk" overlay.
 */
export class LoopingSound {
  /** Rejects if the clip can't be fetched or decoded. */
  readonly ready: Promise<void>;
  private readonly gain: GainNode;
  private readonly wall: GainNode;
  private readonly filter: BiquadFilterNode;
  private buffer?: AudioBuffer;
  private source?: AudioBufferSourceNode;
  private wanted = false;
  private gesture?: AbortController;

  constructor(url: string, volume = 1, fadeSeconds = 0.25) {
    const ctx = audioContext();
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.wall = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = Math.SQRT1_2; // Butterworth: flat to the corner, no resonant bump at it
    this.filter.frequency.value = OPEN_AIR;
    this.filter.connect(this.wall).connect(this.gain).connect(ctx.destination);
    this.ready = this.load(url, fadeSeconds);
  }

  get volume() {
    return this.gain.gain.value;
  }

  set volume(level: number) {
    this.gain.gain.value = Math.min(Math.max(level, 0), 1);
  }

  /**
   * How much the sound is coming through a wall: 0 out in the open, 1 indoors with it outside.
   *
   * Walls soak up the high frequencies far more than the low, so this leans on a lowpass rather than
   * the volume alone — the rain loses its hiss, keeps its rumble, and reads as being out there
   * rather than just turned down. Eased over `seconds` so a doorway doesn't snap between the two.
   */
  muffle(amount: number, seconds = 0.6) {
    const shut = Math.min(Math.max(amount, 0), 1);
    ramp(this.filter.frequency, OPEN_AIR * (THROUGH_WALL / OPEN_AIR) ** shut, seconds, 'exponential');
    ramp(this.wall.gain, 1 - (1 - THROUGH_WALL_LEVEL) * shut, seconds);
  }

  start() {
    this.wanted = true;
    this.play();
  }

  stop() {
    this.wanted = false;
    this.gesture?.abort();
    this.gesture = undefined;
    this.source?.stop();
    this.source = undefined;
  }

  private async load(url: string, fadeSeconds: number) {
    this.buffer = seamlessLoop(audioContext(), await decode(url), fadeSeconds);
    this.play(); // start() may have been called while this was downloading
  }

  private play() {
    if (!this.wanted || !this.buffer || this.source) return;
    const ctx = audioContext();
    if (ctx.state !== 'running') {
      void ctx.resume().then(() => this.play(), () => {});
      this.waitForGesture();
      return;
    }
    this.gesture?.abort();
    this.gesture = undefined;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true; // sample-accurate, so the only possible seam is one baked into the buffer
    source.connect(this.filter);
    source.start();
    this.source = source;
  }

  private waitForGesture() {
    if (this.gesture || !this.wanted) return;
    const pending = (this.gesture = new AbortController());
    const retry = () => {
      this.gesture = undefined;
      pending.abort(); // drops whichever of the two listeners didn't fire
      this.play();
    };
    for (const event of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(event, retry, { once: true, signal: pending.signal });
    }
  }
}

/** A sound played start to finish on cue: a door creak, a bark. */
export class OneShot {
  /** Rejects if the clip can't be fetched or decoded. */
  readonly ready: Promise<void>;
  private clip?: AudioBuffer;
  private readonly gain: GainNode;

  constructor(url: string, volume = 1) {
    const ctx = audioContext();
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(ctx.destination);
    this.ready = decode(url).then((clip) => void (this.clip = clip));
  }

  get volume() {
    return this.gain.gain.value;
  }

  set volume(level: number) {
    this.gain.gain.value = Math.min(Math.max(level, 0), 1);
  }

  /** Plays it from the top. Overlapping calls layer rather than cut one another off. */
  play() {
    const ctx = audioContext();
    if (!this.clip || ctx.state !== 'running') return;
    const source = ctx.createBufferSource();
    source.buffer = this.clip;
    source.connect(this.gain);
    source.start();
  }
}

// ---------- Footsteps ----------

/**
 * Where the individual footfalls start in a recording of somebody walking, as sample offsets.
 *
 * Tracks a short-window RMS envelope and picks its peaks: a footfall is a transient, so it stands
 * well clear of the room tone between steps. Each peak is then walked back down its own attack so
 * the slice opens just before the transient instead of halfway through it.
 */
function findOnsets(clip: AudioBuffer) {
  const rate = clip.sampleRate;
  const hop = Math.max(1, Math.round(0.005 * rate));
  const window = Math.max(hop, Math.round(0.01 * rate));
  const channels = Array.from({ length: clip.numberOfChannels }, (_, i) => clip.getChannelData(i));
  const frames = Math.floor((clip.length - window) / hop) + 1;
  if (frames <= 0) return [];

  const energy = new Float32Array(frames);
  let loudest = 0;
  for (let frame = 0; frame < frames; frame++) {
    const at = frame * hop;
    let sum = 0;
    for (let i = 0; i < window; i++) {
      let mono = 0;
      for (const data of channels) mono += data[at + i];
      mono /= channels.length;
      sum += mono * mono;
    }
    energy[frame] = Math.sqrt(sum / window);
    loudest = Math.max(loudest, energy[frame]);
  }
  if (loudest <= 0) return [];

  const floor = 0.08 * loudest; // room tone between steps
  const trigger = 0.25 * loudest; // a real footfall
  const refractory = Math.round(0.15 / 0.005); // frames; two footfalls never land closer than this
  const onsets: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    if (energy[frame] < trigger) continue;
    const from = Math.max(0, frame - refractory);
    const until = Math.min(frames - 1, frame + refractory);
    let peak = true;
    for (let k = from; k <= until && peak; k++) if (energy[k] > energy[frame]) peak = false;
    if (!peak) continue;
    // Back down the attack to where it began, then a hair earlier so the transient stays intact.
    let begin = frame;
    while (begin > 0 && energy[begin - 1] > floor && energy[begin - 1] < energy[begin]) begin--;
    const at = Math.max(0, begin * hop - Math.round(0.004 * rate));
    if (!onsets.length || at - onsets[onsets.length - 1] > 0.1 * rate) onsets.push(at);
    frame += refractory; // this footfall's decay isn't another step
  }
  return onsets;
}

/** Cuts a walking recording into one buffer per footfall, levelled and faded so none of them click. */
function sliceSteps(ctx: BaseAudioContext, clip: AudioBuffer) {
  const rate = clip.sampleRate;
  const onsets = findOnsets(clip);
  const shortest = Math.round(0.08 * rate);
  const longest = Math.round(0.5 * rate);
  const fadeIn = Math.round(0.002 * rate);

  // One scalar for the whole recording: evens out wet against wood (different takes, different
  // levels) without flattening the variation between steps within a take.
  let peak = 0;
  for (let channel = 0; channel < clip.numberOfChannels; channel++) {
    const data = clip.getChannelData(channel);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  const level = peak > 0 ? 0.9 / peak : 1;

  const steps: AudioBuffer[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const begin = onsets[i];
    const until = Math.min(onsets[i + 1] ?? clip.length, begin + longest, clip.length);
    const length = until - begin;
    if (length < shortest) continue;
    const fadeOut = Math.min(Math.round(0.03 * rate), Math.floor(length / 3));
    const step = ctx.createBuffer(clip.numberOfChannels, length, rate);
    for (let channel = 0; channel < clip.numberOfChannels; channel++) {
      const source = clip.getChannelData(channel);
      const into = step.getChannelData(channel);
      for (let n = 0; n < length; n++) {
        const tail = length - n;
        let gain = level;
        if (n < fadeIn) gain *= n / fadeIn;
        if (tail < fadeOut) gain *= tail / fadeOut;
        into[n] = source[begin + n] * gain;
      }
    }
    steps.push(step);
  }
  return steps;
}

/** One surface's footfalls, played a step at a time. */
export class StepSet {
  readonly ready: Promise<void>;
  private steps: AudioBuffer[] = [];
  private bag: number[] = [];
  private last = -1;
  private readonly gain: GainNode;

  constructor(url: string, volume = 1) {
    const ctx = audioContext();
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(ctx.destination);
    this.ready = this.load(url);
  }

  /** How many footfalls came out of the recording. */
  get count() {
    return this.steps.length;
  }

  get volume() {
    return this.gain.gain.value;
  }

  set volume(level: number) {
    this.gain.gain.value = Math.min(Math.max(level, 0), 1);
  }

  private async load(url: string) {
    const clip = await decode(url);
    this.steps = sliceSteps(audioContext(), clip);
    if (!this.steps.length) this.steps = [clip]; // nothing detected: better the whole clip than silence
  }

  /** One footfall. Cycles a shuffled bag so the same sample never lands twice in a row. */
  play() {
    const ctx = audioContext();
    if (!this.steps.length || ctx.state !== 'running') return;
    if (!this.bag.length) {
      this.bag = this.steps.map((_, i) => i);
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      const end = this.bag.length - 1;
      if (end > 0 && this.bag[end] === this.last) [this.bag[0], this.bag[end]] = [this.bag[end], this.bag[0]];
    }
    this.last = this.bag.pop()!;
    const source = ctx.createBufferSource();
    source.buffer = this.steps[this.last];
    source.playbackRate.value = 0.96 + Math.random() * 0.08; // so repeats don't ring identically
    const voice = ctx.createGain();
    voice.gain.value = 0.85 + Math.random() * 0.3;
    source.connect(voice).connect(this.gain);
    source.start();
  }
}

/**
 * Footfalls under the player, on whichever surface they're standing on.
 *
 * The cadence comes from distance travelled rather than from the recordings, so every surface steps
 * at the same rate however many footfalls its clip happened to contain, and that rate follows the
 * walking speed (a run is naturally quicker than a walk).
 */
export class Footsteps<Surface extends string> {
  /** Which surface is underfoot; set it when the player changes world. */
  surface: Surface;
  /**
   * Metres between footfalls: `stride` plus `strideGain` per m/s. A faster gait reaches further per
   * step, so without the speed term a run would patter rather than pound. These two give roughly
   * 2.0 steps/s at the 2.5 m/s walk and 3.0 steps/s at the 5 m/s run.
   */
  stride = 0.8;
  strideGain = 0.17;
  readonly ready: Promise<void>;
  readonly sets: Record<Surface, StepSet>;
  private travelled = 0;
  private armed = true;

  // NoInfer: the surface names come from `urls`, not from whichever one is named as the starting surface.
  constructor(urls: Record<Surface, string>, surface: NoInfer<Surface>, volume = 1) {
    this.surface = surface;
    this.sets = Object.fromEntries(
      Object.entries(urls).map(([key, url]) => [key, new StepSet(url as string, volume)]),
    ) as Record<Surface, StepSet>;
    this.ready = Promise.all(Object.values<StepSet>(this.sets).map((set) => set.ready)).then(() => {});
  }

  set volume(level: number) {
    for (const set of Object.values<StepSet>(this.sets)) set.volume = level;
  }

  update(dt: number, motion: { speed: number; grounded: boolean }) {
    if (!motion.grounded || motion.speed < 0.2) {
      this.travelled = 0;
      this.armed = true; // standing still or mid-air; moving off puts a foot down straight away
      return;
    }
    this.travelled += motion.speed * dt;
    if (this.armed) {
      this.armed = false;
      this.travelled = 0; // this footfall is the one to measure the next stride from
    } else {
      const stride = this.stride + this.strideGain * motion.speed;
      if (this.travelled < stride) return;
      this.travelled -= stride; // subtract rather than modulo: the stride moves with the speed
    }
    this.sets[this.surface]?.play();
  }
}
