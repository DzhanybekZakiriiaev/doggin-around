import { Game } from './game/game';
import { HAND_ACTIONS, type HandAction } from './game/hands';
import { LEVEL_RUNS } from './game/levels';
import { worldRuns } from './game/worlds-index';

// The dev viewer (viewer.html): any downloaded world, free roaming, with a HUD for the collider view, fly
// mode, splat resolution, look settings and previews of every hand animation. ?quest=1 turns the Storm
// Night quest on (locked door, dig, key), as in the game.

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const worldSelect = $<HTMLSelectElement>('#world-select');
const resSelect = $<HTMLSelectElement>('#res-select');
const colliderToggle = $<HTMLInputElement>('#collider-toggle');
const flyToggle = $<HTMLInputElement>('#fly-toggle');
const handsToggle = $<HTMLInputElement>('#hands-toggle');
const splatHandsToggle = $<HTMLInputElement>('#splat-hands-toggle');
const rainToggle = $<HTMLInputElement>('#rain-toggle');
const dragToggle = $<HTMLInputElement>('#drag-toggle');
const lookSpeedInput = $<HTMLInputElement>('#look-speed');
const handActionSelect = $<HTMLSelectElement>('#hand-action');
const statusEl = $('#status');
const fpsEl = $('#fps');

const params = new URLSearchParams(location.search);
const game = await Game.create({
  ui: { prompt: $('#prompt'), hint: $('#hint'), transition: $('#transition'), start: $('#start') },
  quest: params.get('quest') === '1',
  resolution: params.get('res') ?? '500k',
  onStatus: (message) => (statusEl.textContent = message),
});
const { settings, player, hands, interactions } = game;

lookSpeedInput.value = String(settings.lookSpeed);
dragToggle.checked = settings.dragLook;
handsToggle.checked = settings.hands;
splatHandsToggle.checked = settings.splatHands;
rainToggle.checked = settings.rain;

// ---------- Worlds ----------

for (const run of worldRuns) worldSelect.add(new Option(run.label, run.id));
worldSelect.value = params.get('world') ?? LEVEL_RUNS.yard;
if (!worldSelect.value) worldSelect.value = worldRuns[0]?.id ?? '';
resSelect.value = game.resolution;

async function enter(runId: string) {
  params.set('world', runId);
  params.set('res', game.resolution);
  history.replaceState(null, '', `?${params}`);
  try {
    await game.play(runId);
    if (game.world) game.world.colliderView.visible = colliderToggle.checked;
  } catch (error) {
    console.error(error);
    statusEl.textContent = `Failed to load: ${(error as Error).message}`;
  }
}

worldSelect.addEventListener('change', () => enter(worldSelect.value));
resSelect.addEventListener('change', () => {
  game.unloadWorlds();
  game.resolution = resSelect.value;
  void enter(worldSelect.value);
});

// ---------- HUD ----------

colliderToggle.addEventListener('change', () => {
  if (game.world) game.world.colliderView.visible = colliderToggle.checked;
});
flyToggle.addEventListener('change', () => {
  player.fly = flyToggle.checked;
  interactions.enabled = !player.fly;
});
handsToggle.addEventListener('change', () => {
  settings.hands = handsToggle.checked;
  game.saveSettings();
});
splatHandsToggle.addEventListener('change', () => {
  settings.splatHands = splatHandsToggle.checked;
  game.saveSettings();
});
rainToggle.addEventListener('change', () => {
  settings.rain = rainToggle.checked;
  game.saveSettings();
});
dragToggle.addEventListener('change', () => {
  settings.dragLook = dragToggle.checked;
  game.saveSettings();
});
lookSpeedInput.addEventListener('input', () => {
  settings.lookSpeed = Number(lookSpeedInput.value);
  game.saveSettings();
});

// Preview any hand animation (the quest triggers them for real).
const PETTING_PREVIEWS: Record<string, { label: string; strokesPerSecond: number; seconds: number }> = {
  'pet-gentle': { label: 'Pet (slow, calming)', strokesPerSecond: 0.7, seconds: 4 },
  'pet-frantic': { label: 'Pet (fast, frantic)', strokesPerSecond: 2.6, seconds: 3 },
};
for (const [value, { label }] of Object.entries(PETTING_PREVIEWS)) handActionSelect.add(new Option(label, value));
for (const { name, label } of HAND_ACTIONS) handActionSelect.add(new Option(label, name));
let pettingPreview = 0;
handActionSelect.addEventListener('change', () => {
  const choice = handActionSelect.value;
  handActionSelect.value = '';
  const petting = PETTING_PREVIEWS[choice];
  if (petting) {
    const preview = ++pettingPreview;
    hands.startPetting(petting.strokesPerSecond);
    setTimeout(() => preview === pettingPreview && hands.stopPetting(), petting.seconds * 1000);
  } else if (choice) {
    void hands.play(choice as HandAction);
  }
});

// Hand the keyboard back to the game after using the HUD: a focused checkbox would toggle on Space
// (jump) and a focused dropdown would jump to options when letters are typed.
for (const control of document.querySelectorAll<HTMLElement>('#hud input, #hud select')) {
  control.addEventListener('change', () => control.blur());
}
game.onKey = (event) => {
  const toggle = { KeyC: colliderToggle, KeyF: flyToggle, KeyH: handsToggle }[event.code];
  if (!toggle) return;
  toggle.checked = !toggle.checked;
  toggle.dispatchEvent(new Event('change'));
};

const softwareNote = game.quality.softwareRenderer ? ' · no GPU (software rendering)' : '';
game.onFps = (fps) => (fpsEl.textContent = `${Math.round(fps)} fps · ${game.quality.label}${softwareNote}`);

void enter(worldSelect.value);
