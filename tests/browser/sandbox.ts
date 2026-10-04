import { readFileSync } from "node:fs"
import type { Dog, DogAction } from "../../src/dog"
import type { FetchInteraction } from "../../src/fetch"

declare global {
  interface Window {
    dogSandbox: {
      dog: Dog
      loadDog: (url: string) => Promise<void>
      fetchPlay: FetchInteraction
      voice: {
        hold: () => void
        transcript: (text: string, settled: boolean) => void
      }
    }
  }
}

export const loopingActions = new Set<DogAction>([
  "idle",
  "walk",
  "run",
  "sniff",
  "wag",
])

/** The known test rig, rebuilt with only the named clips. */
export function rigWithActions(names: readonly DogAction[]): Buffer {
  const source = readFileSync("work/test-rig.glb")
  const jsonLength = source.readUInt32LE(12)
  const data = JSON.parse(source.subarray(20, 20 + jsonLength).toString()) as {
    animations: { name: string }[]
  }
  const clips = new Map(data.animations.map((clip) => [clip.name, clip]))
  data.animations = names.map((name) => {
    const clip = clips.get(
      name === "idle" ? "idle" : loopingActions.has(name) ? "walk" : "spin",
    )
    if (!clip) throw new Error("The known rig is missing its test clips")
    return { ...structuredClone(clip), name }
  })
  const json = Buffer.from(JSON.stringify(data))
  const padding = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)
  const header = Buffer.from(source.subarray(0, 20))
  const binary = source.subarray(20 + jsonLength)
  header.writeUInt32LE(20 + json.length + padding.length + binary.length, 8)
  header.writeUInt32LE(json.length + padding.length, 12)
  return Buffer.concat([header, json, padding, binary])
}
