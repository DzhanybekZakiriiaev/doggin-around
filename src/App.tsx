import {
  CSSProperties,
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Game } from "./game/game";

// The menu around the walkable comic. Page 1: upload your comic. Page 2: Biscuit (the real splat dog,
// rendered by the game) and the Storm Night comic, bad ending first. Panel 1 is entered: Biscuit leaps in,
// the panel fills the screen and dissolves into the game, which has been loading behind the menu all along.
// Finishing the quest brings you back to page 2, where the comic now ends well.

type Ending = "bad" | "good";

type ComicPanel = {
  key: string;
  number: string;
  image: Record<Ending, string>;
  caption: Record<Ending, string>;
  bubble?: Partial<Record<Ending, string>>;
  sfx?: Partial<Record<Ending, string>>;
  badge?: Record<Ending, string>;
};

const OUTCOME_PANELS: ComicPanel[] = [
  {
    key: "two",
    number: "02",
    image: { bad: "/comic/panel-2-bad.jpg", good: "/comic/panel-2-good.jpg" },
    caption: { bad: "Hours in the rain. No key.", good: "He remembered where." },
    bubble: { good: "Biscuit, dig!" },
  },
  {
    key: "three",
    number: "03",
    image: { bad: "/comic/panel-3-bad.jpg", good: "/comic/panel-3-good.jpg" },
    caption: { bad: "Then the thunder came.", good: "The spare key!" },
    sfx: { bad: "KRA-KOOM!", good: "CLICK!" },
  },
  {
    key: "four",
    number: "04",
    image: { bad: "/comic/panel-4-bad.jpg", good: "/comic/panel-4-good.jpg" },
    caption: { bad: "She searched all night.", good: "Home, dry and warm." },
    bubble: { bad: "BISCUIT!" },
    sfx: { good: "zzz…" },
  },
  {
    key: "five",
    number: "05",
    image: { bad: "/comic/panel-5-bad.jpg", good: "/comic/panel-5-good.jpg" },
    caption: { bad: "Just his bandana.", good: "A hook for the key." },
    badge: { bad: "THE END?", good: "THE END" },
  },
];

// One game for the page's lifetime (React's strict mode mounts effects twice in development).
let gamePromise: Promise<Game> | undefined;
const getGame = (onStatus: (message: string) => void) =>
  (gamePromise ??= Game.create({ quest: true, hidden: true, onStatus }));

type IconName = "upload" | "arrow" | "edit" | "chevron" | "rotate" | "lock";

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    upload: (
      <>
        <path d="M12 16V3m0 0L7 8m5-5 5 5" />
        <path d="M5 13v6h14v-6" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h15" />
        <path d="m14 6 6 6-6 6" />
      </>
    ),
    edit: (
      <>
        <path d="m14 5 5 5M4 20l3.5-.7L19 7.8 16.2 5 4.7 16.5 4 20Z" />
      </>
    ),
    chevron: <path d="m8 5 7 7-7 7" />,
    rotate: (
      <>
        <path d="M4 8c2-4 7-6 11-4l3 2" />
        <path d="m18 2 .5 4.5L14 7" />
        <path d="M20 16c-2 4-7 6-11 4l-3-2" />
        <path d="m6 22-.5-4.5L10 17" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="1" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        {paths[name]}
      </g>
    </svg>
  );
}

type SpatialStyle = CSSProperties & {
  "--pointer-x": string;
  "--pointer-y": string;
};

function useSpatialPointer() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
      y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
    });
  };
  const style = {
    "--pointer-x": pointer.x.toFixed(3),
    "--pointer-y": pointer.y.toFixed(3),
  } as SpatialStyle;
  return { onPointerMove, style };
}

function SpatialLayers({ word }: { word: string }) {
  return (
    <div aria-hidden="true" className="spatial-layers">
      <div className="depth-layer depth-layer--far">
        <span className="depth-word">{word}</span>
        <i className="distant-panel distant-panel--one" />
        <i className="distant-panel distant-panel--two" />
      </div>
      <div className="depth-layer depth-layer--mid">
        <i className="ink-orbit ink-orbit--one" />
        <i className="ink-orbit ink-orbit--two" />
      </div>
      <div className="depth-layer depth-layer--near">
        <i className="foreground-slash foreground-slash--one" />
        <i className="foreground-slash foreground-slash--two" />
      </div>
    </div>
  );
}

function ComicHeading({
  eyebrow,
  title,
  subtitle,
  light = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  light?: boolean;
}) {
  return (
    <div className={`comic-heading ${light ? "comic-heading--light" : ""}`}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

function GameCTA({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button className={`game-cta ${className}`} onClick={onClick} type="button">
      <span>{children}</span>
      <Icon name="arrow" size={22} />
    </button>
  );
}

type ComicFile = {
  url: string;
  name: string;
  isImage: boolean;
};

// Click-to-browse plus drag-and-drop for a single file
function useFileDrop(accepts: (file: File) => boolean, onFile: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const take = (file: File | undefined) => {
    if (file && accepts(file)) onFile(file);
  };
  return {
    dragging,
    open: () => inputRef.current?.click(),
    dropProps: {
      onDragEnter: () => setDragging(true),
      onDragLeave: () => setDragging(false),
      onDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(),
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDragging(false);
        take(event.dataTransfer.files[0]);
      },
    },
    inputProps: {
      ref: inputRef,
      className: "visually-hidden",
      type: "file",
      tabIndex: -1,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        take(event.target.files?.[0]);
        event.target.value = "";
      },
    },
  };
}

const isImage = (file: File) => file.type.startsWith("image/");
const isComic = (file: File) => isImage(file) || file.type === "application/pdf";

function UploadZone({ comic, onFile }: { comic: ComicFile | null; onFile: (file: File) => void }) {
  const { dragging, open, dropProps, inputProps } = useFileDrop(isComic, onFile);

  return (
    <>
      <button
        className={`upload-zone ${dragging ? "upload-zone--dragging" : ""}`}
        onClick={open}
        type="button"
        {...dropProps}
      >
        {comic?.isImage ? (
          <img alt="Your comic" className="upload-thumb" src={comic.url} />
        ) : (
          <span className="upload-burst">
            <Icon name="upload" size={31} />
          </span>
        )}
        <strong>{comic ? "COMIC ADDED" : "DRAG & DROP YOUR COMIC HERE"}</strong>
        <span className="file-type">JPG / PNG / PDF</span>
        <span className="upload-tip">
          {comic ? `${comic.name} · click or drop to replace it` : "A page or a single panel works best"}
        </span>
      </button>
      <input accept="image/*,application/pdf" {...inputProps} />
    </>
  );
}

function ComicDrop({ comic, onFile }: { comic: ComicFile | null; onFile: (file: File) => void }) {
  const { dragging, open, dropProps, inputProps } = useFileDrop(isComic, onFile);

  return (
    <>
      <button
        aria-label={comic ? `Replace your comic (${comic.name})` : "Upload a comic"}
        className={`photo-frame ${comic ? "photo-frame--loaded" : ""} ${dragging ? "photo-frame--dragging" : ""}`}
        onClick={open}
        type="button"
        {...dropProps}
      >
        <div className="photo-frame__inner">
          {comic?.isImage ? (
            <>
              <img alt={`Your comic: ${comic.name}`} src={comic.url} />
              <span className="scan-line" />
            </>
          ) : comic ? (
            <div className="comic-file">
              <Icon name="upload" size={34} />
              <strong>COMIC LOADED</strong>
              <small>{comic.name}</small>
            </div>
          ) : (
            <img
              alt="Comic: a cheerful dog says “Upload a comic here” while a dog in glasses replies “I’m waiting…”"
              className="photo-placeholder"
              src="/upload-placeholder.png"
            />
          )}
          <span className="photo-frame__cta">
            <Icon name="upload" size={16} /> {comic ? "REPLACE COMIC" : "CLICK OR DROP YOUR COMIC"}
          </span>
        </div>
      </button>
      <input accept="image/*,application/pdf" {...inputProps} />
    </>
  );
}

function DogNameEditor({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <input
      aria-label="Dog name"
      autoFocus
      className="name-input"
      maxLength={14}
      onBlur={() => setEditing(false)}
      onChange={(event) => onChange(event.target.value.toUpperCase())}
      onKeyDown={(event) => event.key === "Enter" && setEditing(false)}
      value={name}
    />
  ) : (
    <button aria-label={`Rename ${name}`} className="name-button" onClick={() => setEditing(true)} type="button">
      <span>{name}</span>
      <Icon name="edit" size={16} />
    </button>
  );
}

function TopBar({ screen, loading }: { screen: number; loading: string }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => window.location.reload()} type="button">
        <span className="brand-bolt">D</span>
        <span>
          DOGGIN’<b>AROUND</b>
        </span>
      </button>
      <div className="progress">
        <span className={`world-status ${loading ? "" : "world-status--ready"}`}>{loading || "WORLD READY"}</span>
        <span>CHAPTER</span>
        <strong>0{screen}</strong>
        <i>/ 02</i>
      </div>
    </header>
  );
}

function UploadScreen({
  comic,
  loading,
  onComic,
  onNext,
}: {
  comic: ComicFile | null;
  loading: string;
  onComic: (file: File) => void;
  onNext: () => void;
}) {
  const spatial = useSpatialPointer();
  return (
    <section
      className={`screen upload-screen ${comic ? "upload-screen--loaded" : ""}`}
      onPointerMove={spatial.onPointerMove}
      style={spatial.style}
    >
      <SpatialLayers word="BECOME" />
      <TopBar loading={loading} screen={1} />
      <div className="upload-grid">
        <div className="upload-content">
          <ComicHeading
            eyebrow="YOUR LEGEND STARTS HERE"
            subtitle="Turn your comic into a world you can walk into."
            title="UPLOAD YOUR COMIC"
          />
          <UploadZone comic={comic} onFile={onComic} />
          <div className="upload-actions">
            <GameCTA onClick={onNext}>BRING IT TO LIFE</GameCTA>
          </div>
        </div>
        <div className="photo-intro">
          <div aria-hidden="true" className="gaussian-cloud">
            {Array.from({ length: 18 }).map((_, index) => (
              <i key={index} />
            ))}
          </div>
          <div aria-hidden="true" className="photo-speed-lines" />
          <span className="scribble scribble--one">YOUR COMIC</span>
          <ComicDrop comic={comic} onFile={onComic} />
          <div className="transform-arrow">
            <span>COMIC</span>
            <Icon name="arrow" size={25} />
            <strong>WORLD</strong>
          </div>
          {comic && <span className="impact-word">READY!</span>}
        </div>
      </div>
      <div className="red-slash" />
      <img alt="" aria-hidden="true" className="corner-mascot" src="/otter-boba.gif" />
    </section>
  );
}

// Biscuit himself: the game draws its splat dog over this box (idling, wagging now and then).
// Drag (or arrow keys) to turn him, tap (or Enter) to make him wag.
function LiveDog({ game, name }: { game: Game | null; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef({ x: 0, moved: false, active: false });
  const [petting, setPetting] = useState(false);
  const petTimer = useRef(0);

  useEffect(() => {
    if (!game || !box.current) return;
    game.showcase(box.current);
    return () => {
      if (game.mode === "showcase") game.hide();
    };
  }, [game]);
  useEffect(() => () => window.clearTimeout(petTimer.current), []);

  const pet = () => {
    game?.petDog();
    setPetting(true);
    window.clearTimeout(petTimer.current);
    petTimer.current = window.setTimeout(() => setPetting(false), 900);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      game?.spinDog(event.key === "ArrowLeft" ? -0.35 : 0.35);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pet();
    }
  };

  return (
    <div
      aria-label={`${name}, your companion. Drag or use the arrow keys to turn him, press Enter to pet.`}
      className={`dog-viewer ${drag.current.active ? "dog-viewer--dragging" : ""}`}
      onKeyDown={onKeyDown}
      onPointerCancel={() => (drag.current.active = false)}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, moved: false, active: true };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state.active) return;
        const dx = event.clientX - state.x;
        if (Math.abs(dx) > 3) state.moved = true;
        state.x = event.clientX;
        game?.spinDog(dx * 0.012);
      }}
      onPointerUp={() => {
        drag.current.active = false;
        if (!drag.current.moved) pet();
      }}
      role="img"
      tabIndex={0}
    >
      <div className="hub-dog-stage">
        <div className="hub-platform">
          <i />
          <i />
        </div>
        <div className="live-dog" ref={box}>
          {!game && <span className="live-dog__waking">WAKING {name} UP…</span>}
          {petting && <span className="hub-heart">♥</span>}
        </div>
      </div>
      <p className="dog-viewer-hint">
        <Icon name="rotate" size={14} /> DRAG TO TURN · TAP TO PET
      </p>
    </div>
  );
}

// The comic as a printed page: slanted ink frames and uneven gutters, lettered narration, speech bubbles and
// sound effects. Panel 1 is the way in.
function ComicPage({
  ending,
  redraw,
  entering,
  onEnter,
}: {
  ending: Ending;
  redraw: boolean;
  entering: boolean;
  onEnter: (panel: HTMLElement) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const caption = hovered === "one" ? "STEP INTO THE PANEL" : hovered ? "HOW IT ENDS…" : null;
  const focus = (key: string | null) => !entering && setHovered(key);
  return (
    <>
      <div className="storyboard-wrap">
        <div className={`comic-sheet ${entering ? "comic-sheet--entering" : ""}`}>
          <button
            aria-label="Step into panel 1: Biscuit sits muddy-pawed by a fresh hole outside the locked cabin"
            className={`comic-cell comic-cell--one ${entering ? "comic-cell--chosen" : ""}`}
            onBlur={() => focus(null)}
            onClick={(event) => onEnter(event.currentTarget)}
            onFocus={() => focus("one")}
            onPointerEnter={() => focus("one")}
            onPointerLeave={() => focus(null)}
            type="button"
          >
            <span className="comic-frame">
              <span className="comic-art">
                <img alt="" draggable="false" src="/comic/panel-1.jpg" />
              </span>
            </span>
            <span className="comic-sfx">KRAK!</span>
            <span className="comic-caption comic-caption--top">The keys are gone. The storm is coming.</span>
            <span className="comic-burst">
              <span>STEP IN!</span>
            </span>
          </button>
          {OUTCOME_PANELS.map((panel) => (
            <div
              className={`comic-cell comic-cell--${panel.key} comic-cell--outcome ${redraw ? "comic-cell--redraw" : ""}`}
              key={`${panel.key}-${ending}`}
              onPointerEnter={() => focus(panel.key)}
              onPointerLeave={() => focus(null)}
            >
              <span className="comic-frame">
                <span className="comic-art">
                  <img alt="" draggable="false" src={panel.image[ending]} />
                </span>
              </span>
              {panel.bubble?.[ending] && <span className="comic-bubble">{panel.bubble[ending]}</span>}
              {panel.sfx?.[ending] && <span className="comic-sfx comic-sfx--small">{panel.sfx[ending]}</span>}
              <span className="comic-caption">{panel.caption[ending]}</span>
              {panel.badge && <span className={`end-badge end-badge--${ending}`}>{panel.badge[ending]}</span>}
            </div>
          ))}
        </div>
      </div>
      {caption && !entering && (
        <div className="floating-quest-caption" key={hovered}>
          <small>{hovered === "one" ? "CLICK TO ENTER" : ending === "bad" ? "UNLESS SOMEONE CHANGES IT" : "YOU CHANGED IT"}</small>
          <strong>{caption}</strong>
        </div>
      )}
    </>
  );
}

// Where Biscuit is painted in panel 1 (his paws, and his height, as fractions of the painting), on screen:
// the panel shows the painting with object-fit: cover.
const PAINTED_BISCUIT = { x: 0.565, y: 0.895, height: 0.273 };

function paintedBiscuit(art: HTMLImageElement) {
  const rect = art.getBoundingClientRect();
  const scale = Math.max(rect.width / (art.naturalWidth || 16), rect.height / (art.naturalHeight || 9));
  const width = (art.naturalWidth || 16) * scale;
  const height = (art.naturalHeight || 9) * scale;
  return {
    x: rect.left + (rect.width - width) / 2 + PAINTED_BISCUIT.x * width,
    y: rect.top + (rect.height - height) / 2 + PAINTED_BISCUIT.y * height,
    height: PAINTED_BISCUIT.height * height,
  };
}

function ComicHub({
  game,
  name,
  setName,
  ending,
  redraw,
  loading,
  onEnter,
}: {
  game: Game | null;
  name: string;
  setName: (name: string) => void;
  ending: Ending;
  redraw: boolean;
  loading: string;
  onEnter: (panel: HTMLElement) => void;
}) {
  const spatial = useSpatialPointer();
  const [entering, setEntering] = useState(false);

  // Biscuit leaps off his stand into panel 1, landing where he's painted, then the panel takes over.
  const enter = async (panel: HTMLElement) => {
    if (entering || !game) return;
    setEntering(true);
    game.capturePointer(); // this click is the user gesture mouse look needs; the game opens already looking
    const art = panel.querySelector("img");
    if (art) await game.leapInto(paintedBiscuit(art));
    onEnter(panel);
  };

  return (
    <section
      className={`screen hub-screen ${entering ? "hub-screen--entering" : ""}`}
      onPointerMove={spatial.onPointerMove}
      style={spatial.style}
    >
      <SpatialLayers word="STORM" />
      <TopBar loading={loading} screen={2} />
      <div className="hub-header">
        <ComicHeading eyebrow="ISSUE NO. 01" title="STORM NIGHT" />
      </div>
      <div className="hub-companion">
        <div className="hub-companion-label">
          <small>YOUR COMPANION</small>
          <DogNameEditor name={name} onChange={setName} />
          <span>{ending === "good" ? "HOME AND HAPPY" : "READY TO JUMP IN"}</span>
        </div>
        <LiveDog game={game} name={name} />
      </div>
      <div className="page-zone">
        <div className="page-zone-title">
          <span>{ending === "good" ? "THE NEW ENDING" : "THE COMIC"}</span>
        </div>
        <ComicPage ending={ending} entering={entering} onEnter={(panel) => void enter(panel)} redraw={redraw} />
      </div>
      <span className="hub-caption">STEP INTO PANEL ONE. CHANGE THE ENDING.</span>
    </section>
  );
}

function QuestComplete({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <div className="quest-complete" role="dialog" aria-label="Quest complete">
      <div className="quest-complete__card">
        <span className="quest-complete__eyebrow">STORM NIGHT · QUEST COMPLETE</span>
        <img alt="" src="/comic/panel-2-good.jpg" />
        <strong>{name} DUG UP THE KEY!</strong>
        <p>Everyone’s inside, dry and warm. The comic has a new ending.</p>
        <GameCTA onClick={onBack}>BACK TO THE COMIC</GameCTA>
      </div>
    </div>
  );
}

const SPLASH_MS = 2300;

// Opening title card: the logo pops in, then the card splits at the seam to reveal the first page
function IntroSplash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  const logo = (
    <div className="splash-logo">
      <span className="brand-bolt">D</span>
      <span>
        DOGGIN’<b>AROUND</b>
      </span>
    </div>
  );

  return (
    <div aria-label="Doggin’ Around" className="intro-splash" onClick={onDone} role="presentation">
      <div aria-hidden="true" className="splash-half splash-half--top">
        {logo}
      </div>
      <div aria-hidden="true" className="splash-half splash-half--bottom">
        {logo}
      </div>
      <span aria-hidden="true" className="splash-seam" />
    </div>
  );
}

const TRANSITION_MS = 950;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type Portal = { rect: DOMRect; phase: "start" | "fill" | "morph" | "fade"; step: number };

export default function App() {
  const [screen, setScreen] = useState<1 | 2 | "game">(1);
  const [splash, setSplash] = useState(true);
  const endSplash = useRef(() => setSplash(false)).current;
  const [wipeTo, setWipeTo] = useState<number | null>(null);
  const [comic, setComic] = useState<ComicFile | null>(null);
  const [dogName, setDogName] = useState("BISCUIT");
  const displayName = dogName.trim() || "BISCUIT";
  const [ending, setEnding] = useState<Ending>("bad");
  const [redraw, setRedraw] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState("WAKING UP THE WORLD…");
  const [portal, setPortal] = useState<Portal | null>(null);
  const [complete, setComplete] = useState(false);

  // Start the game straight away: it loads and warms up the worlds behind the menu.
  useEffect(() => {
    let alive = true;
    getGame((message) => {
      const percent = message.match(/(\d+)%/)?.[1];
      if (alive && percent) setLoading(`LOADING THE WORLD ${percent}%`);
    })
      .then(async (created) => {
        if (!alive) return;
        setGame(created);
        await created.preload();
        if (alive) setLoading("");
      })
      .catch((error) => {
        console.error(error);
        if (alive) setLoading("THE WORLD DIDN’T LOAD");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!game) return;
    game.onQuestComplete = () => setComplete(true);
  }, [game]);

  // A panel sweeps across, the screen swaps while it's covered, then it sweeps off.
  const wipe = (target: 1 | 2, label: number) => {
    if (wipeTo !== null) return;
    setWipeTo(label);
    window.setTimeout(() => {
      setScreen(target);
      window.scrollTo(0, 0);
    }, TRANSITION_MS / 2);
    window.setTimeout(() => setWipeTo(null), TRANSITION_MS);
  };

  const setComicFile = (file: File) => {
    if (comic) URL.revokeObjectURL(comic.url);
    setComic({ url: URL.createObjectURL(file), name: file.name, isImage: isImage(file) });
  };

  // Into panel 1: Biscuit leaps in, the panel grows to fill the screen, the game starts behind it (already
  // loaded, at the same view the panel is drawn from), and the panel dissolves into it.
  // Out of panel 1 and into the game: the panel fills the screen, then dissolves through two Gemini-painted
  // frames of the game's opening view (comic, then half-way) into a capture of that view, which holds until
  // the live game behind it has really drawn the yard; then it fades into the identical live picture.
  const enterPanel = async (panel: HTMLElement) => {
    if (!game) return;
    setPortal({ rect: panel.getBoundingClientRect(), phase: "start", step: 0 });
    await nextFrame();
    await nextFrame();
    setPortal((current) => current && { ...current, phase: "fill" });
    await sleep(800);
    // Only now (the panel covering the screen) start the game: its first frames are heavy, and the grow
    // above must not stutter. The cross-fades below run on the compositor while it gets going.
    const live = (async () => {
      await game.preload();
      await game.play();
      game.player.inputEnabled = false; // hold the view on the frame being faded into
      await game.whenDrawn();
    })();
    for (const step of [1, 2, 3]) {
      setPortal((current) => current && { ...current, phase: "morph", step });
      await sleep(step === 1 ? 650 : 520);
    }
    await live;
    setScreen("game");
    setPortal((current) => current && { ...current, phase: "fade" });
    await sleep(650);
    game.player.inputEnabled = true;
    setPortal(null);
  };

  const backToComic = () => {
    setComplete(false);
    setEnding("good");
    setRedraw(true);
    window.setTimeout(() => setRedraw(false), 2400);
    game?.hide();
    setScreen(2);
  };

  return (
    <main className={`game-shell screen-${screen}`}>
      {screen === 1 && (
        <UploadScreen comic={comic} loading={loading} onComic={setComicFile} onNext={() => wipe(2, 2)} />
      )}
      {screen === 2 && (
        <ComicHub
          ending={ending}
          game={game}
          loading={loading}
          name={displayName}
          onEnter={(panel) => void enterPanel(panel)}
          redraw={redraw}
          setName={setDogName}
        />
      )}
      {portal && (
        <div
          aria-hidden="true"
          className={`panel-portal panel-portal--${portal.phase}`}
          style={
            portal.phase === "start"
              ? { left: portal.rect.left, top: portal.rect.top, width: portal.rect.width, height: portal.rect.height }
              : undefined
          }
        >
          {/* Bottom to top: the game's opening view, then the in-betweens, then the panel itself. */}
          <img alt="" className="portal-frame" src="/comic/transition/game-start.jpg" />
          <img alt="" className={`portal-frame ${portal.step >= 3 ? "portal-frame--gone" : ""}`} src="/comic/transition/blend-2.jpg" />
          <img alt="" className={`portal-frame ${portal.step >= 2 ? "portal-frame--gone" : ""}`} src="/comic/transition/blend-1.jpg" />
          <img alt="" className={`portal-frame portal-frame--panel ${portal.step >= 1 ? "portal-frame--gone" : ""}`} src="/comic/panel-1.jpg" />
        </div>
      )}
      {complete && <QuestComplete name={displayName} onBack={backToComic} />}
      {splash && <IntroSplash onDone={endSplash} />}
      {wipeTo !== null && (
        <div aria-hidden="true" className="screen-wipe">
          <div className="screen-wipe__panel" />
          <div className="screen-wipe__label">
            <small>CHAPTER</small>
            <strong>0{wipeTo}</strong>
          </div>
        </div>
      )}
    </main>
  );
}
