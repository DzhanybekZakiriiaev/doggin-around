import { type CSSProperties, useEffect, useState } from "react";
import "./pipeline.css";

// Over the way into panel 1 (the panel's frames dissolving behind it): the world being built, in 6 seconds.
// 1. Gemini paints the scene from four sides; 2. they're stitched into the 360° panorama, seams cleaned;
// 3. World Labs' Marble turns it into a world: its collider, then the Gaussian splats over it.
// The pictures are the real ones: the plates and Marble's panorama (scripts/world-pipeline-assets.mjs), the
// yard's collider captured from the game, and the game's opening view.

export const WORLD_PIPELINE_MS = 6000;

const STEPS = [
  { label: "GENERATING THE SIDE VIEWS", by: "GEMINI 3 PRO", start: 0 },
  { label: "STITCHING THE PANORAMA", by: "360° · SEAMS CLEANED UP", start: 1.9 },
  { label: "BUILDING THE WORLD", by: "WORLD LABS MARBLE · SPARK", start: 3.7 },
];
const VIEWS = ["000", "090", "180", "270"];

/** Everything it shows, for the page before to fetch ahead. */
export const WORLD_PIPELINE_IMAGES = [
  ...VIEWS.map((angle) => `/world-pipeline/view-${angle}.jpg`),
  "/world-pipeline/pano.jpg",
  "/world-pipeline/collider.jpg",
  "/world-pipeline/collider-splats.jpg",
];
const COLLIDER_TRIANGLES = 227891;
const GAUSSIANS = 1920000;

const count = (t: number, from: number, to: number, total: number) =>
  Math.round(Math.min(1, Math.max(0, (t - from) / (to - from))) * total).toLocaleString("en-US");

export function WorldPipeline() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = window.setInterval(() => setT((performance.now() - start) / 1000), 60);
    return () => window.clearInterval(timer);
  }, []);

  let step = 0;
  STEPS.forEach((candidate, i) => {
    if (t >= candidate.start) step = i;
  });
  const shown = VIEWS.filter((_, i) => t > 0.15 + i * 0.3).length;
  const meter =
    step === 0 ? `${shown} / 4 VIEWS`
    : step === 1 ? (t < 2.8 ? "STITCHING 4 VIEWS" : "360° × 180° PANORAMA")
    : t < 4.5 ? `COLLIDER · ${count(t, 3.8, 4.4, COLLIDER_TRIANGLES)} TRIANGLES`
    : `${count(t, 4.6, 5.6, GAUSSIANS)} GAUSSIANS`;

  return (
    <div className="wp-card" role="status" aria-label={STEPS[step].label}>
      <div className="wp-caption" key={step}>
        <small>
          STEP {step + 1} / {STEPS.length} · {STEPS[step].by}
        </small>
        <strong>{STEPS[step].label}…</strong>
      </div>

      <div className="wp-stage">
        {/* 1-2: the four views, a grid that slides into a strip, then the panorama they make */}
        <div className={`wp-views ${t >= 2.0 ? "wp-views--strip" : ""} ${t >= 3.0 ? "wp-views--gone" : ""}`}>
          {VIEWS.map((angle, i) => (
            <figure
              className={`wp-view ${t > 0.15 + i * 0.3 ? "is-on" : ""}`}
              key={angle}
              style={{ "--i": i, "--col": i % 2, "--row": Math.floor(i / 2) } as CSSProperties}
            >
              <img alt="" src={`/world-pipeline/view-${angle}.jpg`} />
              <figcaption>{Number(angle)}°</figcaption>
            </figure>
          ))}
          <div className={`wp-seams ${t >= 2.4 && t < 3.2 ? "is-on" : ""}`}>
            <i />
            <i />
            <i />
          </div>
        </div>
        <img alt="" className={`wp-pano ${t >= 2.8 && t < 3.9 ? "is-on" : ""}`} src="/world-pipeline/pano.jpg" />

        {/* 3: the world, its collider first, then the splats going on */}
        <img alt="" className={`wp-world ${t >= 3.7 ? "is-on" : ""}`} src="/world-pipeline/collider.jpg" />
        <img alt="" className={`wp-world ${t >= 4.5 ? "is-on" : ""}`} src="/world-pipeline/collider-splats.jpg" />
        <img alt="" className={`wp-world ${t >= 5.2 ? "is-on" : ""}`} src="/comic/transition/game-start.jpg" />

        <span className="wp-meter">{meter}</span>
      </div>

      <ol className="wp-steps">
        {STEPS.map(({ label }, i) => (
          <li className={i < step ? "is-past" : i === step ? "is-on" : ""} key={label}>
            <span>{i < step ? "✓" : i + 1}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
