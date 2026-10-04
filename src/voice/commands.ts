import type { DogAction } from "../dog"

/** What a recognized phrase asks the studio to do. */
export type VoiceIntent =
  | { kind: "action"; action: DogAction }
  | { kind: "fetch" }
  | { kind: "stop" }
  | { kind: "come" }

export type VoiceCommand = VoiceIntent & {
  /** The words the phrase matched, for the transcript readout. */
  phrase: string
  /** True when the words only matched after stemming or fuzzy repair. */
  repaired: boolean
}

export type Utterance = {
  /** Lowercased, depunctuated, filler-free text. */
  text: string
  /** Recognized commands in spoken order, adjacent repeats collapsed. */
  commands: VoiceCommand[]
  /**
   * True when the words reference something this parser cannot resolve, so a
   * language model should see the committed transcript. That second layer is
   * not wired up yet; the studio only uses this to explain a miss.
   */
  escalate: boolean
}

/** Words dropped before matching. Phrases are normalized the same way. */
const FILLERS = new Set([
  "um",
  "umm",
  "uh",
  "uhh",
  "er",
  "erm",
  "ah",
  "oh",
  "hmm",
  "mmm",
  "okay",
  "ok",
  "alright",
  "please",
  "hey",
  "yo",
  "now",
  "just",
  "really",
  "very",
  "a",
  "an",
  "the",
  "and",
  "then",
  "so",
  "can",
  "could",
  "would",
  "will",
  "was",
  "you",
  "your",
  "i",
  "dog",
  "doggy",
  "doggie",
  "puppy",
  "pup",
  "buddy",
])

/** Written in spoken form, normalized at load so fillers line up. */
const SPOKEN: [string, VoiceIntent][] = [
  ["idle", { kind: "action", action: "idle" }],
  ["stay", { kind: "action", action: "idle" }],
  ["wait", { kind: "action", action: "idle" }],
  ["stand", { kind: "action", action: "idle" }],
  ["stand up", { kind: "action", action: "idle" }],
  ["settle", { kind: "action", action: "idle" }],
  ["settle down", { kind: "action", action: "idle" }],
  ["relax", { kind: "action", action: "idle" }],
  ["at ease", { kind: "action", action: "idle" }],
  ["walk", { kind: "action", action: "walk" }],
  ["walkies", { kind: "action", action: "walk" }],
  ["go for a walk", { kind: "action", action: "walk" }],
  ["walk around", { kind: "action", action: "walk" }],
  ["run", { kind: "action", action: "run" }],
  ["sprint", { kind: "action", action: "run" }],
  ["dash", { kind: "action", action: "run" }],
  ["run around", { kind: "action", action: "run" }],
  ["go fast", { kind: "action", action: "run" }],
  ["sit", { kind: "action", action: "sit" }],
  ["sit down", { kind: "action", action: "sit" }],
  ["take a seat", { kind: "action", action: "sit" }],
  ["jump", { kind: "action", action: "jump" }],
  ["jump up", { kind: "action", action: "jump" }],
  ["hop", { kind: "action", action: "jump" }],
  ["leap", { kind: "action", action: "jump" }],
  ["up", { kind: "action", action: "jump" }],
  ["bark", { kind: "action", action: "bark" }],
  ["speak", { kind: "action", action: "bark" }],
  ["talk", { kind: "action", action: "bark" }],
  ["woof", { kind: "action", action: "bark" }],
  ["say something", { kind: "action", action: "bark" }],
  ["paw", { kind: "action", action: "paw" }],
  ["shake", { kind: "action", action: "paw" }],
  ["shake hands", { kind: "action", action: "paw" }],
  ["high five", { kind: "action", action: "paw" }],
  ["give me your paw", { kind: "action", action: "paw" }],
  ["spin", { kind: "action", action: "spin" }],
  ["spin around", { kind: "action", action: "spin" }],
  ["twirl", { kind: "action", action: "spin" }],
  ["turn around", { kind: "action", action: "spin" }],
  ["do a spin", { kind: "action", action: "spin" }],
  ["play bow", { kind: "action", action: "playbow" }],
  ["playbow", { kind: "action", action: "playbow" }],
  ["bow", { kind: "action", action: "playbow" }],
  ["bow down", { kind: "action", action: "playbow" }],
  ["stretch", { kind: "action", action: "playbow" }],
  ["sniff", { kind: "action", action: "sniff" }],
  ["smell", { kind: "action", action: "sniff" }],
  ["sniff around", { kind: "action", action: "sniff" }],
  ["search", { kind: "action", action: "sniff" }],
  ["find it", { kind: "action", action: "sniff" }],
  ["wag", { kind: "action", action: "wag" }],
  ["wag your tail", { kind: "action", action: "wag" }],
  ["good boy", { kind: "action", action: "wag" }],
  ["good girl", { kind: "action", action: "wag" }],
  ["good", { kind: "action", action: "wag" }],
  ["boy", { kind: "action", action: "wag" }],
  ["girl", { kind: "action", action: "wag" }],
  ["whos a good boy", { kind: "action", action: "wag" }],
  ["fetch", { kind: "fetch" }],
  ["fetch it", { kind: "fetch" }],
  ["go fetch", { kind: "fetch" }],
  ["ball", { kind: "fetch" }],
  ["get the ball", { kind: "fetch" }],
  ["get it", { kind: "fetch" }],
  ["go get it", { kind: "fetch" }],
  ["bring it back", { kind: "fetch" }],
  ["throw the ball", { kind: "fetch" }],
  ["toss the ball", { kind: "fetch" }],
  ["catch", { kind: "fetch" }],
  ["stop", { kind: "stop" }],
  ["stop it", { kind: "stop" }],
  ["freeze", { kind: "stop" }],
  ["enough", { kind: "stop" }],
  ["thats enough", { kind: "stop" }],
  ["leave it", { kind: "stop" }],
  ["come", { kind: "come" }],
  ["come here", { kind: "come" }],
  ["come back", { kind: "come" }],
  ["here", { kind: "come" }],
  ["heel", { kind: "come" }],
  ["go home", { kind: "come" }],
]

/** Prepositions that point at a place this parser cannot resolve. */
const PLACE_HINTS = new Set([
  "over",
  "by",
  "near",
  "beside",
  "behind",
  "under",
  "above",
  "next",
  "toward",
  "towards",
  "into",
  "onto",
  "across",
  "inside",
  "outside",
  "past",
  "between",
  "through",
])

/** Determiners that usually introduce a named object. */
const DETERMINERS = new Set(["the", "that", "this", "those", "these", "my"])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['‘’ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0)
}

export function normalize(text: string): string[] {
  return words(text).filter((word) => !FILLERS.has(word))
}

const PHRASES = new Map<string, VoiceIntent>()
let longestPhrase = 1
for (const [spoken, intent] of SPOKEN) {
  const phrase = normalize(spoken)
  if (!phrase.length) continue
  PHRASES.set(phrase.join(" "), intent)
  longestPhrase = Math.max(longestPhrase, phrase.length)
}

const KEYWORDS = [...PHRASES].filter(([phrase]) => !phrase.includes(" "))
const VOCABULARY = new Set(
  [...PHRASES.keys()].flatMap((phrase) => phrase.split(" ")),
)

/** Spoken plurals and gerunds reduced toward a keyword. */
function stems(word: string): string[] {
  const candidates: string[] = []
  const push = (stem: string) => {
    if (stem.length >= 3 && !candidates.includes(stem)) candidates.push(stem)
  }
  if (word.endsWith("ing")) {
    const stem = word.slice(0, -3)
    push(stem)
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) push(stem.slice(0, -1))
    push(`${stem}e`)
  }
  if (word.endsWith("ed")) {
    const stem = word.slice(0, -2)
    push(stem)
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) push(stem.slice(0, -1))
  }
  if (word.endsWith("s") && !word.endsWith("ss")) push(word.slice(0, -1))
  return candidates
}

/** True when one insertion, deletion, or substitution turns `a` into `b`. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (long.length - short.length > 1) return false
  let index = 0
  while (index < short.length && short[index] === long[index]) index++
  if (index === short.length) return true
  if (short.length === long.length)
    return short.slice(index + 1) === long.slice(index + 1)
  return short.slice(index) === long.slice(index + 1)
}

function intentKey(intent: VoiceIntent): string {
  return intent.kind === "action" ? `action:${intent.action}` : intent.kind
}

/**
 * The one keyword within a single edit of `word`, or undefined when nothing is
 * close or the candidates disagree. Every near keyword votes, so a word caught
 * between two of them ("tolk" for talk or walk) is dropped rather than guessed.
 * A keyword shorter than five letters also has to share its first sound, which
 * keeps "park" from becoming "bark" and a stray "it" from becoming "sit".
 */
function repair(word: string): VoiceIntent | undefined {
  if (word.length < 3) return undefined
  let found: VoiceIntent | undefined
  let trusted = false
  for (const [keyword, intent] of KEYWORDS) {
    if (keyword.length < 3 || !withinOneEdit(keyword, word)) continue
    if (found && intentKey(found) !== intentKey(intent)) return undefined
    found ??= intent
    trusted ||= keyword.length >= 5 || keyword[0] === word[0]
  }
  return trusted ? found : undefined
}

type Match = { command: VoiceCommand; length: number }

function matchAt(spoken: string[], start: number): Match | undefined {
  const widest = Math.min(longestPhrase, spoken.length - start)
  for (let length = widest; length >= 1; length--) {
    const phrase = spoken.slice(start, start + length).join(" ")
    const intent = PHRASES.get(phrase)
    if (intent)
      return { command: { ...intent, phrase, repaired: false }, length }
  }
  const word = spoken[start]
  for (const stem of stems(word)) {
    const intent = PHRASES.get(stem)
    if (intent)
      return {
        command: { ...intent, phrase: word, repaired: true },
        length: 1,
      }
  }
  const repaired = repair(word)
  if (!repaired) return undefined
  return { command: { ...repaired, phrase: word, repaired: true }, length: 1 }
}

/** True when the words name a place or an object the keyword table lacks. */
function needsContext(text: string, commands: VoiceCommand[]): boolean {
  if (!commands.length) return true
  const raw = words(text)
  return raw.some(
    (word, index) =>
      PLACE_HINTS.has(word) ||
      (DETERMINERS.has(word) &&
        raw[index + 1] !== undefined &&
        !VOCABULARY.has(raw[index + 1])),
  )
}

export function parseUtterance(text: string): Utterance {
  const spoken = normalize(text)
  const commands: VoiceCommand[] = []
  for (let index = 0; index < spoken.length; ) {
    const match = matchAt(spoken, index)
    if (!match) {
      index++
      continue
    }
    const previous = commands.at(-1)
    if (!previous || intentKey(previous) !== intentKey(match.command))
      commands.push(match.command)
    index += match.length
  }
  return {
    text: spoken.join(" "),
    commands,
    escalate: needsContext(text, commands),
  }
}

/**
 * Hands out commands from a growing transcript without repeating itself. Every
 * update reparses from the start, so a correction ("sit" heard, then "stand up"
 * committed) replaces the tail rather than stacking onto it.
 */
export class CommandStream {
  private fired: VoiceCommand[] = []

  /** The commands in `text` that have not been handed out yet. */
  next(text: string): VoiceCommand[] {
    const { commands } = parseUtterance(text)
    let shared = 0
    while (
      shared < commands.length &&
      shared < this.fired.length &&
      intentKey(commands[shared]) === intentKey(this.fired[shared])
    )
      shared++
    this.fired = commands
    return commands.slice(shared)
  }

  reset(): void {
    this.fired = []
  }
}
