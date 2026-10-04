/** Comic iris wipe: the view closes to a halftone-inked circle, with optional sound-effect lettering. */
export class ComicTransition {
  constructor(private readonly el: HTMLElement) {}

  /** Closes the iris. Resolves once the screen is covered. */
  cover(sfx?: string, seconds = 0.55): Promise<void> {
    const lettering = this.el.querySelector<HTMLElement>('.sfx')!;
    lettering.textContent = sfx ?? '';
    lettering.classList.toggle('pop', !!sfx);
    return this.animate('covered', seconds);
  }

  /** Opens the iris again. */
  reveal(seconds = 0.6): Promise<void> {
    return this.animate('', seconds);
  }

  private animate(state: string, seconds: number): Promise<void> {
    this.el.style.setProperty('--wipe-seconds', `${seconds}s`);
    this.el.dataset.state = state;
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}
