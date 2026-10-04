import { type CSSProperties, useEffect, useRef, useState } from "react";
import "./pipeline.css";

// Between the upload and the comic: bringing Biscuit to life, played as a comic page in 23 seconds.
// 1. Gemini reads the page, boxes the characters and lifts the hero out of panel 1;
// 2. paints him from every side as a wireframe (the 3D model taking shape);
// 3. the real model in X-ray with its rig lit up inside; 4. its mesh; 5. the mesh running on the rig.
// The stills are Gemini's (npm run pipeline-art); the turntables and the run are rendered from the real
// dog, public/models/dog-animated.glb (tools/pipeline-frames.html in dev). The timings are fixed and the
// figures in the log are the real model's.

export const PIPELINE_SECONDS = 23;

type Comic = { url: string; name: string; isImage: boolean };

const STEPS = [
  { label: "READING THE COMIC", by: "GEMINI 3 PRO", start: 0 },
  { label: "CONSTRUCTING A 3D MODEL", by: "GEMINI · MULTI-VIEW", start: 4.6 },
  { label: "RIGGING THE SKELETON", by: "41 JOINTS", start: 9.2 },
  { label: "EXTRACTING THE MESH", by: "21,856 VERTICES", start: 13.8 },
  { label: "APPLYING THE ANIMATIONS", by: "11 CLIPS", start: 18.4 },
];
const SHORT = ["READ", "MODEL", "RIG", "MESH", "ANIMATE"];

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
const CLIPS = ["idle", "sit", "jump", "bark", "paw", "spin", "playbow", "sniff", "wag", "walk", "run"];

const count = (t: number, from: number, to: number, total: number) =>
  Math.round(Math.min(1, Math.max(0, (t - from) / (to - from))) * total).toLocaleString("en-US");

export function Pipeline({ comic, onDone }: { comic: Comic | null; onDone: () => void }) {
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

  // Their own page if it's a picture; the boxes are measured on Storm Night's, so they only show on that one.
  const page = comic?.isImage ? comic.url : STORM_NIGHT;
  const known = page === STORM_NIGHT || /storm-night/i.test(comic?.name ?? "");
  let step = 0;
  STEPS.forEach((candidate, i) => {
    if (t >= candidate.start) step = i;
  });
  const phase = (i: number) => (i === step ? "is-on" : i < step ? "is-past" : "is-next");

  const log: [number, string][] = [
    [0.3, `gemini-3-pro · reading page 1 · ${pageSize}`],
    [1.4, known ? "5 characters · dog ×3, person ×2" : "characters found"],
    [2.5, "the hero: small white dog, daisy bandana"],
    [3.5, "lifting him out of panel 1"],
    [4.9, "multi-view · front, ¾, side, back"],
    [6.5, "reconstructing · 50,000 gaussians"],
    [8.4, "4 views agree · model ready"],
    [9.5, "fitting the rig · 41 joints"],
    [11.3, "skin weights · 4 bones per vertex"],
    [14.1, "extracting the mesh · 21,856 vertices"],
    [15.6, "28,675 triangles · texture 1024²"],
    [17.1, "inking the outline"],
    [18.7, "retargeting 11 clips onto the rig"],
    [20.3, "IK paws · walk, trot, run"],
    [22.2, "done · Biscuit is ready"],
  ];

  return (
    <section className="screen pipeline-screen">
      <header className="pipeline-header">
        <span className="pipeline-eyebrow">ISSUE NO. 01 · BEHIND THE PANELS</span>
        <h1>BRINGING BISCUIT TO LIFE</h1>
      </header>

      <div className="pipeline-stage">
        <div className="pipeline-caption" key={step}>
          <small>STEP {step + 1} / 5 · {STEPS[step].by}</small>
          <strong>{STEPS[step].label}{t < PIPELINE_SECONDS - 0.4 ? "…" : ""}</strong>
        </div>

        {/* 1. Reading the comic */}
        <div className={`pl-layer pl-read ${phase(0)}`}>
          <div className={`pl-page ${t > 3.0 ? "pl-page--lift" : ""}`}>
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
                  className={`pl-box ${t > 1.0 + i * 0.28 ? "pl-box--on" : ""} ${i === 0 ? "pl-box--hero" : ""}`}
                  key={label}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
                >
                  <b>{label}</b>
                </span>
              ))}
          </div>
          <img alt="Biscuit, lifted out of the comic" className={`pl-extracted ${t > 3.5 ? "pl-pop" : ""}`} src="/pipeline/extracted.png" />
          <span className={`pl-sfx ${t > 3.6 ? "pl-pop" : ""}`}>FOUND HIM!</span>
        </div>

        {/* 2. The model from every side */}
        <div className={`pl-layer pl-views ${phase(1)}`}>
          {VIEWS.map((view, i) => (
            <figure className={`pl-view ${t > 4.9 + i * 0.5 ? "pl-pop" : ""}`} key={view.label}>
              <img alt="" src={view.src} />
              <figcaption>{view.label}</figcaption>
            </figure>
          ))}
          <div className="pl-meter">
            <span>GAUSSIANS</span>
            <strong>{count(t, 5.4, 8.6, 50000)}</strong>
            <i style={{ "--fill": Math.min(1, Math.max(0, (t - 5.4) / 3.2)) } as CSSProperties} />
          </div>
        </div>

        {/* 3. Rig */}
        <div className={`pl-layer pl-turn ${phase(2)}`}>
          <div className="pl-sprite pl-sprite--24" style={{ backgroundImage: "url(/pipeline/rig.webp)" }} />
          <ul className="pl-tags">
            <li className={t > 9.8 ? "pl-pop" : ""}>JOINTS <b>{count(t, 9.6, 11, 41)}</b></li>
            <li className={t > 11.4 ? "pl-pop" : ""}>BONES PER VERTEX <b>4</b></li>
            <li className={t > 12.4 ? "pl-pop" : ""}>SPINE · LEGS · TAIL · EARS</li>
          </ul>
        </div>

        {/* 4. Mesh */}
        <div className={`pl-layer pl-turn ${phase(3)}`}>
          <div className="pl-sprite pl-sprite--24" style={{ backgroundImage: "url(/pipeline/mesh.webp)" }} />
          <ul className="pl-tags">
            <li className={t > 14.2 ? "pl-pop" : ""}>VERTICES <b>{count(t, 14.0, 15.4, 21856)}</b></li>
            <li className={t > 15.7 ? "pl-pop" : ""}>TRIANGLES <b>{count(t, 15.5, 16.6, 28675)}</b></li>
            <li className={t > 17.0 ? "pl-pop" : ""}>TEXTURE <b>1024²</b></li>
          </ul>
        </div>

        {/* 5. Running on the rig */}
        <div className={`pl-layer pl-run ${phase(4)}`}>
          <i className="pl-speed" />
          <div className="pl-sprite pl-sprite--16" style={{ backgroundImage: "url(/pipeline/run.webp)" }} />
          <ul className="pl-clips">
            {CLIPS.map((clip, i) => (
              <li className={`${t > 18.6 + i * 0.16 ? "pl-pop" : ""} ${clip === "run" ? "pl-clip--live" : ""}`} key={clip}>
                {clip}
              </li>
            ))}
          </ul>
          <span className={`pl-sfx pl-sfx--woof ${t > 21.4 ? "pl-pop" : ""}`}>WOOF!</span>
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
        {SHORT.map((label, i) => (
          <li className={phase(i)} key={label}>
            <span>{i < step || t >= PIPELINE_SECONDS ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <button className="pipeline-skip" onClick={end} type="button">
        SKIP ›
      </button>
    </section>
  );
}
