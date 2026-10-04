import { CommandStream, parseUtterance, type VoiceCommand } from '../voice/commands';
import { type ScribePhase, ScribeSession, speechSupported } from '../voice/scribe';
import { audioContext } from './audio';
import { DOG_ACTIONS, type DogAction } from './dog/dog';

// Voice control (hold F): ElevenLabs Scribe v2 Realtime turns what you say into text, the keyword parser
// (src/voice/commands.ts) turns the text into commands, and these handlers drive Biscuit. The partial
// transcripts are parsed as they stream in, so a command can land while the key is still down instead of
// waiting for the commit; CommandStream keeps the final transcript from firing the same thing twice. What
// you said appears in a comic speech bubble, filling in word by word, with a note underneath when he can't
// oblige.
//
// Only the keyword layer is wired up. A language model would take the committed transcript from here for the
// things a keyword table can't resolve ("the stick by the fireplace"); `escalate` already marks those.

export interface VoiceHandlers {
  /** One of his tricks; false when he's busy with something he can't drop. */
  perform(action: DogAction): boolean;
  /** "Come here" / "heel". */
  come(): void;
  /** "Stop" / "leave it": drop it and stand still. */
  stop(): void;
  /** Petting; false when the player's hands are full. */
  pet(): boolean;
  /** Throws what's carried for him to bring back; false when there's nothing to throw. */
  fetch(): boolean;
}

/** The chip under the bubble, by connection state. */
const PHASE_LABELS: Record<ScribePhase, string> = {
  offline: 'Reconnecting…',
  connecting: 'Connecting…',
  ready: 'Hold to talk',
  listening: 'Listening…',
  error: 'Voice is off',
};
const OPENING = 'Getting ready…'; // while the microphone is being opened, before it hears anything
const BUBBLE_SECONDS = 3.2; // how long a finished bubble stays up
const SILENCE_SECONDS = 1.2; // how long an empty one waits for a commit that may never come

export class DogVoice {
  /** False where the browser can't reach a microphone; the chip says so and holding F does nothing. */
  readonly supported = speechSupported();
  readonly element: HTMLElement;

  private readonly bubble: HTMLElement;
  private readonly line: HTMLElement;
  private readonly note: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly label: HTMLElement;
  private readonly commands = new CommandStream();
  private readonly session?: ScribeSession;
  private holding = false;
  private obeyed = false;
  private explained = false;
  private hideTimer?: ReturnType<typeof setTimeout>;

  constructor(
    parent: HTMLElement,
    private readonly handlers: VoiceHandlers,
  ) {
    this.element = parent.appendChild(document.createElement('div'));
    this.element.className = 'voice';
    this.element.innerHTML = `
      <div class="voice-bubble" hidden>
        <p class="voice-bubble__text"></p>
        <i class="voice-bubble__dots" aria-hidden="true"><b></b><b></b><b></b></i>
        <em class="voice-bubble__note"></em>
      </div>
      <div class="voice-chip"><kbd>F</kbd><span></span></div>`;
    const $ = (selector: string) => this.element.querySelector<HTMLElement>(selector)!;
    this.bubble = $('.voice-bubble');
    this.line = $('.voice-bubble__text');
    this.note = $('.voice-bubble__note');
    this.chip = $('.voice-chip');
    this.label = $('.voice-chip span');
    this.label.textContent = this.supported ? PHASE_LABELS.ready : 'No microphone';
    this.chip.classList.toggle('is-off', !this.supported);
    if (!this.supported) return;
    this.session = new ScribeSession({
      // The game's one context, not a second one of its own: two of them at different sample rates can
      // cost the page its output device, and everything here plays through that one (src/game/audio.ts).
      context: audioContext,
      onPartial: (text) => this.heard(text, false),
      onCommitted: (text) => this.heard(text, true),
      onMiss: () => this.miss('Didn’t catch that'),
      onPhase: (phase, detail) => {
        this.label.textContent = PHASE_LABELS[phase];
        this.chip.classList.toggle('is-live', phase === 'listening');
        this.chip.classList.toggle('is-off', phase === 'error');
        // Why it's off (a blocked microphone, a backend with no API key) is only worth a bubble while
        // someone is holding the key waiting for it; the chip says as much on its own. Each hold retries,
        // so the explanation turns up the moment it's asked for.
        if (detail && this.holding) this.miss(detail);
      },
    });
    window.addEventListener('blur', this.onBlur);
  }

  /**
   * Opens the socket, so the first thing said doesn't pay the connection time, and compiles the audio
   * worklet with it. Not the microphone: that is the player's to allow, on the first hold.
   */
  connect() {
    void this.session?.connect().catch(() => undefined);
    void this.session?.warm().catch(() => undefined);
  }

  /** F pressed: the microphone is live until `release`. */
  async hold() {
    if (!this.session || this.holding) return;
    this.holding = true;
    this.obeyed = false;
    this.explained = false;
    this.commands.reset();
    this.show('', '', false);
    // The first hold after arriving in a world waits for the microphone to open; the rest keep it and
    // go live at once. Say so either way, rather than let someone talk into a device that isn't listening
    // yet — the phase handler replaces this the moment it is.
    this.label.textContent = OPENING;
    await this.session.hold();
    if (!this.holding) this.session.release(); // let go while the microphone was still opening
  }

  /** F let go: commits the segment for a final transcript. */
  release() {
    if (!this.holding) return;
    this.holding = false;
    this.session?.release();
    // Nothing heard at all: give the commit a moment to land, then take the empty bubble away rather than
    // leave it sitting there (an offline socket never answers).
    if (this.bubble.classList.contains('is-empty')) this.fade(SILENCE_SECONDS);
  }

  /** Clears the bubble and gives the microphone back (leaving a world). */
  hide() {
    this.session?.sleep();
    this.holding = false;
    clearTimeout(this.hideTimer);
    this.bubble.hidden = true;
  }

  dispose() {
    clearTimeout(this.hideTimer);
    window.removeEventListener('blur', this.onBlur);
    this.session?.dispose();
    this.element.remove();
  }

  private readonly onBlur = () => this.release();

  /**
   * A transcript, in progress (`settled` false) or final. Commands fire as soon as the words are there; the
   * final one only explains itself if nothing in it landed.
   */
  private heard(text: string, settled: boolean) {
    this.show(text, '', settled);
    for (const command of this.commands.next(text)) this.obey(command);
    if (!settled) return;
    this.commands.reset();
    if (this.obeyed || this.explained) return;
    const spoken = text.trim();
    this.miss(
      !spoken
        ? 'Didn’t catch that'
        : parseUtterance(spoken).escalate
          ? 'He doesn’t know that one yet'
          : 'No trick for that',
    );
  }

  private obey(command: VoiceCommand) {
    switch (command.kind) {
      case 'action': {
        if (this.handlers.perform(command.action)) break;
        const label = DOG_ACTIONS.find(({ name }) => name === command.action)?.label ?? command.action;
        return this.miss(`He can’t ${label.toLowerCase()} right now`);
      }
      case 'come':
        this.handlers.come();
        break;
      case 'stop':
        this.handlers.stop();
        break;
      case 'pet':
        if (!this.handlers.pet()) return this.miss('Hands full · G to put things down');
        break;
      case 'fetch':
        if (!this.handlers.fetch()) return this.miss('Nothing in hand to throw');
        break;
    }
    this.obeyed = true;
  }

  /** A note under the transcript: why nothing happened. */
  private miss(note: string) {
    this.explained = true;
    this.show(this.line.textContent ?? '', note, true);
  }

  private show(text: string, note: string, settled: boolean) {
    clearTimeout(this.hideTimer);
    this.line.textContent = text;
    this.note.textContent = note;
    this.bubble.hidden = false;
    this.bubble.classList.toggle('is-empty', !text && !note); // the three dots, while nothing has been heard
    if (settled) this.fade(BUBBLE_SECONDS);
  }

  private fade(seconds: number) {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.bubble.hidden = true;
    }, seconds * 1000);
  }
}
