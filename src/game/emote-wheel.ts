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
const DEAD_ZONE = 64; // px of mouse travel before anything's picked
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
  private openedAt = 0
  private page = 0
  private title!: HTMLElement
  private pager!: HTMLElement
  private pageLabel!: HTMLElement
  private readonly pageSize = 8

  constructor(
    parent: HTMLElement,
    private items: WheelSlot[],
    private readonly onPick: (slot: WheelSlot) => void,
    private readonly onClose: () => void,
  ) {
    this.element = parent.appendChild(document.createElement('div'));
    this.element.className = 'emote-wheel';
    const centre = this.element.appendChild(document.createElement('div'));
    centre.className = 'emote-wheel__centre';
    centre.innerHTML = '<small>BISCUIT</small><strong></strong>';
    this.pickLabel = centre.querySelector('strong')!
    this.title = centre.querySelector('small')!
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-label', 'Dog skills')
    this.pager = centre.appendChild(document.createElement('nav'))
    this.pager.className = 'emote-wheel__pages'
    this.pager.setAttribute('aria-label', 'Skill pages')
    const previous = this.pager.appendChild(document.createElement('button'))
    previous.type = 'button'
    previous.textContent = '‹'
    previous.setAttribute('aria-label', 'Previous skills')
    this.pageLabel = this.pager.appendChild(document.createElement('span'))
    this.pageLabel.setAttribute('aria-live', 'polite')
    const next = this.pager.appendChild(document.createElement('button'))
    next.type = 'button'
    next.textContent = '›'
    next.setAttribute('aria-label', 'Next skills')
    previous.addEventListener('click', event => {
      event.stopPropagation()
      this.changePage(-1)
    })
    next.addEventListener('click', event => {
      event.stopPropagation()
      this.changePage(1)
    })
    this.setItems(items, 'BISCUIT')
  }

  setItems(items: WheelSlot[], title: string) {
    this.hide()
    this.items = items
    this.title.textContent = title
    this.page = 0
    this.renderPage()
  }

  private get visibleItems() {
    return this.items.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)
  }

  private renderPage() {
    for (const slot of this.slotEls) slot.remove()
    this.slotEls.length = 0
    this.selected = -1
    this.element.classList.remove('has-pick')
    this.pickLabel.textContent = 'SKILLS'
    const items = this.visibleItems
    this.element.style.setProperty('--span', `${360 / Math.max(1, items.length)}deg`)
    items.forEach((item, index) => {
      const angle = (index / items.length) * Math.PI * 2
      const slot = this.element.appendChild(document.createElement('button'))
      slot.type = 'button'
      slot.className = 'emote-wheel__slot'
      slot.dataset.skill = item.id
      slot.setAttribute('aria-label', item.label)
      slot.style.setProperty('--x', `${Math.sin(angle) * RADIUS}px`)
      slot.style.setProperty('--y', `${-Math.cos(angle) * RADIUS}px`)
      const icon = slot.appendChild(document.createElement('b'))
      icon.textContent = item.icon
      icon.setAttribute('aria-hidden', 'true')
      slot.appendChild(document.createElement('span')).textContent = item.label
      slot.addEventListener('pointerenter', () => this.select(index))
      slot.addEventListener('focus', () => this.select(index))
      slot.addEventListener('click', event => {
        event.stopPropagation()
        this.select(index)
        this.pick()
      })
      this.slotEls.push(slot)
    })
    this.pageLabel.textContent = `${this.page + 1} / ${Math.max(1, Math.ceil(this.items.length / this.pageSize))}`
    this.pager.hidden = this.items.length <= this.pageSize
  }

  changePage(direction: number) {
    const count = Math.max(1, Math.ceil(this.items.length / this.pageSize))
    this.page = (this.page + direction + count) % count
    this.aimX = this.aimY = 0
    this.renderPage()
  }

  get isOpen() {
    return this.shown;
  }

  /** Opens centred on `at` (window pixels; the middle of the window without it), clear of the edges. */
  show(at?: { x: number; y: number }) {
    if (!this.items.length) return
    const half = SIZE / 2 + EDGE
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

  /** Releasing without a selection keeps the wheel open. */
  release() {
    if (!this.shown) return;
    if (this.selected < 0 || performance.now() - this.openedAt < TAP_MS) return
    this.pick();
  }

  /** Closes, doing whatever's picked (nothing if the aim's still in the middle). */
  pick() {
    const item = this.visibleItems[this.selected];
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
    this.select(Math.round(turn / ((Math.PI * 2) / this.visibleItems.length)) % this.visibleItems.length);
  }

  private select(index: number) {
    if (index === this.selected) return;
    this.selected = index;
    this.slotEls.forEach((slot, i) => slot.classList.toggle('is-picked', i === index));
    this.element.classList.toggle('has-pick', index >= 0);
    // The highlighted wedge starts half a slot before the picked one.
    this.element.style.setProperty('--wedge', `${(index - 0.5) * (360 / Math.max(1, this.visibleItems.length))}deg`);
    this.pickLabel.textContent = this.visibleItems[index]?.label ?? 'SKILLS';
  }
}
