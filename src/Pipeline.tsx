import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Game } from "./game/game";
import "./pipeline.css";

// Between the upload and the comic: bringing Biscuit to life, played as a comic page in 23 seconds.
// 1. Gemini reads the page, boxes the characters and lifts the hero out of panel 1;
// 2. paints him from every side as a wireframe (the 3D model taking shape);
// then the game's own Biscuit, drawn live by the game on the stage:
// 3. his mesh in X-ray with the rig lit up inside; 4. the mesh; 5. the Gaussian splats applied over it;
// 6. the splat dog walking on the rig, then running (his own clips).
// The stills are Gemini's (npm run pipeline-art); strips rendered from his model (tools/pipeline-frames.html)
// stand in until the game has him loaded. The timings are fixed and the figures in the log are the real
// model's.

export const PIPELINE_SECONDS = 23;

type Comic = { url: string; name: string; isImage: boolean };

const STEPS = [
  { short: "READ", label: "READING THE COMIC", by: "GEMINI 3 PRO", start: 0 },
  { short: "MODEL", label: "CONSTRUCTING A 3D MODEL", by: "GEMINI · MULTI-VIEW", start: 3.8 },
  { short: "RIG", label: "RIGGING THE SKELETON", by: "41 JOINTS", start: 7.6 },
  { short: "MESH", label: "EXTRACTING THE MESH", by: "21,858 VERTICES", start: 11.4 },
  { short: "SPLATS", label: "APPLYING THE SPLATS", by: "50,000 GAUSSIANS", start: 15.2 },
  { short: "ANIMATE", label: "APPLYING THE ANIMATIONS", by: "13 CLIPS", start: 19.0 },
];

/** The characters on the Storm Night page (fractions of the page: x, y, width, height). */
const FOUND: { label: string; box: [number, number, number, number] }[] = [
  { label: "DOG · 0.98", box: [0.475, 0.26, 0.145, 0.111] },
  { label: "PERSON · 0.96", box: [0.078, 0.454, 0.3, 0.229] },
  { label: "DOG · 0.97", box: [0.34, 0.508, 0.116, 0.085] },
  { label: "PERSON · 0.95", box: [0.55, 0.5, 0.225, 0.182] },
  { label: "DOG · 0.94", box: [0.765, 0.52, 0.141, 0.095] },
];
const STORM_NIGHT = "/comic/storm-night-bad-ending.png";

const VIEWS = [
  { src: "/pipeline/view-front.png", label: "FRONT" },
  { src: "/pipeline/view-three-quarter.png", label: "¾" },
  { src: "/pipeline/view-side.png", label: "SIDE" },
  { src: "/pipeline/view-back.png", label: "BACK" },
];
const CLIPS = ["idle", "walk", "run", "sit", "jump", "backflip", "bark", "paw", "spin", "playbow", "sniff", "dig", "wag"];

// Steps 3-6 live: the game's own Biscuit on the menu stand (the same mesh, splats, rig and clips as in the
// game), drawn by the game over .pl-live.
const SIDE_ON = -Math.PI / 2 - 0.35; // facing right, a little towards us
const TURN = 0.7; // radians a second on the turntable
const LIVE = {
  rig: { view: "mesh", xray: true, rig: true, action: "idle", still: true, turnRate: TURN },
  mesh: { view: "mesh", rig: false, action: "idle", still: true, turnRate: TURN },
  splats: { view: "splats", rig: false, action: "idle", still: true, turnRate: TURN },
  walk: { view: "splats", rig: true, action: "walk", heading: SIDE_ON },
  run: { view: "splats", rig: false, action: "run", heading: SIDE_ON },
} as const;
const SPLATS_ON = 16.2; // into step 5: the bare mesh for a moment, then the splats go on
const RUN_FROM = 21.0; // into step 6: walking on the rig, then running

const count = (t: number, from: number, to: number, total: number) =>
  Math.round(Math.min(1, Math.max(0, (t - from) / (to - from))) * total).toLocaleString("en-US");

export function Pipeline({ comic, game, onDone }: { comic: Comic | null; game: Game | null; onDone: () => void }) {
  const [t, setT] = useState(0);
  const [pageSize, setPageSize] = useState("1800 × 2900");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const ended = useRef(false);
  const end = () => {
    if (ended.current) return;
    ended.current = true;
    onDoneRef.current();
  };
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    const start = performance.now();
    const timer = window.setInterval(() => {
      const seconds = (performance.now() - start) / 1000;
      setT(seconds);
      if (seconds >= PIPELINE_SECONDS) {
        window.clearInterval(timer);
        endRef.current();
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, []);

  let step = 0;
  STEPS.forEach((candidate, i) => {
    if (t >= candidate.start) step = i;
  });
  const phase = (i: number) => (i === step ? "is-on" : i < step ? "is-past" : "is-next");

  // The live dog for steps 3-6, once the game has him loaded.
  const liveBox = useRef<HTMLDivElement>(null);
  const [dogReady, setDogReady] = useState(false);
  useEffect(() => {
    let alive = true;
    game?.biscuit.ready.then(() => alive && setDogReady(true), () => {});
    return () => {
      alive = false;
    };
  }, [game]);
  const look =
    t >= RUN_FROM ? "run"
    : t >= STEPS[5].start ? "walk"
    : t >= SPLATS_ON ? "splats"
    : t >= STEPS[3].start ? "mesh"
    : t >= STEPS[2].start ? "rig"
    : null;
  const live = !!game && dogReady && look !== null;
  useEffect(() => {
    if (!game || !dogReady || !look || !liveBox.current) return;
    if (game.mode !== "showcase") game.showcase(liveBox.current);
    game.biscuit.present(LIVE[look]);
  }, [game, dogReady, look]);
  // Leaving: the comic page puts him back on his own stand.
  useEffect(
    () => () => {
      if (game?.mode === "showcase") game.hide();
    },
    [game],
  );

  // Their own page if it's a picture; the boxes are measured on Storm Night's, so they only show on that one.
  const page = comic?.isImage ? comic.url : STORM_NIGHT;
  const known = page === STORM_NIGHT || /storm-night/i.test(comic?.name ?? "");

  const log: [number, string][] = [
    [0.3, `gemini-3-pro · reading page 1 · ${pageSize}`],
    [1.2, known ? "5 characters · dog ×3, person ×2" : "characters found"],
    [2.1, "the hero: small white dog, daisy bandana"],
    [2.9, "lifting him out of panel 1"],
    [4.0, "multi-view · front, ¾, side, back"],
    [5.6, "fitting one shape to all four views"],
    [7.0, "4 views agree · model ready"],
    [7.8, "fitting the rig · 41 joints"],
    [9.6, "skin weights · 4 bones per vertex"],
    [11.6, "extracting the mesh · 21,858 vertices"],
    [13.2, "28,675 triangles · texture 1024²"],
    [15.4, "baking 50,000 gaussians onto the mesh"],
    [17.3, "skinning them to the rig"],
    [19.2, "retargeting 13 clips · walk"],
    [21.1, "IK paws · run"],
    [22.3, "done · Biscuit is ready"],
  ];

  return (
    <section className="screen pipeline-screen">
      <header className="pipeline-header">
        <span className="pipeline-eyebrow">ISSUE NO. 01 · BEHIND THE PANELS</span>
        <h1>BRINGING BISCUIT TO LIFE</h1>
      </header>

      <div className={`pipeline-stage ${live ? "pipeline-stage--live" : ""}`}>
        <div className="pl-live" ref={liveBox} />
        <div className="pipeline-caption" key={step}>
          <small>
            STEP {step + 1} / {STEPS.length} · {STEPS[step].by}
          </small>
          <strong>
            {STEPS[step].label}
            {t < PIPELINE_SECONDS - 0.4 ? "…" : ""}
          </strong>
        </div>

        {/* 1. Reading the comic */}
        <div className={`pl-layer pl-read ${phase(0)}`}>
          <div className={`pl-page ${t > 2.4 ? "pl-page--lift" : ""}`}>
            <img
              alt="Your comic"
              onLoad={(event) => {
                const image = event.currentTarget;
                setPageSize(`${image.naturalWidth} × ${image.naturalHeight}`);
              }}
              src={page}
            />
            <i className="pl-scan" />
            {known &&
              FOUND.map(({ label, box: [x, y, w, h] }, i) => (
                <span
                  className={`pl-box ${t > 0.8 + i * 0.22 ? "pl-box--on" : ""} ${i === 0 ? "pl-box--hero" : ""}`}
                  key={label}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
                >
                  <b>{label}</b>
                </span>
              ))}
          </div>
          <img alt="Biscuit, lifted out of the comic" className={`pl-extracted ${t > 2.9 ? "pl-pop" : ""}`} src="/pipeline/extracted.png" />
          <span className={`pl-sfx ${t > 3.0 ? "pl-pop" : ""}`}>FOUND HIM!</span>
        </div>

        {/* 2. The model from every side */}
        <div className={`pl-layer pl-views ${phase(1)}`}>
          {VIEWS.map((view, i) => (
            <figure className={`pl-view ${t > 4.0 + i * 0.4 ? "pl-pop" : ""}`} key={view.label}>
              <img alt="" src={view.src} />
              <figcaption>{view.label}</figcaption>
            </figure>
          ))}
          <div className="pl-meter">
            <span>MODEL FIT</span>
            <strong>{count(t, 4.4, 7.2, 100)}%</strong>
            <i style={{ "--fill": Math.min(1, Math.max(0, (t - 4.4) / 2.8)) } as CSSProperties} />
          </div>
        </div>

        {/* 3. Rig */}
        <div className={`pl-layer pl-turn ${phase(2)}`}>
          <div className="pl-sprite pl-sprite--24" style={{ backgroundImage: "url(/pipeline/rig.webp)" }} />
          <ul className="pl-tags">
            <li className={t > 7.9 ? "pl-pop" : ""}>JOINTS <b>{count(t, 7.8, 9.0, 41)}</b></li>
            <li className={t > 9.4 ? "pl-pop" : ""}>BONES PER VERTEX <b>4</b></li>
            <li className={t > 10.3 ? "pl-pop" : ""}>SPINE · LEGS · TAIL · EARS</li>
          </ul>
        </div>

        {/* 4. Mesh */}
        <div className={`pl-layer pl-turn ${phase(3)}`}>
          <div className="pl-sprite pl-sprite--24" style={{ backgroundImage: "url(/pipeline/mesh.webp)" }} />
          <ul className="pl-tags">
            <li className={t > 11.7 ? "pl-pop" : ""}>VERTICES <b>{count(t, 11.6, 12.8, 21858)}</b></li>
            <li className={t > 13.0 ? "pl-pop" : ""}>TRIANGLES <b>{count(t, 12.9, 13.9, 28675)}</b></li>
            <li className={t > 14.2 ? "pl-pop" : ""}>TEXTURE <b>1024²</b></li>
          </ul>
        </div>

        {/* 5. Splats */}
        <div className={`pl-layer pl-turn ${phase(4)}`}>
          <div className="pl-sprite pl-sprite--24" style={{ backgroundImage: "url(/pipeline/mesh.webp)" }} />
          <ul className="pl-tags">
            <li className={t > 15.5 ? "pl-pop" : ""}>GAUSSIANS <b>{count(t, 15.4, 16.8, 50000)}</b></li>
            <li className={t > 17.2 ? "pl-pop" : ""}>SKINNED TO <b>41 JOINTS</b></li>
            <li className={t > 18.1 ? "pl-pop" : ""}>FUR · FACE · BANDANA</li>
          </ul>
        </div>

        {/* 6. Walking and running on the rig */}
        <div className={`pl-layer pl-run ${phase(5)}`}>
          <i className="pl-speed" />
          <div className="pl-sprite pl-sprite--16" style={{ backgroundImage: "url(/pipeline/run.webp)" }} />
          <ul className="pl-clips">
            {CLIPS.map((clip, i) => (
              <li className={`${t > 19.2 + i * 0.12 ? "pl-pop" : ""} ${clip === (t >= RUN_FROM ? "run" : "walk") ? "pl-clip--live" : ""}`} key={clip}>
                {clip}
              </li>
            ))}
          </ul>
          <span className={`pl-sfx pl-sfx--woof ${t > 21.8 ? "pl-pop" : ""}`}>WOOF!</span>
        </div>
      </div>

      <aside className="pipeline-log" aria-live="polite">
        <span className="pipeline-log__title">PIPELINE LOG</span>
        <ol>
          {log
            .filter(([at]) => t >= at)
            .map(([at, line]) => (
              <li key={line}>
                <time>{at.toFixed(1).padStart(4, "0")}s</time> {line}
              </li>
            ))}
        </ol>
      </aside>

      <ol className="pipeline-timeline">
        <i className="pipeline-timeline__fill" style={{ "--progress": Math.min(1, t / PIPELINE_SECONDS) } as CSSProperties} />
        {STEPS.map(({ short }, i) => (
          <li className={phase(i)} key={short}>
            <span>{i < step || t >= PIPELINE_SECONDS ? "✓" : i + 1}</span>
            {short}
          </li>
        ))}
      </ol>

      <button className="pipeline-skip" onClick={end} type="button">
        SKIP ›
      </button>
    </section>
  );
}
