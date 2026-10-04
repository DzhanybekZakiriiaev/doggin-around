import {
  ExtSplats,
  SplatMesh,
  SplatSkinning,
  SplatSkinningMode,
} from "@sparkjsdev/spark"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { sampleSurface, skinMatrix } from "./sampling"

export const DOG_ACTIONS = [
  { name: "idle", label: "Idle", icon: "◌", playback: "loop" },
  { name: "walk", label: "Walk", icon: "↝", playback: "loop" },
  { name: "run", label: "Run", icon: "»", playback: "loop" },
  { name: "sit", label: "Sit", icon: "⌄", playback: "hold" },
  { name: "jump", label: "Jump", icon: "↑", playback: "once" },
  { name: "bark", label: "Bark", icon: "◖", playback: "once" },
  { name: "paw", label: "Paw", icon: "✧", playback: "once" },
  { name: "spin", label: "Spin", icon: "⟳", playback: "once" },
  { name: "playbow", label: "Play bow", icon: "⌁", playback: "once" },
  { name: "sniff", label: "Sniff", icon: "⋯", playback: "loop" },
  { name: "wag", label: "Wag", icon: "∿", playback: "loop" },
] as const

export type DogAction = (typeof DOG_ACTIONS)[number]["name"]
export type DogView = "splats" | "mesh" | "skeleton"
type Skin = {
  source: THREE.SkinnedMesh
  splats: SplatMesh
  skinning: SplatSkinning
}

export class Dog {
  readonly group = new THREE.Group()
  action: DogAction = "idle"
  paused = false
  speed = 1
  density = 50000
  sampleCount = 0
  private root?: THREE.Group
  private mixer?: THREE.AnimationMixer
  private actions = new Map<DogAction, THREE.AnimationAction>()
  private skins: Skin[] = []
  private helpers: THREE.SkeletonHelper[] = []
  private active?: THREE.AnimationAction
  private loadVersion = 0
  private view: DogView = "splats"

  get availableActions(): DogAction[] {
    return DOG_ACTIONS.map(({ name }) => name).filter((name) =>
      this.actions.has(name),
    )
  }

  async loadDog(assetUrl: string): Promise<void> {
    const version = ++this.loadVersion
    const gltf = await new GLTFLoader().loadAsync(assetUrl)
    if (version !== this.loadVersion) {
      this.releaseRoot(gltf.scene)
      return
    }
    const sources: THREE.SkinnedMesh[] = []
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sources.push(object)
    })
    if (!sources.length) {
      this.releaseRoot(gltf.scene)
      throw new Error(
        "This GLB has no skinned mesh. Use AniGen's rigged mesh export",
      )
    }
    const clips = new Map(
      gltf.animations.map((clip) => [clip.name.toLowerCase(), clip]),
    )
    if (!clips.has("idle")) {
      this.releaseRoot(gltf.scene)
      throw new Error("Missing idle clip. Run the Blender animation step first")
    }
    this.clear()
    this.root = gltf.scene
    this.group.add(this.root)
    const box = new THREE.Box3().setFromObject(this.root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const scale = 2.6 / Math.max(size.x, size.y, size.z)
    this.root.scale.multiplyScalar(scale)
    this.root.position.set(
      -center.x * scale,
      -box.min.y * scale,
      -center.z * scale,
    )
    this.root.updateMatrixWorld(true)
    this.mixer = new THREE.AnimationMixer(this.root)
    this.mixer.addEventListener("finished", (event) => {
      if (event.action === this.active && this.action !== "sit")
        this.playAction("idle")
    })
    for (const { name, playback } of DOG_ACTIONS) {
      const clip = clips.get(name)
      if (!clip) continue
      const action = this.mixer.clipAction(clip)
      if (playback === "loop") {
        action.setLoop(THREE.LoopRepeat, Infinity)
      } else {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      this.actions.set(name, action)
    }
    for (const source of sources) {
      const helper = new THREE.SkeletonHelper(source.skeleton.bones[0])
      const materials = Array.isArray(helper.material)
        ? helper.material
        : [helper.material]
      for (const material of materials) material.depthTest = false
      this.group.add(helper)
      this.helpers.push(helper)
    }
    try {
      await this.rebuildSplats()
      this.playAction("idle")
    } catch (error) {
      this.clear()
      throw error
    }
  }

  async rebuildSplats(density = this.density): Promise<void> {
    if (!this.root) return
    this.density = density
    this.mixer?.stopAllAction()
    this.root.updateMatrixWorld(true)
    const sources: THREE.SkinnedMesh[] = []
    this.root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sources.push(object)
    })
    const newSkins: Skin[] = []
    try {
      const probes = sources.map((source) => sampleSurface(source, 0))
      const totalArea = probes.reduce((sum, probe) => sum + probe.area, 0)
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index]
        const count = Math.max(
          1,
          Math.round((density * probes[index].area) / totalArea),
        )
        const { samples, area } = sampleSurface(source, count)
        const packed = new ExtSplats()
        const radius = Math.sqrt(area / samples.length) * 0.85
        const scales = new THREE.Vector3(radius, radius, radius * 0.16)
        for (const sample of samples) {
          const rotation = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            sample.normal,
          )
          packed.pushSplat(
            sample.position,
            scales,
            rotation,
            sample.opacity,
            sample.color,
          )
        }
        packed.reinitialize({
          extArrays: packed.extArrays,
          numSplats: packed.numSplats,
        })
        const splats = new SplatMesh({
          extSplats: packed,
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
        samples.forEach((sample, i) => {
          const bones = new THREE.Vector4(0, 0, 0, 0),
            weights = new THREE.Vector4(0, 0, 0, 0)
          sample.influences.forEach((influence, j) => {
            bones.setComponent(j, influence.bone)
            weights.setComponent(j, influence.weight)
          })
          skinning.setSplatBones(i, bones, weights)
        })
        splats.skinning = skinning
        splats.updateGenerator()
        splats.matrixAutoUpdate = false
        splats.matrix.copy(source.matrix)
        newSkins.push({ source, splats, skinning })
        await splats.initialized
      }
    } catch (error) {
      for (const skin of newSkins) this.releaseSkin(skin)
      this.playAction("idle")
      throw error
    }
    for (const skin of this.skins) this.releaseSkin(skin)
    this.skins = newSkins
    for (const { source, splats } of this.skins) source.parent?.add(splats)
    this.sampleCount = this.skins.reduce(
      (count, skin) => count + skin.splats.numSplats,
      0,
    )
    this.setView(this.view)
    this.playAction("idle")
    this.update(0)
  }

  playAction(name: DogAction): void {
    const next = this.actions.get(name)
    if (!next) return
    const previous = this.active
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play()
    if (previous && previous !== next) {
      previous.fadeOut(0.2)
      next.fadeIn(0.2)
    }
    this.active = next
    this.action = name
  }

  setView(view: DogView): void {
    this.view = view
    this.root?.traverse((object) => {
      if (object instanceof THREE.Mesh && !(object instanceof SplatMesh))
        object.visible = view === "mesh"
    })
    for (const skin of this.skins) skin.splats.visible = view === "splats"
    for (const helper of this.helpers) helper.visible = view === "skeleton"
  }

  update(delta: number): void {
    this.mixer?.update(this.paused ? 0 : Math.min(delta, 0.1) * this.speed)
    this.group.updateMatrixWorld(true)
    for (const { source, skinning, splats } of this.skins) {
      splats.matrix.copy(source.matrix)
      for (let i = 0; i < source.skeleton.bones.length; i++)
        skinning.setBoneMatrix(i, skinMatrix(source, i))
      skinning.updateBones()
    }
  }

  private releaseSkin({ splats, skinning }: Skin): void {
    splats.removeFromParent()
    skinning.skinTexture.dispose()
    skinning.boneTexture.dispose()
    splats.dispose()
  }

  private releaseRoot(root: THREE.Object3D): void {
    const textures = new Set<THREE.Texture>()
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]
      for (const material of materials) {
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value)
        material.dispose()
      }
    })
    for (const texture of textures) {
      texture.dispose()
      if (
        typeof ImageBitmap !== "undefined" &&
        texture.image instanceof ImageBitmap
      )
        texture.image.close()
    }
  }

  private clear(): void {
    for (const skin of this.skins) this.releaseSkin(skin)
    this.skins = []
    for (const helper of this.helpers) {
      helper.removeFromParent()
      helper.dispose()
    }
    this.helpers = []
    if (this.root) {
      this.mixer?.stopAllAction()
      this.mixer?.uncacheRoot(this.root)
      this.releaseRoot(this.root)
      this.root.removeFromParent()
    }
    this.root = undefined
    this.mixer = undefined
    this.actions.clear()
    this.active = undefined
    this.sampleCount = 0
  }

  dispose(): void {
    ++this.loadVersion
    this.clear()
    this.group.removeFromParent()
  }
}
