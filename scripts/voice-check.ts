// Checks the spoken-command parser (src/voice/commands.ts) without a browser or a microphone:
//
//   npm run voice-check
//
// Worth running after touching the phrase table. The fuzzy repair is the part that bites: a new keyword can
// quietly pull a word away from an old one ("pet" sits one edit from "set", which used to mean sit), and the
// parser drops anything it can't decide between rather than guessing, so the loss is silent.
import { readFileSync } from 'node:fs';
import { CommandStream, normalize, parseUtterance, type VoiceCommand } from '../src/voice/commands.ts';

// Read out of dog.ts rather than imported from it: that module pulls in three.js and the splat renderer,
// which want a browser. Only the clip names are needed here.
const dogSource = readFileSync(new URL('../src/game/dog/dog.ts', import.meta.url), 'utf8');
const DOG_ACTIONS = [...dogSource.matchAll(/{ name: ["'](\w+)["']/g)].map(([, clip]) => clip);

let failures = 0;

function fail(message: string) {
  failures++;
  console.log(`  ✗ ${message}`);
}

const name = (command: VoiceCommand) => (command.kind === 'action' ? command.action : command.kind);
const intents = (text: string) => parseUtterance(text).commands.map(name);

/** What `text` must be understood as, in spoken order. */
function heard(text: string, expected: string[]) {
  const got = intents(text);
  if (got.join() !== expected.join()) fail(`“${text}” → [${got}], expected [${expected}]`);
}

console.log('every command, spoken a few ways');
heard('sit', ['sit']);
heard('Biscuit, sit!', ['sit']);
heard('Um, okay, sit down please', ['sit']);
heard('stay', ['idle']);
heard('stand up', ['stand']);
heard('jump', ['jump']);
heard('jump up', ['jump']);
heard('do a backflip', ['backflip']);
heard('flip', ['backflip']);
heard('bark', ['bark']);
heard('speak', ['speak']);
heard('spin around', ['spin']);
heard('turn around', ['spin']);
heard('play bow', ['playbow']);
heard('bow', ['playbow']);
heard('shake hands', ['shake']);
heard('give me your paw', ['paw']);
heard('high five', ['highfive']);
heard('lie down', ['down']);
heard('sit down', ['sit']);
heard('touch', ['touch']);
heard('be quiet', ['quiet']);
heard('roll over', ['rollover']);
heard('crawl', ['crawl']);
heard('back up', ['backup']);
heard('come back', ['come']);
heard('sit pretty', ['beg']);
heard('beg', ['beg']);
heard('play dead', ['playdead']);
heard('bang!', ['playdead']);
heard('leg weaves', ['weave']);
heard('hold it', ['hold']);
heard('Biscuit, Gangnam style!', ['gangnam']);
heard('gang nam style', ['gangnam']);
heard('gangham style', ['gangnam']);
// Only its own name starts Gangnam style (and its music).
heard('dance', []);
heard('dance for me', []);
heard('party', []);
heard('walk', ['walk']);
heard('walk with me', ['come']);
heard('run around', ['run']);
heard('dig', ['dig']);
heard('Biscuit, dig!', ['dig']);
heard('dig it up', ['dig']);
heard('sniff around', ['sniff']);
heard('find it', ['sniff']);
heard('good boy', ['wag']);
heard('wag your tail', ['wag']);
heard('pet', ['pet']);
heard('let me pet you', ['pet']);
heard('belly rub', ['pet']);
heard('come here', ['come']);
heard('heel', ['come']);
heard('fetch', ['fetch']);
heard('throw it', ['fetch']);
heard('stop it', ['stop']);
heard('drop it', ['stop']);
heard('leave it', ['stop']);

console.log('mishearings and inflections');
for (const [spoken, meant] of [
  ['sid', 'sit'],
  ['set', 'sit'],
  ['sitting', 'sit'],
  ['spinning', 'spin'],
  ['barks', 'bark'],
  ['dug', 'dig'],
  ['digs', 'dig'],
  ['flipping', 'backflip'],
  ['rolling', 'rollover'],
  ['crawling', 'crawl'],
  ['begging', 'beg'],
] as const)
  heard(spoken, [meant]);

console.log('guesses it must refuse');
// "park" is one edit from bark, "it" from sit, "top" from stop, "pow" from both paw and bow; "big" and "bed"
// from beg, "hole" from hold, "couch" from touch, "rub" from run, "bag" from bang, "role" from roll.
for (const word of ['park', 'fun', 'it', 'balk', 'top', 'pow', 'wig', 'big', 'get', 'let', 'bed', 'hole', 'couch', 'rub', 'bag', 'role'])
  heard(word, []);

console.log('sequences, repeats and nonsense');
heard('sit then bark then spin', ['sit', 'bark', 'spin']);
heard('come here and sit', ['come', 'sit']);
heard('sit sit sit', ['sit']);
heard('what a lovely afternoon', []);
heard('', []);

console.log('his name and the fillers are dropped');
if (normalize('Um, okay — can you please SIT, Biscuit?').join(' ') !== 'sit')
  fail(`normalize: [${normalize('Um, okay — can you please SIT, Biscuit?')}]`);

console.log('only what the parser cannot resolve goes to the language model');
for (const [text, escalate] of [
  ['go grab that stick by the fireplace', true],
  ['put the branch on the fire', true],
  ['sit over by the door', true],
  ['sit', false],
  ['Biscuit, dig!', false],
  ['good boy', false],
  ['come here and sit', false],
] as const)
  if (parseUtterance(text).escalate !== escalate) fail(`escalate “${text}” → ${!escalate}`);

console.log('every trick on the emote wheel can be asked for out loud')
// Peekaboo is on no companion's wheel (Hua's clip is left out, Wei has none), so it has nothing to say to it.
const SPOKEN_FOR: Record<string, string | null> = {
  idle: 'stay',
  walk: 'walk',
  run: 'run',
  sit: 'sit',
  jump: 'jump',
  backflip: 'backflip',
  bark: 'bark',
  paw: 'give me your paw',
  spin: 'spin around',
  playbow: 'play bow',
  sniff: 'sniff around',
  dig: 'dig',
  wag: 'good boy',
  stand: 'stand up',
  down: 'lie down',
  shake: 'shake hands',
  highfive: 'high five',
  touch: 'touch',
  speak: 'speak',
  quiet: 'quiet',
  rollover: 'roll over',
  crawl: 'crawl',
  backup: 'back up',
  beg: 'beg',
  playdead: 'play dead',
  peekaboo: null,
  weave: 'weave',
  hold: 'hold it',
  gangnam: 'gangnam style',
};
if (!DOG_ACTIONS.length) fail('no clips found in dog.ts');
for (const action of DOG_ACTIONS) if (!(action in SPOKEN_FOR)) fail(`${action} is a clip with nothing to say to it`);
for (const [action, phrase] of Object.entries(SPOKEN_FOR)) {
  if (!DOG_ACTIONS.includes(action)) fail(`${action} is no longer a dog action`)
  if (phrase === null) continue;
  if (intents(phrase)[0] !== action) fail(`“${phrase}” does not reach ${action}`);
}

console.log('a partial fires once, and the commit does not repeat it');
const stream = new CommandStream();
const fired = [
  stream.next('si'),
  stream.next('sit'),
  stream.next('sit'),
  stream.next('sit and bark'),
  stream.next('sit and bark'),
].map((commands) => commands.map(name).join());
if (fired.join('|') !== ['', 'sit', '', 'bark', ''].join('|')) fail(`stream fired [${fired}]`);

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exitCode = failures ? 1 : 0;
