// The emote wheel (hold X, Fortnite style): Biscuit's tricks and what you can do with him, on a ring that
// opens next to him on screen. Push the mouse towards one and let go of X (or click) to pick it; a quick tap
// of X leaves the wheel open until something's picked or X / Esc is pressed again.

export interface WheelSlot {
  id: string;
  label: string;
  icon: string;
}

const RADIUS = 138; // px, from the centre to the middle of the slots
const SIZE = 380; // px across
const EDGE = 12; // px kept clear of the window's edges
const DEAD_ZONE = 26; // px of mouse travel before anything's picked
const TAP_MS = 250;

export class EmoteWheel {
  readonly element: HTMLElement;
  private readonly slotEls: HTMLElement[] = [];
  private readonly pickLabel: HTMLElement;
  private shown = false;
  private selected = -1;
  private aimX = 0;
  private aimY = 0;
  private centreX = 0;
  private centreY = 0;
  private openedAt = 0;

  constructor(
    parent: HTMLElement,
    private readonly items: WheelSlot[],
    private readonly onPick: (slot: WheelSlot) => void,
    private readonly onClose: () => void,
  ) {
    this.element = parent.appendChild(document.createElement('div'));
    this.element.className = 'emote-wheel';
    this.element.style.setProperty('--span', `${360 / items.length}deg`);
    items.forEach((item, i) => {
      const angle = (i / items.length) * Math.PI * 2;
      const slot = this.element.appendChild(document.createElement('button'));
      slot.type = 'button';
      slot.className = 'emote-wheel__slot';
      slot.style.setProperty('--x', `${Math.sin(angle) * RADIUS}px`);
      slot.style.setProperty('--y', `${-Math.cos(angle) * RADIUS}px`);
      slot.innerHTML = `<b>${item.icon}</b><span>${item.label}</span>`;
      // Without pointer lock (drag-to-look) the slots are plain buttons.
      slot.addEventListener('pointerenter', () => this.select(i));
      slot.addEventListener('click', (event) => {
        event.stopPropagation();
        this.select(i);
        this.pick();
      });
      this.slotEls.push(slot);
    });
    const centre = this.element.appendChild(document.createElement('div'));
    centre.className = 'emote-wheel__centre';
    centre.innerHTML = '<small>BISCUIT</small><strong></strong>';
    this.pickLabel = centre.querySelector('strong')!;
  }

  get isOpen() {
    return this.shown;
  }

  /** Opens centred on `at` (window pixels; the middle of the window without it), clear of the edges. */
  show(at?: { x: number; y: number }) {
    const half = SIZE / 2 + EDGE;
    const clamp = (value: number, size: number) => Math.min(Math.max(value, half), Math.max(half, size - half));
    this.centreX = clamp(at?.x ?? window.innerWidth / 2, window.innerWidth);
    this.centreY = clamp(at?.y ?? window.innerHeight / 2, window.innerHeight);
    this.element.style.left = `${this.centreX}px`;
    this.element.style.top = `${this.centreY}px`;
    this.aimX = this.aimY = 0;
    this.select(-1);
    this.openedAt = performance.now();
    this.shown = true;
    this.element.classList.add('is-open');
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.element.classList.remove('is-open');
    this.onClose();
  }

  /** X let go: picks what's aimed at, unless that was a quick tap with nothing aimed at (it stays open). */
  release() {
    if (!this.shown) return;
    if (this.selected < 0 && performance.now() - this.openedAt < TAP_MS) return;
    this.pick();
  }

  /** Closes, doing whatever's picked (nothing if the aim's still in the middle). */
  pick() {
    const item = this.items[this.selected];
    this.hide();
    if (item) this.onPick(item);
  }

  /** Pointer-locked mouse movement: the aim drifts like a thumbstick, held to the ring. */
  move(dx: number, dy: number) {
    if (!this.shown) return;
    this.aimX += dx;
    this.aimY += dy;
    const length = Math.hypot(this.aimX, this.aimY);
    if (length > RADIUS) {
      this.aimX *= RADIUS / length;
      this.aimY *= RADIUS / length;
    }
    this.aimAt(this.aimX, this.aimY);
  }

  /** The mouse over the window (no pointer lock). */
  moveTo(x: number, y: number) {
    if (this.shown) this.aimAt(x - this.centreX, y - this.centreY);
  }

  private aimAt(x: number, y: number) {
    if (Math.hypot(x, y) < DEAD_ZONE) return this.select(-1);
    const turn = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2); // 0 at the top, clockwise
    this.select(Math.round(turn / ((Math.PI * 2) / this.items.length)) % this.items.length);
  }

  private select(index: number) {
    if (index === this.selected) return;
    this.selected = index;
    this.slotEls.forEach((slot, i) => slot.classList.toggle('is-picked', i === index));
    this.element.classList.toggle('has-pick', index >= 0);
    // The highlighted wedge starts half a slot before the picked one.
    this.element.style.setProperty('--wedge', `${(index - 0.5) * (360 / this.items.length)}deg`);
    this.pickLabel.textContent = index >= 0 ? this.items[index].label : '';
  }
}
