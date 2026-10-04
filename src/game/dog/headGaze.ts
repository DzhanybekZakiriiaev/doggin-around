import type { DogAction } from "./dog"

const glances = [
  { yaw: -0.28, pitch: 0.045, duration: 2.6 },
  { yaw: 0.35, pitch: 0.085, duration: 3.3 },
  { yaw: 0.1, pitch: -0.045, duration: 2.4 },
  { yaw: -0.36, pitch: 0.06, duration: 3.5 },
  { yaw: 0.23, pitch: 0.015, duration: 2.8 },
  { yaw: -0.04, pitch: -0.01, duration: 2.1 },
]
const duration = glances.reduce((total, glance) => total + glance.duration, 0)

export function naturalHeadGaze(time: number): {
  yaw: number
  pitch: number
} {
  let phase = time % duration
  let previous = glances[glances.length - 1]
  for (const glance of glances) {
    if (phase < glance.duration) {
      const t = Math.min(phase / 0.95, 1)
      const blend = t * t * t * (10 + t * (-15 + 6 * t))
      return {
        yaw: previous.yaw + (glance.yaw - previous.yaw) * blend,
        pitch: previous.pitch + (glance.pitch - previous.pitch) * blend,
      }
    }
    phase -= glance.duration
    previous = glance
  }
  return { yaw: previous.yaw, pitch: previous.pitch }
}

export function headGazeGain(action: DogAction): number {
  if (["touch", "rollover", "playdead"].includes(action)) return 0
  if (
    [
      "jump",
      "backflip",
      "dig",
      "sniff",
      "playbow",
      "down",
      "crawl",
      "peekaboo",
    ].includes(action)
  )
    return 0.15
  if (["walk", "run", "backup"].includes(action)) return 0.55
  if (["spin", "shake", "highfive", "beg", "gangnam", "weave"].includes(action))
    return 0.35
  return 1
}
