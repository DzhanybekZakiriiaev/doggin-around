import { DOG_ACTIONS, type DogAction, type DogAppearance } from './dog/dog'
import type { WheelSlot } from './emote-wheel'

export type CompanionId = 'huawei' | 'tricolor'

export const COMPANIONS: Record<CompanionId, {
  label: string
  portrait: string
  model: string
  appearance?: DogAppearance
  neck: string
}> = {
  huawei: {
    label: 'Hua',
    portrait: '/models/huawei-dog-reference.png',
    model: '/models/dog-animated.glb',
    neck: 'joint_22',
  },
  tricolor: {
    label: 'Wei',
    portrait: '/models/tricolor-reference.png',
    model: '/models/tricolor-research/dog-animated.glb',
    appearance: {
      kind: 'smal-pets-faces',
      manifestUrl: '/models/tricolor-research/manifest.json',
      density: 37525,
    },
    neck: 'SMAL_joint_15',
  },
}

export function companionSkills(id: CompanionId, available: readonly DogAction[]): WheelSlot[] {
  return DOG_ACTIONS
    .filter(action => available.includes(action.name) && !(id === 'huawei' && action.name === 'peekaboo'))
    .map(action => ({ id: action.name, label: action.label, icon: action.icon }))
}
