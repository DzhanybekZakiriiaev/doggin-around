import {
  CSSProperties,
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useRef,
  useState,
} from "react";

const QUEST_DOG =
  "https://images.unsplash.com/photo-1589317005198-76826b470a72?auto=format&fit=crop&w=1800&q=88";
const FOREST =
  "https://images.unsplash.com/photo-1654587703968-7b8bf8b1c747?auto=format&fit=crop&w=1600&q=84";
const BEACH =
  "https://images.unsplash.com/photo-1690717967633-42ea62146320?auto=format&fit=crop&w=1600&q=84";

type Quest = {
  key: string;
  number: string;
  chapter: string;
  title: string;
  premise: string;
  image: string;
  goal: string;
  story: (name: string) => string;
};

const QUESTS: Quest[] = [
  {
    key: "backyard",
    number: "01",
    chapter: "THE BACKYARD",
    title: "THE MISSING TOY",
    premise: "Something squeaky has vanished...",
    image: QUEST_DOG,
    goal: "FIND THE MISSING TOY",
    story: (name) =>
      `${name}’s favorite toy has disappeared somewhere in this world. Explore together and help them find it.`,
  },
  {
    key: "forest",
    number: "02",
    chapter: "FOREST TRAIL",
    title: "INTO THE WILD",
    premise: "A strange scent drifts out of the trees.",
    image: FOREST,
    goal: "FOLLOW THE SCENT",
    story: (name) =>
      `A strange scent is drifting out of the trees. Follow ${name}’s nose deep into the forest and see where the trail leads.`,
  },
  {
    key: "beach",
    number: "03",
    chapter: "BEACH DAY",
    title: "HIGH TIDE",
    premise: "Sun, surf, and a trail of pawprints.",
    image: BEACH,
    goal: "BEAT THE TIDE",
    story: (name) =>
      `The tide is rolling in fast. Race ${name} along the shore and dig up the buried treasure before the waves wash it away.`,
  },
];

type IconName =
  | "upload"
  | "arrow"
  | "mic"
  | "lock"
  | "spark"
  | "edit"
  | "chevron"
  | "tech"
  | "rotate";

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
    mic: (
      <>
        <rect x="8" y="3" width="8" height="13" rx="4" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="1" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    spark: <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" />,
    edit: (
      <>
        <path d="m14 5 5 5M4 20l3.5-.7L19 7.8 16.2 5 4.7 16.5 4 20Z" />
      </>
    ),
    chevron: <path d="m8 5 7 7-7 7" />,
    tech: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
      </>
    ),
    rotate: (
      <>
        <path d="M4 8c2-4 7-6 11-4l3 2" />
        <path d="m18 2 .5 4.5L14 7" />
        <path d="M20 16c-2 4-7 6-11 4l-3-2" />
        <path d="m6 22-.5-4.5L10 17" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
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

function UploadZone({
  preview,
  onFile,
}: {
  preview: string;
  onFile: (file: File) => void;
}) {
  const { dragging, open, dropProps, inputProps } = useFileDrop(isImage, onFile);

  return (
    <>
      <button
        className={`upload-zone ${dragging ? "upload-zone--dragging" : ""}`}
        onClick={open}
        type="button"
        {...dropProps}
      >
        {preview ? (
          <img alt="Your dog photo" className="upload-thumb" src={preview} />
        ) : (
          <span className="upload-burst">
            <Icon name="upload" size={31} />
          </span>
        )}
        <strong>{preview ? "DOG PHOTO ADDED" : "DRAG & DROP A PHOTO HERE"}</strong>
        <span className="file-type">JPG / PNG</span>
        <span className="upload-tip">
          {preview ? "Click or drop a new photo to replace it" : "Best with a clear, full-body photo"}
        </span>
      </button>
      <input accept="image/jpeg,image/png" {...inputProps} />
    </>
  );
}

function ComicDrop({ comic, onFile }: { comic: ComicFile | null; onFile: (file: File) => void }) {
  const { dragging, open, dropProps, inputProps } = useFileDrop(
    (file) => isImage(file) || file.type === "application/pdf",
    onFile,
  );

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

function DogNameEditor({
  name,
  onChange,
}: {
  name: string;
  onChange: (name: string) => void;
}) {
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
    <button aria-label={name ? `Rename ${name}` : "Name your dog"} className="name-button" onClick={() => setEditing(true)} type="button">
      <span>{name || "NAME YOUR DOG"}</span>
      <Icon name="edit" size={16} />
    </button>
  );
}

function StoryPanel({
  quest,
  chosen,
  onClick,
  onHover,
}: {
  quest: Quest;
  chosen: boolean;
  onClick: () => void;
  onHover: (quest: string | null) => void;
}) {
  return (
    <button
      className={`story-panel story-panel--${quest.key} ${chosen ? "story-panel--chosen" : ""}`}
      onBlur={() => onHover(null)}
      onClick={onClick}
      onFocus={() => onHover(quest.key)}
      onPointerEnter={() => onHover(quest.key)}
      onPointerLeave={() => onHover(null)}
      type="button"
    >
      <img alt="" draggable="false" src={quest.image} />
      <span className="story-shade" />
      <span className="story-status">QUEST {quest.number}</span>
      <span className="story-copy">
        <small>{quest.chapter}</small>
        <strong>{quest.title}</strong>
        <em>{quest.premise}</em>
        <span className="story-enter">
          ENTER PANEL <Icon name="chevron" size={14} />
        </span>
      </span>
    </button>
  );
}

function LockedStoryPanel({ onHover }: { onHover: (quest: string | null) => void }) {
  return (
    <div
      aria-disabled="true"
      className="story-panel story-panel--locked"
      onPointerEnter={() => onHover("locked")}
      onPointerLeave={() => onHover(null)}
    >
      <div className="story-lock">
        <Icon name="lock" size={24} />
        <strong>CLASSIFIED</strong>
        <small>NEW ADVENTURE INCOMING</small>
      </div>
    </div>
  );
}

function ControlHint({ keyName, label }: { keyName: string; label: string }) {
  return (
    <div className="control-hint">
      <kbd>{keyName}</kbd>
      <span>{label}</span>
    </div>
  );
}

function NarrationBox({ children }: { children: ReactNode }) {
  return <div className="narration-box">{children}</div>;
}

function TopBar({ screen }: { screen: number }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => window.location.reload()} type="button">
        <span className="brand-bolt">D</span>
        <span>DOGGIN’<b>AROUND</b></span>
      </button>
      <div className="progress">
        <span>CHAPTER SELECT</span>
        <strong>0{screen}</strong>
        <i>/ 03</i>
      </div>
    </header>
  );
}

function UploadScreen({
  dogImage,
  comic,
  onFile,
  onComic,
  onNext,
}: {
  dogImage: string;
  comic: ComicFile | null;
  onFile: (file: File) => void;
  onComic: (file: File) => void;
  onNext: () => void;
}) {
  const spatial = useSpatialPointer();
  const [uploaded, setUploaded] = useState(false);
  const receiveFile = (file: File) => {
    onFile(file);
    setUploaded(true);
  };
  return (
    <section
      className={`screen upload-screen ${uploaded ? "upload-screen--loaded" : ""}`}
      onPointerMove={spatial.onPointerMove}
      style={spatial.style}
    >
      <SpatialLayers word="BECOME" />
      <TopBar screen={1} />
      <div className="upload-grid">
        <div className="upload-content">
          <ComicHeading
            eyebrow="YOUR LEGEND STARTS HERE"
            subtitle="Bring your dog into the game."
            title="UPLOAD YOUR DOG"
          />
          <UploadZone onFile={receiveFile} preview={dogImage} />
          <div className="upload-actions">
            <GameCTA onClick={onNext}>BRING THEM TO LIFE</GameCTA>
          </div>
        </div>
        <div className="photo-intro">
          {dogImage && (
            <div aria-hidden="true" className="future-dog-silhouette">
              <img src={dogImage} />
            </div>
          )}
          <div aria-hidden="true" className="gaussian-cloud">
            {Array.from({ length: 18 }).map((_, index) => <i key={index} />)}
          </div>
          <div aria-hidden="true" className="photo-speed-lines" />
          <span className="scribble scribble--one">YOUR DOG</span>
          <ComicDrop comic={comic} onFile={onComic} />
          <div className="transform-arrow">
            <span>PHOTO</span>
            <Icon name="arrow" size={25} />
            <strong>HERO</strong>
          </div>
          {dogImage && <span className="impact-word">READY!</span>}
        </div>
      </div>
      <div className="red-slash" />
      <img alt="" aria-hidden="true" className="corner-mascot" src="/otter-boba.gif" />
    </section>
  );
}

function QuestHub({
  dogImage,
  name,
  displayName,
  setName,
  onNext,
}: {
  dogImage: string;
  name: string;
  displayName: string;
  setName: (name: string) => void;
  onNext: (quest: Quest) => void;
}) {
  const spatial = useSpatialPointer();
  const [activeQuest, setActiveQuest] = useState<string | null>(null);
  const [dogRotation, setDogRotation] = useState(0);
  const [dogDrag, setDogDrag] = useState(false);
  const [dogStart, setDogStart] = useState(0);
  const [petting, setPetting] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);

  const selectQuest = (quest: string | null) => {
    if (!entering) setActiveQuest(quest);
  };
  const enterQuest = (quest: Quest) => {
    if (entering) return;
    setActiveQuest(quest.key);
    setEntering(quest.key);
    window.setTimeout(() => onNext(quest), 820);
  };
  const hoveredTitle =
    activeQuest === "locked" ? "CLASSIFIED" : QUESTS.find((quest) => quest.key === activeQuest)?.title;

  return (
    <section
      className={`screen hub-screen quest-focus-${activeQuest ?? "none"} ${entering ? "hub-screen--entering" : ""}`}
      onPointerMove={spatial.onPointerMove}
      style={spatial.style}
    >
      <SpatialLayers word="ADVENTURE" />
      <TopBar screen={2} />
      <div className="hub-header">
        <ComicHeading
          eyebrow="ISSUE NO. 01"
          title="CHOOSE YOUR NEXT ADVENTURE"
        />
      </div>
      <div className="hub-companion">
        <div className="hub-companion-label">
          <small>YOUR COMPANION</small>
          <DogNameEditor name={name} onChange={setName} />
          <span>{activeQuest ? `REACTING: ${activeQuest}` : "READY TO EXPLORE"}</span>
        </div>
        <div
          className="hub-dog-stage"
          onPointerDown={(event) => {
            setDogDrag(true);
            setDogStart(event.clientX - dogRotation);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => dogDrag && setDogRotation(event.clientX - dogStart)}
          onPointerUp={() => setDogDrag(false)}
        >
          <div className="hub-platform"><i /><i /></div>
          <div
            className={`hub-dog hub-dog--${activeQuest ?? "idle"} ${petting ? "hub-dog--petted" : ""}`}
            style={{ transform: `rotateY(${dogRotation / 4 + (activeQuest ? 8 : 0)}deg)` }}
          >
            {dogImage ? (
              <img alt={`${displayName}, waiting to choose an adventure`} draggable="false" src={dogImage} />
            ) : (
              <div className="dog-placeholder">
                <Icon name="upload" size={30} />
                <strong>NO PHOTO YET</strong>
              </div>
            )}
            {petting && <span className="hub-heart">♥</span>}
          </div>
          <button
            aria-label={`Pet ${displayName}`}
            className="hub-pet-target"
            onPointerDown={(event) => { event.stopPropagation(); setPetting(true); }}
            onPointerLeave={() => setPetting(false)}
            onPointerUp={() => setPetting(false)}
            type="button"
          />
        </div>
        <div className="hub-dog-controls">
          <span><Icon name="rotate" size={14} /> DRAG DOG</span>
        </div>
      </div>
      <div className="page-zone">
        <div className="page-zone-title">
          <span>THE QUEST ARCHIVE</span>
        </div>
        <div className="storyboard-wrap">
          <div className={`storyboard ${entering ? "storyboard--entering" : ""}`}>
            {QUESTS.map((quest) => (
              <StoryPanel
                chosen={entering === quest.key}
                key={quest.key}
                onClick={() => enterQuest(quest)}
                onHover={selectQuest}
                quest={quest}
              />
            ))}
            <LockedStoryPanel onHover={selectQuest} />
          </div>
        </div>
        {hoveredTitle && !entering && (
          <div className="floating-quest-caption" key={activeQuest}>
            <small>{activeQuest === "locked" ? "ARCHIVE PREVIEW" : "CLICK TO ENTER"}</small>
            <strong>{hoveredTitle}</strong>
          </div>
        )}
      </div>
      <span className="hub-caption">CHOOSE TOGETHER. STEP THROUGH.</span>
    </section>
  );
}

function QuestIntro({ dogImage, name, quest }: { dogImage: string; name: string; quest: Quest }) {
  const [entered, setEntered] = useState(false);
  const spatial = useSpatialPointer();
  const story = quest.story(name || "your dog");
  return (
    <section
      className={`screen intro-screen ${entered ? "intro-screen--entered" : ""}`}
      onPointerMove={spatial.onPointerMove}
      style={spatial.style}
    >
      <SpatialLayers word="PORTAL" />
      <TopBar screen={3} />
      <div className="world-panel">
        <img alt={`${quest.chapter.toLowerCase()} quest world`} src={quest.image} />
        <div className="world-vignette" />
        <div className="speed-streaks" />
        {dogImage && (
          <div className="quest-dog">
            <img alt={`${name || "Your dog"} inside the quest world`} src={dogImage} />
          </div>
        )}
        <div className="issue-badge">
          <small>DOGGIN’ AROUND</small>
          <strong>QUEST {quest.number}</strong>
        </div>
        <div className="intro-copy">
          <span className="chapter-label">{quest.chapter}</span>
          <NarrationBox>
            <strong>{quest.title}</strong>
            <span>{story.charAt(0).toUpperCase() + story.slice(1)}</span>
          </NarrationBox>
        </div>
        <div className="controls">
          <ControlHint keyName="WASD" label="MOVE" />
          <ControlHint keyName="Q" label="CALL DOG" />
          <ControlHint keyName="V" label="HOLD TO TALK" />
          <ControlHint keyName="E" label="INTERACT" />
        </div>
        <GameCTA className="enter-quest" onClick={() => setEntered(true)}>
          STEP INTO THE PANEL
        </GameCTA>
        {entered && (
          <div className="quest-started">
            <span>QUEST START</span>
            <strong>{quest.goal}</strong>
          </div>
        )}
      </div>
    </section>
  );
}

const TRANSITION_MS = 950;

export default function App() {
  const [screen, setScreen] = useState(1);
  const [wipeTo, setWipeTo] = useState<number | null>(null);
  const [dogImage, setDogImage] = useState("");
  const [comic, setComic] = useState<ComicFile | null>(null);
  const [dogName, setDogName] = useState("");
  const displayName = dogName.trim() || "YOUR DOG";
  const [quest, setQuest] = useState(QUESTS[0]);

  // A panel sweeps across, the screen swaps while it's covered, then it sweeps off.
  const next = () => {
    if (wipeTo !== null || screen >= 3) return;
    const target = screen + 1;
    setWipeTo(target);
    window.setTimeout(() => {
      setScreen(target);
      window.scrollTo(0, 0);
    }, TRANSITION_MS / 2);
    window.setTimeout(() => setWipeTo(null), TRANSITION_MS);
  };

  const setFile = (file: File) => {
    if (dogImage) URL.revokeObjectURL(dogImage);
    setDogImage(URL.createObjectURL(file));
  };

  const setComicFile = (file: File) => {
    if (comic) URL.revokeObjectURL(comic.url);
    setComic({ url: URL.createObjectURL(file), name: file.name, isImage: isImage(file) });
  };

  return (
    <main className={`game-shell screen-${screen}`}>
      {screen === 1 && <UploadScreen comic={comic} dogImage={dogImage} onComic={setComicFile} onFile={setFile} onNext={next} />}
      {screen === 2 && (
        <QuestHub
          dogImage={dogImage}
          name={dogName}
          displayName={displayName}
          setName={setDogName}
          onNext={(chosen) => {
            setQuest(chosen);
            next();
          }}
        />
      )}
      {screen === 3 && <QuestIntro dogImage={dogImage} name={dogName.trim()} quest={quest} />}
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
