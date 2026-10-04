import { describe, expect, it } from "vitest"
import { DOG_ACTIONS, type DogAction } from "../../src/dog"
import {
  CommandStream,
  normalize,
  parseUtterance,
  type VoiceCommand,
  withinOneEdit,
} from "../../src/voice/commands"

function intents(text: string): string[] {
  return parseUtterance(text).commands.map(describeIntent)
}

function describeIntent(command: VoiceCommand): string {
  return command.kind === "action" ? command.action : command.kind
}

describe("utterance normalization", () => {
  it("drops punctuation, casing, filler words, and the dog's name", () => {
    expect(normalize("Um, okay — can you please SIT, doggy?")).toEqual(["sit"])
    expect(normalize("Hey buddy, that's enough!")).toEqual(["thats", "enough"])
    expect(normalize("   ")).toEqual([])
  })
})

describe("single edit distance", () => {
  it("accepts one substitution, insertion, or deletion only", () => {
    expect(withinOneEdit("sit", "sit")).toBe(true)
    expect(withinOneEdit("sit", "sid")).toBe(true)
    expect(withinOneEdit("sit", "set")).toBe(true)
    expect(withinOneEdit("sit", "sits")).toBe(true)
    expect(withinOneEdit("sit", "it")).toBe(true)
    expect(withinOneEdit("sit", "sniff")).toBe(false)
    expect(withinOneEdit("walk", "talks")).toBe(false)
    expect(withinOneEdit("spin", "nips")).toBe(false)
  })
})

describe("keyword parsing", () => {
  it("recognizes every clip the dog ships with", () => {
    const spoken: Record<DogAction, string> = {
      idle: "stay",
      walk: "walk",
      run: "run",
      sit: "sit down",
      jump: "jump",
      bark: "speak",
      paw: "shake hands",
      spin: "spin around",
      playbow: "play bow",
      sniff: "sniff around",
      wag: "good boy",
    }
    for (const { name } of DOG_ACTIONS)
      expect(intents(spoken[name]), spoken[name]).toEqual([name])
  })

  it("maps every table entry onto a real clip", () => {
    const clips = new Set<string>(DOG_ACTIONS.map(({ name }) => name))
    for (const phrase of ["stretch", "walkies", "twirl", "woof", "high five"]) {
      const [command] = parseUtterance(phrase).commands
      expect(command?.kind, phrase).toBe("action")
      if (command?.kind === "action") expect(clips).toContain(command.action)
    }
  })

  it("prefers the longest phrase at each position", () => {
    expect(intents("stand up")).toEqual(["idle"])
    expect(intents("jump up")).toEqual(["jump"])
    expect(intents("up")).toEqual(["jump"])
    expect(intents("turn around")).toEqual(["spin"])
    expect(intents("come here")).toEqual(["come"])
  })

  it("handles the studio interactions that are not clips", () => {
    expect(intents("go fetch")).toEqual(["fetch"])
    expect(intents("get the ball")).toEqual(["fetch"])
    expect(intents("stop it")).toEqual(["stop"])
    expect(intents("come back")).toEqual(["come"])
  })

  it("reads a sequence in spoken order and collapses repeats", () => {
    expect(intents("come here and sit")).toEqual(["come", "sit"])
    expect(intents("sit, then bark, then spin")).toEqual([
      "sit",
      "bark",
      "spin",
    ])
    expect(intents("sit sit sit")).toEqual(["sit"])
  })

  it("repairs mishearings and inflections", () => {
    expect(intents("sid")).toEqual(["sit"])
    expect(intents("set")).toEqual(["sit"])
    expect(intents("sitting")).toEqual(["sit"])
    expect(intents("running")).toEqual(["run"])
    expect(intents("spinning")).toEqual(["spin"])
    expect(intents("barks")).toEqual(["bark"])
    expect(parseUtterance("sid").commands[0].repaired).toBe(true)
    expect(parseUtterance("sit").commands[0].repaired).toBe(false)
  })

  it("refuses repairs that collide or lose the leading sound", () => {
    expect(intents("park")).toEqual([])
    expect(intents("fun")).toEqual([])
    expect(intents("it")).toEqual([])
    expect(intents("balk")).toEqual([])
    expect(intents("top")).toEqual([])
  })

  it("treats praise as praise, not as a bow", () => {
    expect(intents("good boy")).toEqual(["wag"])
    expect(intents("thats a good girl")).toEqual(["wag"])
    expect(intents("boy")).toEqual(["wag"])
    expect(intents("good")).toEqual(["wag"])
    expect(intents("bow")).toEqual(["playbow"])
    expect(intents("play bow")).toEqual(["playbow"])
  })

  it("keeps near-identical keywords apart", () => {
    expect(intents("talk")).toEqual(["bark"])
    expect(intents("walk")).toEqual(["walk"])
    expect(intents("sniff")).toEqual(["sniff"])
    expect(intents("spin")).toEqual(["spin"])
  })

  it("ignores words it does not know", () => {
    expect(intents("what a lovely afternoon")).toEqual([])
    expect(intents("")).toEqual([])
  })
})

describe("escalation to a language model", () => {
  it("escalates objects and places the keyword table cannot resolve", () => {
    expect(parseUtterance("go grab that stick by the fireplace").escalate).toBe(
      true,
    )
    expect(parseUtterance("can you bring me the rope").escalate).toBe(true)
    expect(parseUtterance("sit over by the door").escalate).toBe(true)
    expect(parseUtterance("what a lovely afternoon").escalate).toBe(true)
  })

  it("keeps plain commands off the slow path", () => {
    expect(parseUtterance("sit").escalate).toBe(false)
    expect(parseUtterance("good boy").escalate).toBe(false)
    expect(parseUtterance("get the ball").escalate).toBe(false)
    expect(parseUtterance("come here and sit").escalate).toBe(false)
  })
})

describe("command stream", () => {
  it("fires a partial once and ignores the matching commit", () => {
    const stream = new CommandStream()
    expect(stream.next("si").map(describeIntent)).toEqual([])
    expect(stream.next("sit").map(describeIntent)).toEqual(["sit"])
    expect(stream.next("sit").map(describeIntent)).toEqual([])
    expect(stream.next("sit down").map(describeIntent)).toEqual([])
  })

  it("fires only the new tail as more words arrive", () => {
    const stream = new CommandStream()
    expect(stream.next("sit").map(describeIntent)).toEqual(["sit"])
    expect(stream.next("sit and bark").map(describeIntent)).toEqual(["bark"])
    expect(stream.next("sit and bark and spin").map(describeIntent)).toEqual([
      "spin",
    ])
  })

  it("replaces the tail when the transcript is corrected", () => {
    const stream = new CommandStream()
    expect(stream.next("sit").map(describeIntent)).toEqual(["sit"])
    expect(stream.next("stand up").map(describeIntent)).toEqual(["idle"])
  })

  it("starts clean for the next hold", () => {
    const stream = new CommandStream()
    stream.next("sit")
    stream.reset()
    expect(stream.next("sit").map(describeIntent)).toEqual(["sit"])
  })
})
