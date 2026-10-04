import { dyno, ExtSplats, SplatMesh } from "@sparkjsdev/spark"
import * as THREE from "three"
import {
  type BakedClip,
  FaceDeformation,
  finitePositions,
  NEAREST_FACES,
  sampleBakedClip,
} from "./faceDeformation"

export type GaitCadence = Record<
  "walk" | "run",
  { cyclesPerSecond: number; travelSpeed: number }
>
export type FaceAppearanceManifest = {
  version: 1
  kind: "smal-pets-faces"
  count: number
  vertexCount: number
  faceCount: number
  nearestFaces: 10
  coordinateSpace: "mesh-local-y-up"
  topologyHash: string
  files: Record<
    "splats" | "restPositions" | "faces" | "faceIds" | "weights",
    string
  > & { restTransforms?: string }
  clips: { name: string; duration: number; times: string; positions: string }[]
  mouth: { face: number; barycentric: [number, number, number] }
  gaitCadence: GaitCadence
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid face appearance manifest")
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function path(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function parseFaceManifest(value: unknown): FaceAppearanceManifest {
  const manifest = record(value)
  if (
    manifest.version !== 1 ||
    manifest.kind !== "smal-pets-faces" ||
    manifest.nearestFaces !== NEAREST_FACES ||
    manifest.coordinateSpace !== "mesh-local-y-up" ||
    !positiveInteger(manifest.count) ||
    !positiveInteger(manifest.vertexCount) ||
    !positiveInteger(manifest.faceCount) ||
    manifest.faceCount > 65536 ||
    typeof manifest.topologyHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(manifest.topologyHash)
  )
    throw new Error("Invalid face appearance manifest")
  const files = record(manifest.files)
  for (const key of ["splats", "restPositions", "faces", "faceIds", "weights"])
    if (!path(files[key]))
      throw new Error(`Missing face appearance file: ${key}`)
  if (files.restTransforms !== undefined && !path(files.restTransforms))
    throw new Error("Invalid rest transform file")
  if (!Array.isArray(manifest.clips) || manifest.clips.length === 0)
    throw new Error("Missing baked animation clips")
  const names = new Set<string>()
  for (const value of manifest.clips) {
    const clip = record(value)
    if (
      !path(clip.name) ||
      names.has(clip.name) ||
      typeof clip.duration !== "number" ||
      !Number.isFinite(clip.duration) ||
      clip.duration <= 0 ||
      !path(clip.times) ||
      !path(clip.positions)
    )
      throw new Error("Invalid baked animation clip")
    names.add(clip.name)
  }
  const mouth = record(manifest.mouth)
  if (
    typeof mouth.face !== "number" ||
    !Number.isInteger(mouth.face) ||
    mouth.face < 0 ||
    mouth.face >= manifest.faceCount ||
    !Array.isArray(mouth.barycentric) ||
    mouth.barycentric.length !== 3 ||
    mouth.barycentric.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1,
    ) ||
    Math.abs(
      mouth.barycentric.reduce((sum: number, value: number) => sum + value, 0) -
        1,
    ) > 1e-5
  )
    throw new Error("Invalid mouth attachment")
  const cadence = record(manifest.gaitCadence)
  for (const name of ["walk", "run"]) {
    const gait = record(cadence[name])
    if (
      typeof gait.cyclesPerSecond !== "number" ||
      !Number.isFinite(gait.cyclesPerSecond) ||
      gait.cyclesPerSecond <= 0 ||
      typeof gait.travelSpeed !== "number" ||
      !Number.isFinite(gait.travelSpeed) ||
      gait.travelSpeed <= 0
    )
      throw new Error("Invalid gait cadence")
  }
  return manifest as unknown as FaceAppearanceManifest
}

async function bytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}`)
  return response.arrayBuffer()
}

export function readFaceFloats(
  buffer: ArrayBuffer,
  length?: number,
): Float32Array {
  if (
    buffer.byteLength % 4 ||
    (length !== undefined && buffer.byteLength !== length * 4)
  )
    throw new Error("Face appearance float data has the wrong size")
  const values = new Float32Array(buffer.byteLength / 4)
  const view = new DataView(buffer)
  for (let index = 0; index < values.length; index++)
    values[index] = view.getFloat32(index * 4, true)
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error("Non-finite face appearance data")
  return values
}

function readIndices(
  buffer: ArrayBuffer,
  length: number,
  bits: 16 | 32,
): Uint16Array | Uint32Array {
  if (buffer.byteLength !== length * (bits / 8))
    throw new Error("Face appearance index data has the wrong size")
  const values = bits === 16 ? new Uint16Array(length) : new Uint32Array(length)
  const view = new DataView(buffer)
  for (let index = 0; index < length; index++)
    values[index] =
      bits === 16
        ? view.getUint16(index * 2, true)
        : view.getUint32(index * 4, true)
  return values
}

export function validateFaceBinding(
  ids: Uint16Array,
  weights: Float32Array,
  faceCount: number,
): void {
  if (ids.length !== weights.length || ids.length % NEAREST_FACES)
    throw new Error("Invalid nearest-face binding size")
  for (let offset = 0; offset < ids.length; offset += NEAREST_FACES) {
    let total = 0
    for (let neighbor = 0; neighbor < NEAREST_FACES; neighbor++) {
      const index = offset + neighbor
      if (
        ids[index] >= faceCount ||
        !Number.isFinite(weights[index]) ||
        weights[index] < 0
      )
        throw new Error("Invalid nearest-face binding")
      total += weights[index]
    }
    if (Math.abs(total - 1) > 1e-4)
      throw new Error("Nearest-face weights must be normalized")
  }
}

export function validateRestTransforms(
  transforms: Float32Array,
  count: number,
): void {
  if (transforms.length !== count * 8)
    throw new Error("Rest transforms have the wrong size")
  for (let offset = 0; offset < transforms.length; offset += 8) {
    const quaternionNorm = Math.hypot(
      ...transforms.subarray(offset, offset + 4),
    )
    if (
      !transforms.subarray(offset, offset + 8).every(Number.isFinite) ||
      quaternionNorm <= 1e-8 ||
      transforms.subarray(offset + 4, offset + 7).some((scale) => scale <= 0)
    )
      throw new Error("Invalid rest Gaussian transform")
  }
}

export function validateBakedClip(clip: BakedClip, vertexCount: number): void {
  if (
    clip.times.length < 2 ||
    Math.abs(clip.times[0]) > 1e-5 ||
    Math.abs(clip.times[clip.times.length - 1] - clip.duration) > 1e-4 ||
    clip.times.some(
      (time, index) =>
        !Number.isFinite(time) ||
        time < 0 ||
        (index > 0 && time <= clip.times[index - 1]),
    )
  )
    throw new Error("Invalid baked animation timestamps")
  finitePositions(clip.positions, clip.times.length * vertexCount * 3)
}

function dataTexture(
  data: Float32Array | Uint32Array,
  texels: number,
): THREE.DataTexture {
  const width = Math.min(2048, Math.max(1, texels))
  const height = Math.ceil(texels / width)
  const padded =
    data instanceof Float32Array
      ? new Float32Array(width * height * 4)
      : new Uint32Array(width * height * 4)
  padded.set(data)
  const texture = new THREE.DataTexture(
    padded,
    width,
    height,
    data instanceof Float32Array ? THREE.RGBAFormat : THREE.RGBAIntegerFormat,
    data instanceof Float32Array ? THREE.FloatType : THREE.UnsignedIntType,
  )
  texture.internalFormat = data instanceof Float32Array ? "RGBA32F" : "RGBA32UI"
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function faceModifier(
  ids: THREE.DataTexture,
  weights: THREE.DataTexture,
  frames: THREE.DataTexture,
  transforms?: THREE.DataTexture,
) {
  const idUniform = new dyno.DynoUsampler2D({ key: "faceIds", value: ids })
  const weightUniform = new dyno.DynoSampler2D({
    key: "faceWeights",
    value: weights,
  })
  const frameUniform = new dyno.DynoSampler2D({
    key: "faceFrames",
    value: frames,
  })
  const transformUniform = new dyno.DynoSampler2D({
    key: "faceRestTransforms",
    value: transforms ?? frames,
  })
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const modifier = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          ids: "usampler2D",
          weights: "sampler2D",
          frames: "sampler2D",
          transforms: "sampler2D",
        },
        outTypes: { gsplat: dyno.Gsplat },
        inputs: {
          gsplat,
          ids: idUniform,
          weights: weightUniform,
          frames: frameUniform,
          transforms: transformUniform,
        },
        globals: () => [
          `vec4 smalFaceQuatMul(vec4 a, vec4 b) {
          return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
        }
        vec3 smalFaceQuatRotate(vec4 q, vec3 p) {
          return p + 2.0 * cross(q.xyz, cross(q.xyz, p) + q.w * p);
        }
        ivec2 smalFaceTexel(int index, int width) {
          return ivec2(index % width, index / width);
        }`,
        ],
        statements: ({ inputs, outputs }) => [
          `${outputs.gsplat} = ${inputs.gsplat};
        if (isGsplatActive(${outputs.gsplat}.flags)) {
          vec3 center = vec3(0.0);
          vec4 rotation = vec4(0.0);
          vec4 reference = vec4(0.0);
          float scale = 0.0;
          ${
            transforms
              ? `int transformIndex = ${inputs.gsplat}.index * 2;
          int transformWidth = textureSize(${inputs.transforms}, 0).x;
          vec4 restRotation = normalize(texelFetch(${inputs.transforms}, smalFaceTexel(transformIndex, transformWidth), 0));
          vec3 restScale = texelFetch(${inputs.transforms}, smalFaceTexel(transformIndex + 1, transformWidth), 0).xyz;`
              : `vec4 restRotation = ${inputs.gsplat}.quaternion;
          vec3 restScale = ${inputs.gsplat}.scales;`
          }
          for (int neighbor = 0; neighbor < 10; ++neighbor) {
            int binding = ${inputs.gsplat}.index * 3 + neighbor / 4;
            uint face = texelFetch(${inputs.ids}, smalFaceTexel(binding, textureSize(${inputs.ids}, 0).x), 0)[neighbor % 4];
            float weight = texelFetch(${inputs.weights}, smalFaceTexel(binding, textureSize(${inputs.weights}, 0).x), 0)[neighbor % 4];
            int frame = int(face) * 3;
            int width = textureSize(${inputs.frames}, 0).x;
            vec4 rest = texelFetch(${inputs.frames}, smalFaceTexel(frame, width), 0);
            vec3 posed = texelFetch(${inputs.frames}, smalFaceTexel(frame + 1, width), 0).xyz;
            vec4 delta = texelFetch(${inputs.frames}, smalFaceTexel(frame + 2, width), 0);
            center += weight * (smalFaceQuatRotate(delta, ${inputs.gsplat}.center - rest.xyz) + posed);
            vec4 candidate = smalFaceQuatMul(delta, restRotation);
            if (neighbor == 0) reference = candidate;
            rotation += weight * candidate * (dot(candidate, reference) < 0.0 ? -1.0 : 1.0);
            scale += weight * rest.w;
          }
          ${outputs.gsplat}.center = center;
          ${outputs.gsplat}.quaternion = dot(rotation, rotation) > 1e-16 ? normalize(rotation) : reference;
          ${outputs.gsplat}.scales = restScale * scale;
        }`,
        ],
      })
      return { gsplat: modifier.outputs.gsplat }
    },
  )
}

export class FaceAppearance {
  readonly splats: SplatMesh
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  readonly vertexPositions: Float32Array
  readonly maxDensity: number
  readonly gaitCadence: GaitCadence
  readonly clips: Map<string, BakedClip>
  private readonly sampledPositions: Float32Array
  private readonly mouthPositions: Float32Array
  private readonly deformation: FaceDeformation
  private readonly textures: THREE.DataTexture[] = []
  private disposed = false
  private readonly mouthPoint = new THREE.Vector3()

  constructor(
    readonly manifest: FaceAppearanceManifest,
    source: ExtSplats,
    restPositions: Float32Array,
    private readonly faces: Uint32Array,
    faceIds: Uint16Array,
    weights: Float32Array,
    clips: BakedClip[],
    readonly manifestUrl: string,
    restTransforms?: Float32Array,
  ) {
    if (restTransforms) validateRestTransforms(restTransforms, manifest.count)
    this.maxDensity = manifest.count
    this.gaitCadence = manifest.gaitCadence
    this.clips = new Map(clips.map((clip) => [clip.name, clip]))
    this.vertexPositions = restPositions.slice()
    this.sampledPositions = restPositions.slice()
    this.mouthPositions = restPositions.slice()
    this.deformation = new FaceDeformation(restPositions, faces)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.vertexPositions, 3),
    )
    geometry.setIndex(new THREE.BufferAttribute(faces, 1))
    geometry.computeVertexNormals()
    const material = new THREE.MeshStandardMaterial({
      color: 0xd0c5b6,
      roughness: 1,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    try {
      const packedIds = new Uint32Array(source.numSplats * 12)
      const packedWeights = new Float32Array(source.numSplats * 12)
      for (let index = 0; index < source.numSplats; index++) {
        packedIds.set(faceIds.subarray(index * 10, index * 10 + 10), index * 12)
        packedWeights.set(
          weights.subarray(index * 10, index * 10 + 10),
          index * 12,
        )
      }
      this.textures.push(dataTexture(packedIds, source.numSplats * 3))
      this.textures.push(dataTexture(packedWeights, source.numSplats * 3))
      this.textures.push(
        dataTexture(this.deformation.data, manifest.faceCount * 3),
      )
      if (restTransforms)
        this.textures.push(
          dataTexture(
            restTransforms.subarray(0, source.numSplats * 8),
            source.numSplats * 2,
          ),
        )
      this.splats = new SplatMesh({
        extSplats: source,
        covSplats: true,
        objectModifier: faceModifier(
          this.textures[0],
          this.textures[1],
          this.textures[2],
          this.textures[3],
        ),
        enableLod: false,
      })
    } catch (error) {
      for (const texture of this.textures) texture.dispose()
      geometry.dispose()
      material.dispose()
      throw error
    }
  }

  sample(
    clipName: string,
    time: number,
    target = this.sampledPositions,
  ): Float32Array {
    const clip = this.clips.get(clipName)
    if (!clip) throw new Error(`Missing baked animation clip: ${clipName}`)
    return sampleBakedClip(clip, time, target)
  }

  updatePositions(positions: Float32Array): void {
    if (
      positions !== this.vertexPositions &&
      positions.length === this.vertexPositions.length &&
      positions.every((value, index) => value === this.vertexPositions[index])
    )
      return
    this.deformation.updatePositions(positions)
    if (positions !== this.vertexPositions) this.vertexPositions.set(positions)
    this.mesh.geometry.getAttribute("position").needsUpdate = true
    this.mesh.geometry.computeVertexNormals()
    this.mesh.geometry.computeBoundingSphere()
    const texture = this.textures[2]
    const textureData = texture.image.data as Float32Array
    textureData.set(this.deformation.data)
    texture.needsUpdate = true
    this.splats.needsUpdate = true
  }

  getMouthPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.mouthAtPositions(this.vertexPositions, target)
  }

  sampleMouthPosition(
    clipName: string,
    time: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    this.sample(clipName, time, this.mouthPositions)
    return this.mouthAtPositions(this.mouthPositions, target)
  }

  private mouthAtPositions(
    positions: Float32Array,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    target.set(0, 0, 0)
    for (let corner = 0; corner < 3; corner++) {
      const vertex = this.faces[this.manifest.mouth.face * 3 + corner]
      this.mouthPoint.fromArray(positions, vertex * 3)
      target.addScaledVector(
        this.mouthPoint,
        this.manifest.mouth.barycentric[corner],
      )
    }
    this.mesh.updateWorldMatrix(true, false)
    return target.applyMatrix4(this.mesh.matrixWorld)
  }

  checkTextureSize(renderer: THREE.WebGLRenderer): void {
    if (
      this.textures.some(
        (texture) =>
          texture.image.width > renderer.capabilities.maxTextureSize ||
          texture.image.height > renderer.capabilities.maxTextureSize,
      )
    )
      throw new Error("Face binding exceeds this device's texture size")
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.splats.removeFromParent()
    this.splats.dispose()
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    for (const texture of this.textures) texture.dispose()
  }
}

export async function loadFaceAppearance(
  manifestUrl: string,
  count: number,
): Promise<FaceAppearance> {
  if (!Number.isFinite(count) || count <= 0)
    throw new Error("Invalid Gaussian density")
  const url = new URL(manifestUrl, window.location.href)
  const response = await fetch(url)
  if (!response.ok)
    throw new Error("Could not load the face appearance manifest")
  const manifest = parseFaceManifest(await response.json())
  const resolve = (path: string) => new URL(path, url).href
  const [restBytes, faceBytes, idBytes, weightBytes, clips, transformBytes] =
    await Promise.all([
      bytes(resolve(manifest.files.restPositions)),
      bytes(resolve(manifest.files.faces)),
      bytes(resolve(manifest.files.faceIds)),
      bytes(resolve(manifest.files.weights)),
      Promise.all(
        manifest.clips.map(async (clip): Promise<BakedClip> => {
          const [timeBytes, positionBytes] = await Promise.all([
            bytes(resolve(clip.times)),
            bytes(resolve(clip.positions)),
          ])
          const result = {
            ...clip,
            times: readFaceFloats(timeBytes),
            positions: readFaceFloats(positionBytes),
          }
          validateBakedClip(result, manifest.vertexCount)
          return result
        }),
      ),
      manifest.files.restTransforms
        ? bytes(resolve(manifest.files.restTransforms))
        : undefined,
    ])
  const restPositions = readFaceFloats(restBytes, manifest.vertexCount * 3)
  const faces = readIndices(
    faceBytes,
    manifest.faceCount * 3,
    32,
  ) as Uint32Array
  const digest = await crypto.subtle.digest("SHA-256", faceBytes)
  const topologyHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  if (topologyHash !== manifest.topologyHash.toLowerCase())
    throw new Error("Face appearance topology hash does not match")
  const faceIds = readIndices(
    idBytes,
    manifest.count * NEAREST_FACES,
    16,
  ) as Uint16Array
  const weights = readFaceFloats(weightBytes, manifest.count * NEAREST_FACES)
  validateFaceBinding(faceIds, weights, manifest.faceCount)
  const restTransforms = transformBytes
    ? readFaceFloats(transformBytes, manifest.count * 8)
    : undefined
  if (restTransforms) validateRestTransforms(restTransforms, manifest.count)
  const source = new ExtSplats({ url: resolve(manifest.files.splats) })
  let appearance: FaceAppearance | undefined
  try {
    await source.initialized
    if (source.numSplats !== manifest.count)
      throw new Error("Face appearance has the wrong Gaussian count")
    source.numSplats = Math.min(Math.max(1, Math.floor(count)), manifest.count)
    appearance = new FaceAppearance(
      manifest,
      source,
      restPositions,
      faces,
      faceIds,
      weights,
      clips,
      url.href,
      restTransforms,
    )
    await appearance.splats.initialized
    return appearance
  } catch (error) {
    if (appearance) appearance.dispose()
    else source.dispose()
    throw error
  }
}
