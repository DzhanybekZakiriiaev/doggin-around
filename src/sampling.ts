import * as THREE from "three"

export type Influence = { bone: number; weight: number }
export type SurfaceSample = {
  triangle: [number, number, number]
  barycentric: [number, number, number]
  position: THREE.Vector3
  normal: THREE.Vector3
  color: THREE.Color
  opacity: number
  influences: Influence[]
}

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

export function sampleSurface(
  mesh: THREE.SkinnedMesh,
  count: number,
  random = seededRandom(),
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
    material: THREE.MeshStandardMaterial
  }[] = []
  let area = 0
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
    if (material.map && !texturePixels.has(material.map))
      texturePixels.set(material.map, pixelsFor(material.map))
    faces.push({ vertices, cumulative: area, material })
  }
  if (!faces.length) throw new Error("The dog contains no usable triangles")
  const samples: SurfaceSample[] = []
  for (
    let attempts = 0;
    samples.length < count && attempts < count * 20;
    attempts++
  ) {
    const pick = random() * area
    let low = 0,
      high = faces.length - 1
    while (low < high) {
      const mid = (low + high) >>> 1
      if (faces[mid].cumulative < pick) low = mid + 1
      else high = mid
    }
    const { vertices, material } = faces[low]
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
      material.map.updateMatrix()
      material.map.transformUv(uv)
      const pixels = texturePixels.get(material.map) as ImageData
      const x = Math.min(
        pixels.width - 1,
        Math.max(0, Math.floor(uv.x * pixels.width)),
      )
      const y = Math.min(
        pixels.height - 1,
        Math.max(0, Math.floor(uv.y * pixels.height)),
      )
      const offset = (y * pixels.width + x) * 4
      const texel = new THREE.Color().setRGB(
        pixels.data[offset] / 255,
        pixels.data[offset + 1] / 255,
        pixels.data[offset + 2] / 255,
        material.map.colorSpace,
      )
      color.multiply(texel)
      opacity *= pixels.data[offset + 3] / 255
    }
    if (opacity <= Math.max(material.alphaTest, 0.01)) continue
    samples.push({
      triangle: vertices,
      barycentric,
      position,
      normal,
      color,
      opacity,
      influences: combineInfluences(influences, barycentric),
    })
  }
  if (count > 0 && !samples.length)
    throw new Error("The model's surface is entirely transparent")
  return { samples, area }
}
