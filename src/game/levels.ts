// Gameplay placements for each generated world, in that world's metres (the viewer's frame:
// floor under the panorama camera at y = 0, panorama centre facing -Z).
// Measured by raycasting the world's collider (see MarbleWorld.raycastPano); a new generation of a
// world needs its placements measured again.

import type { PropKind } from './props';

export type LevelId = 'yard' | 'cabin';

export interface DoorPlacement {
  id: string;
  /** Bottom centre of the doorway, on the threshold. */
  base: [number, number, number];
  /** Horizontal direction the doorway faces: out of the wall, towards where the player approaches from. */
  facing: [number, number];
  width: number;
  height: number;
  /** The door leaf filling the doorway; without one it's an open doorway. */
  door?: {
    /** The world has this door painted in: erase it and show a dark recess behind the leaf. */
    painted: boolean;
    /** Hinge side, as seen by the player approaching. */
    hinge: 'left' | 'right';
    /** `push` swings away from the player, `pull` towards them. */
    opens: 'push' | 'pull';
  };
  to: LevelId;
  prompt: string;
  /** Locked until the Storm Night quest's key opens it (when the quest is on). */
  locked?: boolean;
  /** Comic lettering over the transition. */
  sfx: string;
}

export interface PropPlacement {
  kind: PropKind;
  /** Where it's dropped in from when the world loads; it settles onto the ground. */
  at: [number, number, number];
}

/** A box where no rain falls (`size` in metres, turned `yaw` about Y): roofs the collider has holes in. */
export interface RainShelter {
  center: [number, number, number];
  size: [number, number, number];
  yaw: number;
}

/** Which footstep recording the ground plays. */
export type Surface = 'wet' | 'wood';

export interface Footing {
  /** What the player is walking on at ground level. */
  ground: Surface;
  /**
   * Height at which the ground gives way to decking, in this world's metres. The porch slab and its
   * steps are the only raised floor in the yards, so standing above this means standing on planks.
   */
  boardsAbove?: number;
}

export interface Placements {
  doors: DoorPlacement[];
  props?: PropPlacement[];
  /** Storm Night: where Biscuit digs up the spare key (the soft, freshly dug soil in the yard). */
  digSpot?: [number, number, number];
  /** Storm Night: where he sits when the game starts (as comic panel 1 draws him). */
  biscuitStart?: [number, number, number];
  /** Storm Night: the cold grate the branches go on, where the fire is lit. */
  fireplace?: [number, number, number];
  /**
   * Marble only builds the collider from what the panorama saw, so roofs have holes (the house's inside and
   * parts of the porch roof are missing) and rain would fall through them: these boxes keep it out.
   */
  rainShelters?: RainShelter[];
  /** What it sounds like underfoot. Worlds without one fall back to their mood.  */
  footing?: Footing;
}

export const PLACEMENTS: Record<string, Placements> = {
  // Yard A: big stump, mailbox
  'yard-single/2026-10-04T02-05-08_standard_77b1c400': {
    // Storm Night's firewood: one either side of the path, both in view from where you start (and outlined
    // in orange) so the demo doesn't turn into a search; Biscuit fetches them too.
    props: [
      { kind: 'branch', at: [-3.4, 0.6, -4.6] },
      { kind: 'branch', at: [3.8, 0.6, -4.4] },
    ],
    digSpot: [1.69, -0.08, -4.76], // the freshly dug hole right of the porch steps
    biscuitStart: [0.95, 0, -4.1], // sitting by the hole, clear of the hands at the bottom of the view
    // The porch (under its roof, 3.6 m) and the house behind it, square to the front door.
    rainShelters: [
      { center: [-0.43, 1.48, -8.02], size: [8.6, 3.95, 2.6], yaw: -0.432 },
      { center: [2.05, 3.25, -13.38], size: [8.6, 7.5, 9.2], yaw: -0.432 },
    ],
    // Deck measured at y 0.93, open ground at 0.03; the steps bridge the two.
    footing: { ground: 'wet', boardsAbove: 0.3 },
    doors: [
      {
        id: 'front-door',
        base: [-0.46, 0.94, -9.14],
        facing: [-0.42, 0.91],
        width: 1.0,
        height: 1.97,
        door: { painted: true, hinge: 'left', opens: 'push' },
        to: 'cabin',
        prompt: 'Open the door',
        locked: true,
        sfx: 'CREEAK!',
      },
    ],
  },
  // Yard B: woodpile, gate
  'yard-single/2026-10-04T02-05-53_standard_a985bc88': {
    props: [
      { kind: 'stick', at: [0.7, 0.5, -2.4] },
    ],
    // Deck measured at y 1.02, open ground at 0.11.
    footing: { ground: 'wet', boardsAbove: 0.3 },
    doors: [
      {
        id: 'front-door',
        base: [-0.48, 1.07, -9.3],
        facing: [-0.41, 0.91],
        width: 1.0,
        height: 1.97,
        door: { painted: true, hinge: 'left', opens: 'push' },
        to: 'cabin',
        prompt: 'Open the door',
        locked: true,
        sfx: 'CREEAK!',
      },
    ],
  },
  'cabin-single/2026-10-04T02-04-41_standard_dd8ca1b4': {
    props: [{ kind: 'stick', at: [0.5, 0.5, -1.0] }],
    fireplace: [0, 0.2, -5.72], // on the grate, inside the stone fireplace straight ahead
    footing: { ground: 'wood' }, // floorboards throughout
    doors: [
      {
        // The same door seen from inside: the doorway is open in the painted world, so the leaf fills it.
        // Hinged on the right from in here (the left from outside) and opening into the room.
        id: 'front-door',
        base: [-0.09, 0, 2.0],
        facing: [0, -1],
        width: 1.24,
        height: 2.1,
        door: { painted: false, hinge: 'right', opens: 'pull' },
        to: 'yard',
        prompt: 'Open the door',
        sfx: 'WHOOSH!',
      },
    ],
  },
};

/** Which generated world each level uses. Switch the yard here once one is chosen. */
export const LEVEL_RUNS: Record<LevelId, string> = {
  yard: 'yard-single/2026-10-04T02-05-08_standard_77b1c400',
  cabin: 'cabin-single/2026-10-04T02-04-41_standard_dd8ca1b4',
};
