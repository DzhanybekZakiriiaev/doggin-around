import { ExtSplats, SplatMesh, SplatSkinning, SplatSkinningMode } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { sampleSurface, seededRandom, skinMatrix } from './dog/sampling';

// The first-person hands as Gaussian splats, so they sit with the splat world and Biscuit instead of reading
// as a smooth mesh. The surface of the rigged hand (and the sleeve) is covered in small flat splats bound
// to the same skeleton the hand animations drive; each takes its colour from the painted matcaps, looked
// up with its normal as seen in the rest pose, with a little brush-to-brush variation.

/** Reads a painted matcap so splats can take their light from it. */
export class Matcap {
  private readonly pixels: ImageData;

  constructor(texture: THREE.Texture) {
    const image = texture.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    this.pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * Colour for a surface facing `normal` (view space), as display (sRGB) values like a splat file holds.
   * Stays off the matcap's outer ring: its rim light and dark edge belong to silhouettes, and splats near
   * the silhouette (or on the far side, peeking through) would turn into dark and cyan specks.
   */
  colorFor(normal: THREE.Vector3): THREE.Color {
    const { width, height, data } = this.pixels;
    const flat = new THREE.Vector2(normal.x, normal.y);
    if (flat.length() > RIM) flat.setLength(RIM);
    const u = flat.x * 0.495 + 0.5;
    const v = flat.y * 0.495 + 0.5;
    const x = Math.min(width - 1, Math.round(u * (width - 1)));
    const y = Math.min(height - 1, Math.round((1 - v) * (height - 1)));
    const i = (y * width + x) * 4;
    return new THREE.Color(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
  }
}

interface Brush {
  /** Splats per square metre of surface. */
  density: number;
  /** Splat footprint relative to the spacing between splats. */
  size: number;
  /** Stretch along the stroke direction (1 = round). */
  stretch: number;
  /** ± variation in brightness from splat to splat. */
  jitter: number;
}

const SKIN_BRUSH: Brush = { density: 400000, size: 1.6, stretch: 1.5, jitter: 0.035 };
const SLEEVE_BRUSH: Brush = { density: 140000, size: 1.6, stretch: 2.2, jitter: 0.07 };
const RIM = 0.78; // how far out on the matcap colours are read (1 = its edge)

const Z = new THREE.Vector3(0, 0, 1);

/** A flat, slightly elongated splat lying on the surface, its long side along `along` where given. */
function addSplat(
  out: ExtSplats,
  position: THREE.Vector3,
  normal: THREE.Vector3,
  color: THREE.Color,
  radius: number,
  brush: Brush,
  random: () => number,
  along?: THREE.Vector3,
) {
  const lie = new THREE.Quaternion().setFromUnitVectors(Z, normal);
  let spin = random() * Math.PI;
  if (along) {
    // Turn the splat's X towards the stroke direction (projected into the surface), with a little scatter.
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(lie);
    const target = along.clone().addScaledVector(normal, -along.dot(normal)).normalize();
    spin = Math.atan2(new THREE.Vector3().crossVectors(x, target).dot(normal), x.dot(target)) + (random() - 0.5) * 0.5;
  }
  const quaternion = lie.multiply(new THREE.Quaternion().setFromAxisAngle(Z, spin));
  const r = radius * (0.75 + random() * 0.5);
  const scales = new THREE.Vector3(r * Math.sqrt(brush.stretch), r / Math.sqrt(brush.stretch), r * 0.18);
  const shade = 1 + (random() - 0.5) * 2 * brush.jitter;
  const warm = (random() - 0.5) * brush.jitter * 0.5;
  const painted = new THREE.Color(
    THREE.MathUtils.clamp(color.r * shade + warm, 0, 1),
    THREE.MathUtils.clamp(color.g * shade, 0, 1),
    THREE.MathUtils.clamp(color.b * shade - warm, 0, 1),
  );
  out.pushSplat(position, scales, quaternion, 1, painted);
}

async function finish(packed: ExtSplats) {
  packed.reinitialize({ extArrays: packed.extArrays, numSplats: packed.numSplats });
  const splats = new SplatMesh({ extSplats: packed, covSplats: true, enableLod: false });
  await splats.initialized;
  return splats;
}

/** A skinned mesh's surface as splats that follow its skeleton. Call `update()` after posing the bones. */
export class SkinnedSplats {
  private constructor(
    readonly source: THREE.SkinnedMesh,
    readonly splats: SplatMesh,
    private readonly skinning: SplatSkinning,
  ) {}

  /** Bakes colours from `matcap` with the hand as currently posed (call with the hands at rest). */
  static async create(source: THREE.SkinnedMesh, matcap: Matcap, seed: number): Promise<SkinnedSplats> {
    const random = seededRandom(seed);
    const { area } = sampleSurface(source, 0);
    const count = Math.round(area * Math.pow(source.matrixWorld.getMaxScaleOnAxis(), 2) * SKIN_BRUSH.density);
    const { samples } = sampleSurface(source, count, random);
    const radius = Math.sqrt(area / samples.length) * SKIN_BRUSH.size * 0.5;

    source.updateMatrixWorld(true);
    const skins = source.skeleton.bones.map((_, i) => skinMatrix(source, i));
    const toView = new THREE.Matrix3().getNormalMatrix(source.matrixWorld);
    const strokes = boneDirections(source);
    const bent = new THREE.Vector3();
    const packed = new ExtSplats();
    for (const sample of samples) {
      // The normal as the camera sees it in this pose picks the matcap colour.
      const viewNormal = new THREE.Vector3();
      for (const { bone, weight } of sample.influences) {
        bent.copy(sample.normal).transformDirection(skins[bone]);
        viewNormal.addScaledVector(bent, weight);
      }
      viewNormal.applyMatrix3(toView).normalize();
      // Strokes run along the fingers and down the back of the hand: the main bone's direction.
      const along = strokes[sample.influences[0].bone];
      addSplat(packed, sample.position, sample.normal, matcap.colorFor(viewNormal), radius, SKIN_BRUSH, random, along);
    }
    const splats = await finish(packed);
    const skinning = new SplatSkinning({
      mesh: splats,
      numBones: source.skeleton.bones.length,
      mode: SplatSkinningMode.LINEAR_BLEND,
    });
    for (let bone = 0; bone < source.skeleton.bones.length; bone++) skinning.setRestMatrix(bone, new THREE.Matrix4());
    const bones = new THREE.Vector4();
    const weights = new THREE.Vector4();
    samples.forEach((sample, i) => {
      bones.set(0, 0, 0, 0);
      weights.set(0, 0, 0, 0);
      sample.influences.forEach(({ bone, weight }, j) => {
        bones.setComponent(j, bone);
        weights.setComponent(j, weight);
      });
      skinning.setSplatBones(i, bones, weights);
    });
    splats.skinning = skinning;
    splats.updateGenerator();
    splats.matrixAutoUpdate = false;
    splats.matrix.copy(source.matrix);
    source.parent?.add(splats);
    const result = new SkinnedSplats(source, splats, skinning);
    result.update();
    return result;
  }

  update() {
    this.splats.matrix.copy(this.source.matrix);
    const bones = this.source.skeleton.bones;
    for (let i = 0; i < bones.length; i++) this.skinning.setBoneMatrix(i, skinMatrix(this.source, i));
    this.skinning.updateBones();
  }
}

/** Each bone's direction (towards its first child bone) in the mesh's bind-pose geometry space. */
function boneDirections(source: THREE.SkinnedMesh): THREE.Vector3[] {
  const { bones, boneInverses } = source.skeleton;
  const toGeometry = source.bindMatrix.clone().invert();
  const at = boneInverses.map((inverse) => new THREE.Vector3().applyMatrix4(toGeometry.clone().multiply(inverse.clone().invert())));
  const directions: THREE.Vector3[] = [];
  const directionOf = (i: number): THREE.Vector3 => {
    if (directions[i]) return directions[i];
    const child = bones[i].children.find((object) => object instanceof THREE.Bone);
    const childIndex = child ? bones.indexOf(child as THREE.Bone) : -1;
    const parentIndex = bones.indexOf(bones[i].parent as THREE.Bone);
    directions[i] =
      childIndex >= 0 && at[childIndex].distanceToSquared(at[i]) > 1e-10
        ? at[childIndex].clone().sub(at[i]).normalize()
        : parentIndex >= 0
          ? directionOf(parentIndex).clone()
          : new THREE.Vector3(0, 0, -1);
    return directions[i];
  };
  return bones.map((_, i) => directionOf(i));
}

/**
 * Rigid meshes (the sleeve's tube and cuff) as one splat mesh in `parent`'s space. `strokeAxis` (in that
 * space) is the direction the brush strokes run, e.g. along the arm.
 */
export async function rigidSplats(
  parent: THREE.Object3D,
  meshes: THREE.Mesh[],
  matcap: Matcap,
  seed: number,
  strokeAxis?: THREE.Vector3,
): Promise<SplatMesh> {
  const random = seededRandom(seed);
  parent.updateMatrixWorld(true);
  const toParent = parent.matrixWorld.clone().invert();
  const packed = new ExtSplats();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const mesh of meshes) {
    const local = toParent.clone().multiply(mesh.matrixWorld); // mesh → parent
    const localNormal = new THREE.Matrix3().getNormalMatrix(local);
    const viewNormal = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const corner = (face: number, k: number) => (index ? index.getX(face * 3 + k) : face * 3 + k);
    const faces = (index?.count ?? positions.count) / 3;
    const cumulative: number[] = [];
    let total = 0;
    for (let f = 0; f < faces; f++) {
      a.fromBufferAttribute(positions, corner(f, 0)).applyMatrix4(local);
      b.fromBufferAttribute(positions, corner(f, 1)).applyMatrix4(local);
      c.fromBufferAttribute(positions, corner(f, 2)).applyMatrix4(local);
      total += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      cumulative.push(total);
    }
    const count = Math.round(total * SLEEVE_BRUSH.density);
    const radius = Math.sqrt(total / count) * SLEEVE_BRUSH.size * 0.5;
    for (let s = 0; s < count; s++) {
      const pick = random() * total;
      let low = 0;
      let high = faces - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (cumulative[mid] < pick) low = mid + 1;
        else high = mid;
      }
      const root = Math.sqrt(random());
      const second = random();
      const weights = [1 - root, root * (1 - second), root * second];
      const position = new THREE.Vector3();
      const normal = new THREE.Vector3();
      for (let k = 0; k < 3; k++) {
        position.addScaledVector(a.fromBufferAttribute(positions, corner(low, k)), weights[k]);
        normal.addScaledVector(b.fromBufferAttribute(normals, corner(low, k)), weights[k]);
      }
      const seen = normal.clone().applyMatrix3(viewNormal).normalize();
      position.applyMatrix4(local);
      normal.applyMatrix3(localNormal).normalize();
      addSplat(packed, position, normal, matcap.colorFor(seen), radius, SLEEVE_BRUSH, random, strokeAxis);
    }
  }
  const splats = await finish(packed);
  parent.add(splats);
  return splats;
}
