import type { SparkRenderer } from '@sparkjsdev/spark';
import type * as THREE from 'three';

/**
 * Keeps the frame rate up by trading detail for speed. Splat rendering is limited by how many
 * splats are sorted and how many pixels they cover, so each tier lowers the render resolution,
 * the LoD splat budget and the splat footprint (maxStdDev).
 */
interface Tier {
  pixelRatio: number;
  splats: number;
  maxStdDev: number;
}

const TIERS: Tier[] = [
  { pixelRatio: 1.5, splats: 2_500_000, maxStdDev: Math.sqrt(8) },
  { pixelRatio: 1, splats: 1_500_000, maxStdDev: Math.sqrt(8) },
  { pixelRatio: 1, splats: 800_000, maxStdDev: Math.sqrt(7) },
  { pixelRatio: 1, splats: 500_000, maxStdDev: Math.sqrt(6) },
  { pixelRatio: 0.85, splats: 300_000, maxStdDev: Math.sqrt(6) },
  { pixelRatio: 0.7, splats: 180_000, maxStdDev: Math.sqrt(5) },
  { pixelRatio: 0.5, splats: 100_000, maxStdDev: Math.sqrt(5) },
];

// A few of Marble's splats are needles that project across the whole view and draw as long streaks over
// everything (seen on a GPU; Spark lets a splat cover up to 512 px). Capping a splat's on-screen radius at a
// share of the frame's height removes them without softening walls up close (checked at the yard's front door).
const MAX_SPLAT_RADIUS = 0.12;
/** The largest on-screen splat radius (pixels) for a frame `height` pixels tall. */
export const splatRadiusCap = (height: number) => Math.round(MAX_SPLAT_RADIUS * height);

const TOO_SLOW_FPS = 55;
const FAST_ENOUGH_FPS = 57;
const SETTLE_SECONDS = 1.5; // ignore frames right after a change while LoD and sorting catch up

export class AdaptiveQuality {
  readonly softwareRenderer: boolean;
  private tier: number;
  private elapsed = 0;
  private frames = 0;
  private settle = SETTLE_SECONDS;
  private fastWindows = 0;
  private slowFrames = 0
  private upgradeDelay = 12

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly spark: SparkRenderer,
  ) {
    this.softwareRenderer = /basic render|swiftshader|llvmpipe|software/i.test(rendererName(renderer));
    this.tier = this.softwareRenderer ? TIERS.length - 2 : 1;
    // Update poses every frame and sort depth at most 30 times per second.
    spark.minSortIntervalMs = 33
    this.apply();
  }

  get label() {
    const { splats, pixelRatio } = TIERS[this.tier];
    return `Q${TIERS.length - this.tier}/${TIERS.length} · ${Math.round(splats / 1000)}k splats · ${pixelRatio}x`;
  }

  /** Call after loading a world so its first slow frames don't count. */
  reset() {
    this.settle = SETTLE_SECONDS * 2;
    this.elapsed = 0;
    this.frames = 0;
    this.fastWindows = 0;
    this.slowFrames = 0
    this.upgradeDelay = 12
  }

  /** Feed every frame's duration; returns the measured fps once per second, otherwise undefined. */
  update(frameSeconds: number): number | undefined {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > 0.25) return undefined
    this.upgradeDelay = Math.max(0, this.upgradeDelay - frameSeconds)
    if (this.settle > 0) {
      this.settle -= frameSeconds;
      return undefined;
    }
    this.frames++;
    if (frameSeconds > 1 / 30) this.slowFrames++
    this.elapsed += frameSeconds;
    if (this.elapsed < 1) return undefined;

    const fps = this.frames / this.elapsed;
    const stuttering = this.slowFrames / this.frames > 0.08
    this.frames = 0;
    this.slowFrames = 0
    this.elapsed = 0;
    if ((fps < TOO_SLOW_FPS || stuttering) && this.tier < TIERS.length - 1) {
      this.upgradeDelay = 30
      this.setTier(this.tier + 1);
    } else if (fps > FAST_ENOUGH_FPS && !stuttering && this.upgradeDelay === 0 && this.tier > 0) {
      // Only step up after a few comfortable seconds, so it doesn't oscillate.
      if (++this.fastWindows >= 8) {
        this.upgradeDelay = 12
        this.setTier(this.tier - 1)
      }
    } else {
      this.fastWindows = 0;
    }
    return fps;
  }

  private setTier(tier: number) {
    this.tier = tier;
    this.fastWindows = 0;
    this.settle = SETTLE_SECONDS;
    this.apply();
  }

  /** Re-applies the current tier at the window's size (after something else sized the canvas). */
  resize() {
    this.apply();
  }

  private apply() {
    const { pixelRatio, splats, maxStdDev } = TIERS[this.tier];
    this.renderer.setPixelRatio(Math.min(pixelRatio, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.spark.lodSplatCount = splats;
    this.spark.maxStdDev = maxStdDev;
    this.spark.maxPixelRadius = splatRadiusCap(window.innerHeight * this.renderer.getPixelRatio());
  }
}

function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}
