import * as THREE from 'three';

export interface Interactable {
  /** The point the player has to look at. */
  target: THREE.Vector3;
  /** Maximum distance from the camera to the target, in metres. */
  range: number;
  prompt: string;
  /** Checked every frame; when it returns false the item can't be used right now. */
  enabled?: () => boolean;
  act(): Promise<void> | void;
}

const MAX_LOOK_ANGLE = THREE.MathUtils.degToRad(35);

/** Shows "E · <prompt>" for the interactable the player is looking at, and runs it on E. */
export class Interactions {
  enabled = true;
  private items: Interactable[] = [];
  private current?: Interactable;
  private busy = false;

  constructor(private readonly promptEl: HTMLElement) {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyE' && !event.repeat) void this.activate();
    });
  }

  set(items: Interactable[]) {
    this.items = items;
    this.show(undefined);
  }

  update(camera: THREE.Camera) {
    if (!this.enabled || this.busy) return this.show(undefined);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const toTarget = new THREE.Vector3();
    let best: Interactable | undefined;
    let bestDistance = Infinity;
    for (const item of this.items) {
      if (item.enabled && !item.enabled()) continue;
      toTarget.subVectors(item.target, camera.position);
      const distance = toTarget.length();
      if (distance > item.range || distance >= bestDistance) continue;
      if (forward.angleTo(toTarget) > MAX_LOOK_ANGLE) continue;
      best = item;
      bestDistance = distance;
    }
    this.show(best);
  }

  private show(item: Interactable | undefined) {
    if (item === this.current) return;
    this.current = item;
    this.promptEl.classList.toggle('visible', !!item);
    if (item) this.promptEl.innerHTML = `<kbd>E</kbd> ${item.prompt}`;
  }

  private async activate() {
    const item = this.current;
    if (!this.enabled || !item || this.busy) return;
    this.busy = true;
    this.show(undefined);
    try {
      await item.act();
    } finally {
      this.busy = false;
    }
  }
}
