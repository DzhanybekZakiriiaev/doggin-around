import * as THREE from "three"

export type Influence = { bone: number; weight: number }
export type SurfaceSample = {
  triangle: [number, number, number]
  barycentric: [number, number, number]
  position: THREE.Vector3
  normal: THREE.Vector3
  color: THREE.Color
  opacity: number
  alphaTest: number
  influences: Influence[]
  densityScale: number
  fur: boolean
}

type TexturePixels = Pick<ImageData, "width" | "height" | "data">

type SampleOptions = { furFraction?: number }

export function combineInfluences(
  vertices: Influence[][],
  barycentric: number[],
): Influence[] {
  const totals = new Map<number, number>()
  vertices.forEach((vertex, index) => {
    for (const { bone, weight } of vertex) {
      if (weight > 0)
        totals.set(bone, (totals.get(bone) ?? 0) + weight * barycentric[index])
    }
  })
  const strongest = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const sum = strongest.reduce((total, entry) => total + entry[1], 0)
  if (!(sum > 0))
    throw new Error("The model has a vertex with no usable skin weights")
  return strongest.map(([bone, weight]) => ({ bone, weight: weight / sum }))
}

export function skinMatrix(
  mesh: THREE.SkinnedMesh,
  index: number,
): THREE.Matrix4 {
  return mesh.bindMatrixInverse
    .clone()
    .multiply(mesh.skeleton.bones[index].matrixWorld)
    .multiply(mesh.skeleton.boneInverses[index])
    .multiply(mesh.bindMatrix)
}

export function deformPoint(
  mesh: THREE.SkinnedMesh,
  point: THREE.Vector3,
  influences: Influence[],
): THREE.Vector3 {
  const output = new THREE.Vector3()
  for (const { bone, weight } of influences) {
    output.addScaledVector(
      point.clone().applyMatrix4(skinMatrix(mesh, bone)),
      weight,
    )
  }
  return output
}

export function seededRandom(seed = 42): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function pixelsFor(texture: THREE.Texture): ImageData {
  const image = texture.image as CanvasImageSource & {
    width: number
    height: number
  }
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("Could not read the dog's texture")
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function pixelIndex(index: number, size: number, wrap: number): number {
  if (wrap === THREE.RepeatWrapping) return ((index % size) + size) % size
  if (wrap === THREE.MirroredRepeatWrapping) {
    const mirrored = ((index % (size * 2)) + size * 2) % (size * 2)
    return mirrored < size ? mirrored : size * 2 - mirrored - 1
  }
  return THREE.MathUtils.clamp(index, 0, size - 1)
}

export function textureColorAt(
  pixels: TexturePixels,
  texture: THREE.Texture,
  uv: THREE.Vector2,
): { color: THREE.Color; opacity: number } {
  const transformed = uv.clone()
  texture.updateMatrix()
  texture.transformUv(transformed)
  const x = transformed.x * pixels.width - 0.5
  const y = transformed.y * pixels.height - 0.5
  const left = Math.floor(x),
    top = Math.floor(y)
  const tx = x - left,
    ty = y - top
  const rgba = [0, 0, 0, 0]
  for (let row = 0; row < 2; row++) {
    const py = pixelIndex(top + row, pixels.height, texture.wrapT)
    for (let column = 0; column < 2; column++) {
      const px = pixelIndex(left + column, pixels.width, texture.wrapS)
      const offset = (py * pixels.width + px) * 4
      const weight = (column ? tx : 1 - tx) * (row ? ty : 1 - ty)
      for (let component = 0; component < 4; component++)
        rgba[component] += pixels.data[offset + component] * weight
    }
  }
  return {
    color: new THREE.Color().setRGB(
      rgba[0] / 255,
      rgba[1] / 255,
      rgba[2] / 255,
      texture.colorSpace,
    ),
    opacity: rgba[3] / 255,
  }
}

function detailWeight(colors: THREE.Color[]): number {
  const average = new THREE.Color(0, 0, 0)
  for (const color of colors) average.add(color)
  average.multiplyScalar(1 / colors.length)
  const contrast = Math.max(
    ...colors.map((color) =>
      Math.max(
        Math.abs(color.r - average.r),
        Math.abs(color.g - average.g),
        Math.abs(color.b - average.b),
      ),
    ),
  )
  const channels = [average.r, average.g, average.b]
  const chroma = Math.max(...channels) - Math.min(...channels)
  const darkness = 1 - (average.r + average.g + average.b) / 3
  return THREE.MathUtils.clamp(
    1 + contrast * 2.5 + chroma * 0.9 + darkness * 0.45,
    1,
    3,
  )
}

function isPaleFur(color: THREE.Color): boolean {
  const highest = Math.max(color.r, color.g, color.b)
  const lowest = Math.min(color.r, color.g, color.b)
  return (color.r + color.g + color.b) / 3 > 0.32 && highest - lowest < 0.17
}

export function sampleSurface(
  mesh: THREE.SkinnedMesh,
  count: number,
  random = seededRandom(),
  options: SampleOptions = {},
): { samples: SurfaceSample[]; area: number } {
  const geometry = mesh.geometry
  const positions = geometry.getAttribute("position")
  const normals = geometry.getAttribute("normal")
  const uvs = geometry.getAttribute("uv")
  const joints = geometry.getAttribute("skinIndex")
  const weights = geometry.getAttribute("skinWeight")
  if (!joints || !weights)
    throw new Error("Import a rigged GLB with skin weights")
  if (mesh.skeleton.bones.length > 256)
    throw new Error("Spark supports up to 256 bones per skin")
  const index = geometry.index
  const faceCount = Math.floor((index?.count ?? positions.count) / 3)
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material]
  const texturePixels = new Map<THREE.Texture, ImageData>()
  const faces: {
    vertices: [number, number, number]
    cumulative: number
    weight: number
    material: THREE.MeshStandardMaterial
  }[] = []
  let area = 0
  let weightedArea = 0
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3()
  for (let face = 0; face < faceCount; face++) {
    const offset = face * 3
    const vertices: [number, number, number] = [0, 1, 2].map((i) =>
      index ? index.getX(offset + i) : offset + i,
    ) as [number, number, number]
    a.fromBufferAttribute(positions, vertices[0])
    b.fromBufferAttribute(positions, vertices[1])
    c.fromBufferAttribute(positions, vertices[2])
    const faceArea = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
    if (faceArea === 0) continue
    area += faceArea
    const group = geometry.groups.find(
      (entry) => offset >= entry.start && offset < entry.start + entry.count,
    )
    const material = materials[
      group?.materialIndex ?? 0
    ] as THREE.MeshStandardMaterial
    if (count > 0 && material.map && !texturePixels.has(material.map))
      texturePixels.set(material.map, pixelsFor(material.map))
    const colors = [material.color?.clone() ?? new THREE.Color("white")]
    if (count > 0 && material.map && uvs) {
      const pixels = texturePixels.get(material.map) as ImageData
      for (const vertex of vertices) {
        const uv = new THREE.Vector2(uvs.getX(vertex), uvs.getY(vertex))
        colors.push(
          textureColorAt(pixels, material.map, uv).color.multiply(colors[0]),
        )
      }
    }
    const weight =
      count > 0 ? detailWeight(colors.length > 1 ? colors.slice(1) : colors) : 1
    weightedArea += faceArea * weight
    faces.push({ vertices, cumulative: weightedArea, weight, material })
  }
  if (!faces.length) throw new Error("The dog contains no usable triangles")
  if (count === 0) return { samples: [], area }
  const samples: SurfaceSample[] = []
  const bounds = new THREE.Box3().setFromObject(mesh)
  const furTop = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.78
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const furDepth =
    (geometry.boundingBox?.getSize(new THREE.Vector3()).length() ?? 1) * 0.007
  const pickSample = (): SurfaceSample => {
    const pick = random() * weightedArea
    let low = 0,
      high = faces.length - 1
    while (low < high) {
      const mid = (low + high) >>> 1
      if (faces[mid].cumulative < pick) low = mid + 1
      else high = mid
    }
    const { vertices, material, weight } = faces[low]
    const root = Math.sqrt(random())
    const second = random()
    const barycentric: [number, number, number] = [
      1 - root,
      root * (1 - second),
      root * second,
    ]
    const position = new THREE.Vector3(),
      normal = new THREE.Vector3(),
      uv = new THREE.Vector2()
    const influences = vertices.map((vertex) => {
      const result: Influence[] = []
      for (let component = 0; component < 4; component++)
        result.push({
          bone: joints.getComponent(vertex, component),
          weight: weights.getComponent(vertex, component),
        })
      return result
    })
    vertices.forEach((vertex, i) => {
      position.addScaledVector(
        new THREE.Vector3().fromBufferAttribute(positions, vertex),
        barycentric[i],
      )
      if (normals)
        normal.addScaledVector(
          new THREE.Vector3().fromBufferAttribute(normals, vertex),
          barycentric[i],
        )
      if (uvs)
        uv.addScaledVector(
          new THREE.Vector2(uvs.getX(vertex), uvs.getY(vertex)),
          barycentric[i],
        )
    })
    if (!normals) {
      a.fromBufferAttribute(positions, vertices[0])
      b.fromBufferAttribute(positions, vertices[1])
      c.fromBufferAttribute(positions, vertices[2])
      normal.copy(b.sub(a).cross(c.sub(a)))
    }
    normal.normalize()
    const color = material.color?.clone() ?? new THREE.Color("white")
    let opacity = material.opacity
    if (material.map && uvs) {
      const pixels = texturePixels.get(material.map) as ImageData
      const texel = textureColorAt(pixels, material.map, uv)
      color.multiply(texel.color)
      opacity *= texel.opacity
    }
    return {
      triangle: vertices,
      barycentric,
      position,
      normal,
      color,
      opacity,
      alphaTest: material.alphaTest,
      influences: combineInfluences(influences, barycentric),
      densityScale: Math.sqrt(weightedArea / (area * weight)),
      fur: false,
    }
  }
  let furCount = Math.round(
    count * THREE.MathUtils.clamp(options.furFraction ?? 0, 0, 0.25),
  )
  const surfaceCount = count - furCount
  for (
    let attempts = 0;
    samples.length < surfaceCount && attempts < count * 20;
    attempts++
  ) {
    const sample = pickSample()
    if (sample.opacity > Math.max(sample.alphaTest, 0.01)) samples.push(sample)
  }
  if (
    samples.filter((sample) => isPaleFur(sample.color)).length <
    surfaceCount * 0.2
  )
    furCount = 0
  let addedFur = 0
  for (
    let attempts = 0;
    addedFur < furCount && attempts < furCount * 16;
    attempts++
  ) {
    const sample = pickSample()
    if (
      sample.opacity <= Math.max(sample.alphaTest, 0.01) ||
      !isPaleFur(sample.color)
    )
      continue
    if (sample.position.clone().applyMatrix4(mesh.matrixWorld).y > furTop)
      continue
    sample.position.addScaledVector(sample.normal, furDepth * (0.5 + random()))
    sample.fur = true
    samples.push(sample)
    addedFur++
  }
  for (
    let attempts = 0;
    samples.length < count && attempts < count * 20;
    attempts++
  ) {
    const sample = pickSample()
    if (sample.opacity > Math.max(sample.alphaTest, 0.01)) samples.push(sample)
  }
  if (count > 0 && !samples.length)
    throw new Error("The model's surface is entirely transparent")
  return { samples, area }
}
