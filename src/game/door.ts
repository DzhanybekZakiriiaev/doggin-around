import RAPIER from '@dimforge/rapier3d-compat';
import { SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { DoorPlacement } from './levels';
import { inked, toonMaterial } from './toon';

const OPEN_ANGLE = THREE.MathUtils.degToRad(105);
const OUTLINE = 0.012;
const KNOB_INSET = 0.09; // from the free edge of the leaf
const KNOB_HEIGHT = 0.47; // fraction of the door height
const KEYHOLE_DROP = 0.075; // the keyhole sits this far below the knob
const LEAF_OFFSET = 0.03; // how far the leaf sits in front of the threshold line

/**
 * A doorway in a Marble world, optionally filled by a toon-shaded door leaf that swings open.
 * Where the world has the door painted in, a Spark splat edit erases it and a dark recess shows
 * behind the leaf. Placeholder art: swap `buildLeaf` for the final door model.
 */
export class Doorway {
  /** In world space; local +Z faces the approaching player, +X is their right. */
  readonly object = new THREE.Group();
  readonly center: THREE.Vector3;
  readonly normal: THREE.Vector3;
  /** World position of the knob on the closed leaf, for the hand to reach for. */
  readonly knob?: THREE.Vector3;
  /** World position of the keyhole under the knob. */
  readonly keyhole?: THREE.Vector3;
  private readonly hinge?: THREE.Group;
  private readonly leaf?: THREE.Group;
  private keyInLock?: THREE.Object3D;
  private readonly openSign: number = 1;
  private swing = 0; // id of the running swing; close() bumps it so a stale swing can't reopen the door

  constructor(readonly placement: DoorPlacement) {
    const [x, y, z] = placement.base;
    this.normal = new THREE.Vector3(placement.facing[0], 0, placement.facing[1]).normalize();
    this.object.position.set(x, y, z);
    this.object.rotation.y = Math.atan2(this.normal.x, this.normal.z);
    this.center = new THREE.Vector3(x, y + placement.height / 2, z);

    const { door, width, height } = placement;
    if (door) {
      // The leaf runs from the hinge along +X; a right-hand hinge mirrors it. Positive hinge rotation
      // swings an unmirrored leaf away from the player, so mirroring or pulling flips the sign.
      const side = door.hinge === 'left' ? 1 : -1;
      this.openSign = side * (door.opens === 'push' ? 1 : -1);
      this.hinge = new THREE.Group();
      this.hinge.position.set((-side * width) / 2, 0, LEAF_OFFSET);
      this.hinge.scale.x = side;
      this.leaf = buildLeaf(width, height);
      this.hinge.add(this.leaf);
      this.object.add(this.hinge);
      if (door.painted) this.object.add(replacePaintedDoor(width, height));

      this.object.updateMatrixWorld(true);
      const atKnob = (drop: number, out: number) =>
        new THREE.Vector3(side * (width / 2 - KNOB_INSET), height * KNOB_HEIGHT - drop, LEAF_OFFSET + out).applyMatrix4(this.object.matrixWorld);
      this.knob = atKnob(0, 0.06);
      this.keyhole = atKnob(KEYHOLE_DROP, 0.03);
    }
  }

  /** Leaves `key` (a prop model, long axis along X) in the lock, turned: it swings open with the door. */
  insertKey(key: THREE.Object3D) {
    if (!this.leaf) return;
    this.removeKey();
    const { width, height } = this.placement;
    key.position.set(width - KNOB_INSET, height * KNOB_HEIGHT - KEYHOLE_DROP, 0.05);
    // Blade into the door, bow towards the player, turned a quarter.
    key.quaternion
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    this.leaf.add(key);
    this.keyInLock = key;
  }

  /** Takes the key back out (the quest restarting). */
  removeKey() {
    this.keyInLock?.removeFromParent();
    this.keyInLock = undefined;
  }

  /** A thin box over the closed leaf, so the player can't walk through a shut door. */
  collider(): RAPIER.ColliderDesc | undefined {
    if (!this.placement.door) return undefined;
    const { width, height } = this.placement;
    const position = this.center.clone().addScaledVector(this.normal, LEAF_OFFSET);
    const { x, y, z, w } = this.object.quaternion;
    return RAPIER.ColliderDesc.cuboid(width / 2, height / 2, 0.04)
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x, y, z, w });
  }

  /** Where to stand after coming through this doorway from the other side: just in front, facing away from it. */
  arrival() {
    const feet = new THREE.Vector3(...this.placement.base).addScaledVector(this.normal, 1.2);
    return { feet, yaw: Math.atan2(-this.normal.x, -this.normal.z) }; // camera looks along -Z at yaw 0
  }

  /** Swings the leaf open (open doorways resolve immediately). */
  open(seconds = 0.9): Promise<void> {
    if (!this.hinge) return Promise.resolve();
    const hinge = this.hinge;
    const swing = ++this.swing;
    const start = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        if (swing !== this.swing) return resolve(); // closed (or reopened) meanwhile
        const t = Math.min(1, (performance.now() - start) / 1000 / seconds);
        const eased = 1 - Math.pow(1 - t, 3); // ease out: a shove, then it drifts
        hinge.rotation.y = eased * OPEN_ANGLE * this.openSign;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  close() {
    this.swing++;
    if (this.hinge) this.hinge.rotation.y = 0;
  }
}

function buildLeaf(width: number, height: number) {
  const leaf = new THREE.Group();
  const halftone = { dotSize: 9, shadowLevel: 0.55 }; // coarse dots, only in the deeper shade
  const red = toonMaterial(0xb3362b, halftone);
  const darkRed = toonMaterial(0x8a2620, halftone);
  const brass = toonMaterial(0xd9a441, { dotSize: 5, shadowLevel: 0.55 });

  const slab = inked(new RoundedBoxGeometry(width, height, 0.05, 2, 0.012), red, OUTLINE);
  slab.position.set(width / 2, height / 2, 0);
  leaf.add(slab);

  // Four raised panels, like the painted door.
  const panelGeometry = new RoundedBoxGeometry(width * 0.32, height * 0.34, 0.02, 2, 0.006);
  for (const [px, py] of [[0.3, 0.27], [0.7, 0.27], [0.3, 0.7], [0.7, 0.7]]) {
    const panel = inked(panelGeometry, darkRed, OUTLINE * 0.5);
    panel.position.set(width * px, height * py, 0.03);
    leaf.add(panel);
  }

  const knob = inked(new THREE.SphereGeometry(0.035, 16, 12), brass, OUTLINE * 0.6);
  knob.position.set(width - KNOB_INSET, height * KNOB_HEIGHT, 0.06);
  leaf.add(knob);

  // A brass plate with the keyhole, under the knob.
  const plate = inked(new RoundedBoxGeometry(0.045, 0.07, 0.008, 2, 0.003), brass, OUTLINE * 0.4);
  plate.position.set(width - KNOB_INSET, height * KNOB_HEIGHT - KEYHOLE_DROP, 0.029);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 10), new THREE.MeshBasicMaterial({ color: 0x120c10 }));
  hole.rotation.x = Math.PI / 2;
  hole.position.set(width - KNOB_INSET, height * KNOB_HEIGHT - KEYHOLE_DROP + 0.008, 0.034);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.018, 0.004), hole.material);
  slot.position.set(width - KNOB_INSET, height * KNOB_HEIGHT - KEYHOLE_DROP - 0.004, 0.034);
  leaf.add(plate, hole, slot);
  return leaf;
}

/**
 * Erases the painted door's splats and puts a dark interior behind the opening. (Darkening the splats
 * instead doesn't work: the collider and the splats disagree by a few centimetres, so the painted
 * surface can sit in front of the leaf and cover it.)
 */
function replacePaintedDoor(width: number, height: number) {
  const group = new THREE.Group();

  const edit = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, softEdge: 0.03 });
  const box = new SplatEditSdf({ type: SplatEditSdfType.BOX, color: new THREE.Color(1, 1, 1), opacity: 0 });
  box.position.set(0, height / 2, 0);
  box.scale.set(width / 2 - 0.02, height / 2 - 0.02, 0.35); // half extents in metres, deep enough to catch the painted surface
  edit.add(box);

  const interior = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.6),
    new THREE.MeshBasicMaterial({ color: 0x0d0a10, side: THREE.BackSide }),
  );
  interior.position.set(0, height / 2, -0.3); // a dark recess behind the threshold
  group.add(edit, interior);
  return group;
}
