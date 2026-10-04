import {
  ExtSplats,
  SplatMesh,
  SplatSkinning,
  SplatSkinningMode,
} from "@sparkjsdev/spark"
import * as THREE from "three"

const APPEARANCE = "/models/dog-triposplat-50000"

type AppearanceMetadata = {
  count: number
  bone_names: string[]
}

async function assetBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}`)
  return response.arrayBuffer()
}

export async function loadRiggedAppearance(
  source: THREE.SkinnedMesh,
  count: number,
): Promise<{ splats: SplatMesh; skinning: SplatSkinning }> {
  const [metadataResponse, jointBytes, weightBytes] = await Promise.all([
    fetch(`${APPEARANCE}.json`),
    assetBytes(`${APPEARANCE}-joints.bin`),
    assetBytes(`${APPEARANCE}-weights.bin`),
  ])
  if (!metadataResponse.ok) throw new Error("Could not load the dog appearance")
  const metadata = (await metadataResponse.json()) as AppearanceMetadata
  if (
    !Number.isInteger(metadata.count) ||
    metadata.count !== 50000 ||
    !Array.isArray(metadata.bone_names)
  )
    throw new Error("Invalid dog appearance metadata")
  if (
    jointBytes.byteLength !== metadata.count * 4 ||
    weightBytes.byteLength !== metadata.count * 4 * 4
  )
    throw new Error("Dog appearance skin data has the wrong size")
  const boneLookup = new Map(
    source.skeleton.bones.map((bone, index) => [bone.name, index]),
  )
  const boneMap = metadata.bone_names.map((name) => boneLookup.get(name) ?? -1)
  if (boneMap.some((index) => index < 0))
    throw new Error("Dog appearance does not match this skeleton")
  const all = new ExtSplats({ url: `${APPEARANCE}.ply` })
  let selected: ExtSplats = all
  let splats: SplatMesh | undefined
  try {
    await all.initialized
    if (all.numSplats !== metadata.count)
      throw new Error("Dog appearance has the wrong splat count")
    const visibleCount = Math.min(Math.max(1, count), metadata.count)
    if (visibleCount < metadata.count) {
      selected = new ExtSplats()
      for (let index = 0; index < visibleCount; index++) {
        const splat = all.getSplat(index)
        selected.pushSplat(
          splat.center,
          splat.scales,
          splat.quaternion,
          splat.opacity,
          splat.color,
        )
      }
      selected.reinitialize({
        extArrays: selected.extArrays,
        numSplats: selected.numSplats,
      })
      all.dispose()
    }
    splats = new SplatMesh({
      extSplats: selected,
      covSplats: true,
      enableLod: false,
    })
    await splats.initialized
    const skinning = new SplatSkinning({
      mesh: splats,
      numBones: source.skeleton.bones.length,
      mode: SplatSkinningMode.LINEAR_BLEND,
    })
    for (let bone = 0; bone < source.skeleton.bones.length; bone++)
      skinning.setRestMatrix(bone, new THREE.Matrix4())
    const joints = new Uint8Array(jointBytes)
    const weightView = new DataView(weightBytes)
    for (let index = 0; index < visibleCount; index++) {
      const boneIndices = new THREE.Vector4()
      const weights = new THREE.Vector4()
      for (let component = 0; component < 4; component++) {
        const offset = index * 4 + component
        const mapped = boneMap[joints[offset]]
        if (mapped === undefined)
          throw new Error("Dog appearance uses an unknown bone")
        boneIndices.setComponent(component, mapped)
        weights.setComponent(component, weightView.getFloat32(offset * 4, true))
      }
      skinning.setSplatBones(index, boneIndices, weights)
    }
    splats.skinning = skinning
    splats.updateGenerator()
    splats.matrixAutoUpdate = false
    splats.matrix.copy(source.matrix)
    return { splats, skinning }
  } catch (error) {
    splats?.dispose()
    if (!splats) selected.dispose()
    throw error
  }
}
