import { type CSSProperties, useEffect, useState } from "react";
import { PIPELINE_SECONDS } from "./Pipeline";
import "./pipeline.css";

// Over the way into panel 1 (the panel's frames dissolving behind it): the world being built, the stages of
// docs/scene-generation.md in six steps, as long as and in step with Biscuit's own pipeline before page 2.
// 1. Four side views are generated; 2. projected onto the sphere, their seams aligned and repaired into one
// panorama; 3. depth from six cube faces; 4. lifted to a point cloud, the parts it never saw filled in; 5. a
// Gaussian splat trained on it; 6. a collider extracted from it, and physics on top.
// The pictures are the yard's own: the plates and their projection (scripts/world-pipeline-assets.mjs), its
// panorama, and its depth, point cloud and splat (scripts/world-pipeline-capture.html), its collider captured
// from the game, and the game's opening view.

export const WORLD_PIPELINE_MS = PIPELINE_SECONDS * 1000;

// Laid out for 23 seconds, each stage starting when the dog's does.
const STEPS = [
  { short: "VIEWS", label: "GENERATING THE SIDE VIEWS", by: "GEMINI 3 PRO · 4 VIEWS, 90° APART", start: 0 },
  { short: "STITCH", label: "STITCHING THE PANORAMA", by: "SPHERE PROJECTION · SIFT + RANSAC · SEAM INPAINTING", start: 3.8 },
  { short: "DEPTH", label: "ESTIMATING DEPTH", by: "6 CUBE FACES · DEPTH ANYTHING V2", start: 7.6 },
  { short: "3D", label: "LIFTING TO 3D", by: "POINT CLOUD · REPROJECTION + INPAINTING", start: 11.4 },
  { short: "SPLAT", label: "TRAINING THE GAUSSIAN SPLAT", by: "GSPLAT · L1 + SSIM + DEPTH LOSS", start: 15.2 },
  { short: "PHYSICS", label: "ADDING THE COLLIDER AND PHYSICS", by: "TSDF · MARCHING CUBES · RAPIER", start: 19.0 },
];
const VIEWS = ["000", "090", "180", "270"];

/** Everything it shows, for the page before to fetch ahead. */
export const WORLD_PIPELINE_IMAGES = [
  ...VIEWS.map((angle) => `/world-pipeline/view-${angle}.jpg`),
  ...["sphere", "pano", "depth", "points", "holes", "filled", "splat", "collider", "collider-splats"].map(
    (name) => `/world-pipeline/${name}.jpg`,
  ),
];
const POINTS = 6 * 512 * 512; // six 512² cube faces, a point per pixel
const NEVER_SEEN = "6.2"; // % of the off-centre view no panorama point lands on (the capture page measures it)
const ITERATIONS = 30000;
const COLLIDER_TRIANGLES = 227891;

const count = (t: number, from: number, to: number, total: number) =>
  Math.round(Math.min(1, Math.max(0, (t - from) / (to - from))) * total).toLocaleString("en-US");

// Where the six cube faces meet, on the panorama (longitude -180…180 → 0…360, latitude 90…-90 → 0…180):
// the four side faces split at ±45° and ±135°, and each one's edge with the top and bottom faces curves
// from 45° up at its centre to 35° at its corners (latitude = atan(cos(longitude from its centre))).
const FACE_EDGES = [-180, -90, 0, 90]
  .flatMap((centre) => {
    const points = Array.from({ length: 19 }, (_, i) => {
      const lon = centre - 45 + i * 5;
      const lat = (Math.atan(Math.cos(((lon - centre) * Math.PI) / 180)) * 180) / Math.PI;
      return [lon + 180, lat] as const;
    });
    const edge = (sign: number) => points.map(([x, lat], i) => `${i ? "L" : "M"}${x},${90 - sign * lat}`).join("");
    return [edge(1), edge(-1)];
  })
  .join("");
const SEAMS = [45, 135, 225, 315]; // the plates meet halfway between their centres

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
  const shown = VIEWS.filter((_, i) => t > 0.3 + i * 0.45).length;
  const meters = [
    `${shown} / 4 VIEWS`,
    t < 5.4 ? "4 VIEWS ON THE SPHERE · 4 SEAMS" : t < 6.4 ? "4 SEAMS + 2 POLES MASKED" : "360° × 180° PANORAMA",
    "6 FACES → 360° DEPTH",
    t < 13 ? `${count(t, 11.5, 12.8, POINTS)} POINTS` : t < 14.2 ? `${NEVER_SEEN}% NEVER SEEN` : `${NEVER_SEEN}% FILLED`,
    `ITERATION ${count(t, 15.3, 18, ITERATIONS)} / ${ITERATIONS.toLocaleString("en-US")}`,
    t < 20.6 ? `${count(t, 19.1, 20.2, COLLIDER_TRIANGLES)} TRIANGLES` : t < 21.9 ? "GROUND PLANE · GRAVITY ALIGNED" : "WORLD READY",
  ];
  const on = (from: number, to = Infinity) => (t >= from && t < to ? "is-on" : "");

  return (
    <div className="wp-card" role="status" aria-label={STEPS[step].label}>
      <div className="wp-caption" key={step}>
        <small>
          STEP {step + 1} / {STEPS.length} · {STEPS[step].by}
        </small>
        <strong>{STEPS[step].label}…</strong>
      </div>

      <div className="wp-stage">
        {/* 1: the four side views */}
        <div className={`wp-views ${t >= 3.8 ? "wp-views--gone" : ""}`}>
          {VIEWS.map((angle, i) => (
            <figure
              className={`wp-view ${t > 0.3 + i * 0.45 ? "is-on" : ""}`}
              key={angle}
              style={{ "--col": i % 2, "--row": Math.floor(i / 2) } as CSSProperties}
            >
              <img alt="" src={`/world-pipeline/view-${angle}.jpg`} />
              <figcaption>{Number(angle)}°</figcaption>
            </figure>
          ))}
        </div>

        {/* 2–3: the panorama: the plates on the sphere, their seams checked and repaired, then its depth */}
        <div className={`wp-band ${on(3.8, 11.4)}`}>
          <img alt="" src="/world-pipeline/sphere.jpg" />
          <img alt="" className={`wp-band__fade ${on(6.4)}`} src="/world-pipeline/pano.jpg" />
          <img alt="" className={`wp-band__wipe ${on(8.6)}`} src="/world-pipeline/depth.jpg" />
          <svg aria-hidden="true" className="wp-band__marks" preserveAspectRatio="none" viewBox="0 0 360 180">
            <g className={`wp-marks wp-marks--seams ${on(4.4, 5.6)}`}>
              {SEAMS.map((x) => (
                <line key={x} x1={x} x2={x} y1={0} y2={180} />
              ))}
            </g>
            <g className={`wp-marks wp-marks--repair ${on(5.4, 7.0)}`}>
              {SEAMS.map((x) => (
                <rect height={180} key={x} width={22} x={x - 11} y={0} />
              ))}
              <rect height={42} width={360} x={0} y={0} />
              <rect height={42} width={360} x={0} y={138} />
            </g>
            <g className={`wp-marks wp-marks--faces ${on(7.8)}`}>
              {SEAMS.map((x) => (
                <line key={x} x1={x} x2={x} y1={0} y2={180} />
              ))}
              <path d={FACE_EDGES} />
            </g>
          </svg>
        </div>

        {/* 4–6: the world: its point cloud and a step off-centre (the unseen, then filled), the splat
            training, then its collider with physics on top */}
        <img alt="" className={`wp-world ${on(11.4)}`} src="/world-pipeline/points.jpg" />
        <img alt="" className={`wp-world ${on(13.0)}`} src="/world-pipeline/holes.jpg" />
        <img alt="" className={`wp-world ${on(14.2)}`} src="/world-pipeline/filled.jpg" />
        <img
          alt=""
          className={`wp-world wp-world--train ${on(15.2)} ${t >= 15.35 ? "is-sharp" : ""}`}
          src="/world-pipeline/splat.jpg"
        />
        <img alt="" className={`wp-world ${on(19.0)}`} src="/world-pipeline/collider.jpg" />
        <img alt="" className={`wp-world ${on(20.6)}`} src="/world-pipeline/collider-splats.jpg" />
        <img alt="" className={`wp-world ${on(21.9)}`} src="/comic/transition/game-start.jpg" />

        <span className="wp-meter">{meters[step]}</span>
      </div>

      <ol className="wp-steps">
        {STEPS.map(({ short }, i) => (
          <li className={i < step ? "is-past" : i === step ? "is-on" : ""} key={short}>
            <span>{i < step ? "✓" : i + 1}</span>
            {short}
          </li>
        ))}
      </ol>
    </div>
  );
}
