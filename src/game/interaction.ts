import * as THREE from 'three';

export interface Interactable {
  /** The point the player has to look at. */
  target: THREE.Vector3;
  /** Maximum distance from the camera to the target, in metres. */
  range: number;
  /** What "E" does; a function when it changes with the situation (e.g. a locked door). */
  prompt: string | (() => string);
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
    // The one nearest the crosshair wins (a stick lying at Biscuit's nose vs. petting him), with a
    // little weight on distance so a target right in front beats one far behind it.
    let best: Interactable | undefined;
    let bestScore = Infinity;
    for (const item of this.items) {
      if (item.enabled && !item.enabled()) continue;
      toTarget.subVectors(item.target, camera.position);
      const distance = toTarget.length();
      const angle = forward.angleTo(toTarget);
      if (distance > item.range || angle > MAX_LOOK_ANGLE) continue;
      const score = angle + distance * 0.1;
      if (score >= bestScore) continue;
      best = item;
      bestScore = score;
    }
    this.show(best);
  }

  private shown = '';

  private show(item: Interactable | undefined) {
    const text = item ? (typeof item.prompt === 'function' ? item.prompt() : item.prompt) : '';
    if (item === this.current && text === this.shown) return;
    this.current = item;
    this.shown = text;
    this.promptEl.classList.toggle('visible', !!item);
    if (item) this.promptEl.innerHTML = `<kbd>E</kbd> ${text}`;
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
