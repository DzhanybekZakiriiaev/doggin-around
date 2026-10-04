import { SparkRenderer } from "@sparkjsdev/spark"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import {
  DOG_ACTIONS,
  Dog,
  type DogAction,
  type DogAppearance,
  type DogView,
} from "./dog"
import { FetchInteraction } from "./fetch"
import "./style.css"

const app = document.querySelector<HTMLDivElement>("#app")
if (!app) throw new Error("The app container is missing")
app.innerHTML = `
  <header><a class="brand" href="/">doggin<span>around</span><i>✳</i></a><span class="label">GAUSSIAN DOG STUDIO</span><span class="connection"><i></i> LOCAL SANDBOX</span></header>
  <main>
    <section class="studio">
      <div class="scene-heading"><span class="eyebrow">01 / THE PLAYGROUND</span><h1>A little dog. A whole new dimension.</h1><p id="scene-intro">Built from a photo. Brought to life in splats.</p></div>
      <div id="viewport" aria-label="Interactive 3D dog viewer"></div>
      <div class="scene-footer"><span><i class="live-dot"></i> <span id="render-status">Preparing your dog</span></span><span id="fetch-status">CLICK THE FLOOR TO PLAY FETCH <b>·</b> DRAG TO ORBIT</span></div>
      <div id="notice" role="status">Loading the animated dog…</div>
    </section>
    <aside>
      <div class="eyebrow">02 / MEET YOUR DOG</div><h2>Your new companion.</h2><p class="intro">A photo, a rig, a little personality.</p>
      <label class="model-label" for="dog-model">Choose your dog</label><select id="dog-model"><option value="huawei">Huawei's dog</option>${import.meta.env.DEV ? '<option value="tricolor">Tricolor dog</option>' : ""}</select>
      <div class="asset-card"><img class="asset-icon" src="/models/huawei-dog-reference.png" alt="" /><div><strong id="asset-name">Huawei's dog</strong><span id="asset-detail">Photo → rig → animated splats</span></div></div>
      <details class="source-preview"><summary id="source-title">See Huawei's original photo</summary><figure><img id="source-original" loading="lazy" src="/models/huawei-dog-reference.png" alt="White fluffy dog with sunglasses, flowers, and a blue bow" /><figcaption id="source-caption">Huawei's supplied photo</figcaption></figure><figure><img id="source-standing" loading="lazy" src="/models/huawei-dog-fullbody.png" alt="Full-body extension of the supplied dog photo" /><figcaption>Generated full-body reference</figcaption></figure></details>
      <label class="upload" for="model-upload">↗ Import animated GLB<input id="model-upload" type="file" accept=".glb" /></label>
      <div class="section-label">GIVE IT SOMETHING TO DO</div>
      <div class="actions" role="group" aria-label="Dog actions">${DOG_ACTIONS.map(({ name, label, icon }) => `<button type="button" data-action="${name}" aria-pressed="${name === "idle"}" class="${name === "idle" ? "selected" : ""}"><span class="action-icon" aria-hidden="true">${icon}</span>${label}</button>`).join("")}</div>
      <button type="button" id="fetch-demo" class="fetch-invite">◌ Toss the ball <span>or click the playground</span></button>
      <div class="transport"><button type="button" id="pause">Pause</button><button type="button" id="reset">Reset pose</button><span id="action-status">IDLE</span></div>
      <div class="section-label">TAKE A CLOSER LOOK</div>
      <div class="view-tabs" role="group" aria-label="Rendering mode"><button type="button" data-view="splats" class="selected">Splats</button><button type="button" data-view="mesh">Mesh</button><button type="button" data-view="skeleton">Skeleton</button></div>
      <label class="slider-label" for="density">Splat density <span id="density-value">50,000</span></label><input id="density" type="range" min="10000" max="100000" step="10000" value="50000" />
      <div class="range-endpoints"><span>LIGHTER</span><span>MORE DETAIL</span></div>
      <label class="slider-label" for="speed">Animation speed <span id="speed-value">1.0×</span></label><input id="speed" type="range" min="0.25" max="2" step="0.25" value="1" />
      <div class="metrics"><div><span id="splat-count">-</span><small>GAUSSIANS</small></div><div><span id="fps">0</span><small>FRAMES / SEC</small></div></div>
      <p class="footnote" id="render-detail">Photo-generated Gaussians, driven by a real skeleton. Select a view to see how it works.</p>
    </aside>
  </main>
  <footer><span>FETCHING REALITY / STORMHACKS 2026</span><span>A PHOTO IS JUST THE BEGINNING ↗</span></footer>
  <audio id="bark-audio" preload="auto" src="/audio/dog-bark.ogg"></audio>
`

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

const viewport = element("viewport")
const renderer = new THREE.WebGLRenderer({ antialias: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setClearColor(0xe8eadf)
viewport.append(renderer.domElement)
const scene = new THREE.Scene()
const cameraProfiles = {
  standard: { position: [0, 2.65, -6.12], target: [0, 1.15, 0] },
  tricolor: { position: [0, 2.85, -6.55], target: [0, 1.3, 0] },
} as const
let cameraProfile: keyof typeof cameraProfiles = "standard"
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100)
camera.position.set(...cameraProfiles.standard.position)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(...cameraProfiles.standard.target)
controls.enableDamping = true
controls.minDistance = 2
controls.maxDistance = 12
controls.maxPolarAngle = Math.PI / 2 + 0.05
const spark = new SparkRenderer({
  renderer,
  covSplats: true,
  accumExtSplats: true,
})
scene.add(spark)
scene.add(new THREE.HemisphereLight(0xffffff, 0x879277, 3))
const light = new THREE.DirectionalLight(0xffffff, 2)
light.position.set(3, 5, 4)
scene.add(light)
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4.8, 96),
  new THREE.MeshBasicMaterial({ color: 0xdde1d0 }),
)
floor.rotation.x = -Math.PI / 2
floor.position.y = -0.03
scene.add(floor)
const grid = new THREE.GridHelper(9, 18, 0xbfc6b5, 0xcbd1c0)
grid.position.y = -0.02
scene.add(grid)
const dog = new Dog(renderer)
scene.add(dog.group)
const fetchPlay = new FetchInteraction(dog, scene, camera, viewport)
let gazeActive = false
let gazeHorizontal = 0
let orbiting = false
const gazeRight = new THREE.Vector3()
const gazeDirection = new THREE.Vector3()
viewport.addEventListener("pointermove", (event) => {
  if (orbiting || event.buttons !== 0) return
  const bounds = viewport.getBoundingClientRect()
  gazeHorizontal = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
  gazeActive = true
})
viewport.addEventListener("pointerleave", () => {
  gazeActive = false
})
controls.addEventListener("start", () => {
  orbiting = true
  gazeActive = false
})
controls.addEventListener("end", () => {
  orbiting = false
})
const barkAudio = element<HTMLAudioElement>("bark-audio")
let barkElapsed = 0
let barksRemaining = 0

function stopBark(): void {
  barkAudio.pause()
  barkAudio.currentTime = 0
  barkElapsed = 0
  barksRemaining = 0
}

function playBark(): void {
  barkAudio.playbackRate = dog.speed
  void barkAudio.play().catch(() => undefined)
}
let loaded = false
let loading = false
let lastAction = ""
let lastFetchState = ""
let frames = 0
let lastFps = performance.now()
let lastFrame = performance.now()
let currentUrl = "/models/dog-animated.glb"
let currentModel = "huawei"
const models = {
  huawei: {
    url: "/models/dog-animated.glb",
    name: "Huawei's dog",
    original: "/models/huawei-dog-reference.png",
    standing: "/models/huawei-dog-fullbody.png",
    alt: "White fluffy dog with sunglasses, flowers, and a blue bow",
    appearance: undefined,
  },
  tricolor: {
    url: "/models/tricolor-research/dog-animated.glb",
    name: "Tricolor dog",
    original: "/models/tricolor-reference.png",
    standing: "/models/tricolor-standing-reference.png",
    alt: "Fluffy tricolor dog with a white blaze, tan eyebrows, and black ears",
    appearance: {
      kind: "smal-pets-faces",
      manifestUrl: "/models/tricolor-research/manifest.json",
      density: 37525,
    } as DogAppearance,
  },
}

function busy(value: boolean): void {
  loading = value
  document
    .querySelectorAll<HTMLButtonElement>("aside button")
    .forEach((button) => {
      const action = button.dataset.action as DogAction | undefined
      const unavailable =
        action !== undefined && !dog.availableActions.includes(action)
      button.hidden = loaded && unavailable
      button.disabled =
        value ||
        !loaded ||
        unavailable ||
        (button.id === "fetch-demo" && !dog.availableActions.includes("walk"))
    })
  element<HTMLInputElement>("density").disabled = value || !loaded
  element<HTMLInputElement>("model-upload").disabled = value
  element<HTMLSelectElement>("dog-model").disabled = value
}

async function loadDog(
  url: string,
  name = "Huawei's dog",
  appearance?: DogAppearance,
): Promise<boolean> {
  stopBark()
  fetchPlay.reset()
  busy(true)
  element("notice").hidden = false
  element("notice").textContent = "Building your dog's Gaussians…"
  try {
    await dog.loadDog(url, appearance)
    const profile =
      new URL(url, window.location.href).pathname === models.tricolor.url
        ? "tricolor"
        : "standard"
    if (profile !== cameraProfile) {
      camera.position.fromArray(cameraProfiles[profile].position)
      controls.target.fromArray(cameraProfiles[profile].target)
      controls.update()
      controls.saveState()
      cameraProfile = profile
    }
    loaded = true
    dog.paused = false
    element("pause").textContent = "Pause"
    lastAction = ""
    lastFetchState = ""
    currentUrl = url
    element("asset-name").textContent = name
    element("asset-detail").textContent =
      `${dog.availableActions.length} motion clip${dog.availableActions.length === 1 ? "" : "s"} · textured skin · live rig`
    element("notice").hidden = true
    element("render-status").textContent = "LIVE GAUSSIAN RENDERING"
    element("scene-intro").textContent = dog.hasHeadLook
      ? "Move your cursor to catch its eye. Click the floor to play fetch."
      : "Built from a photo. Brought to life in splats."
    element("splat-count").textContent = dog.sampleCount.toLocaleString()
    element("render-detail").textContent = dog.hasFaceAppearance
      ? "Reconstructed Gaussians follow the full animated mesh, including pose corrections."
      : dog.maxDensity === 50000
        ? "Photo-generated Gaussians, driven by a real skeleton. Select a view to see how it works."
        : "Surface-sampled Gaussians, driven by the imported skeleton. Select a view to see how it works."
    const density = element<HTMLInputElement>("density")
    density.min = dog.maxDensity < 10000 ? "1" : "10000"
    density.step = dog.maxDensity % 10000 === 0 ? "10000" : "1"
    density.max = String(dog.maxDensity)
    density.value = String(dog.density)
    element("density-value").textContent = dog.density.toLocaleString()
    return true
  } catch (error) {
    loaded = dog.sampleCount > 0
    element("notice").textContent =
      error instanceof Error ? error.message : "Could not load this dog"
    element("render-status").textContent = loaded
      ? "PREVIOUS DOG LOADED"
      : "MODEL NEEDED"
    return false
  } finally {
    busy(false)
  }
}

element<HTMLSelectElement>("dog-model").addEventListener(
  "change",
  async (event) => {
    const selector = event.target as HTMLSelectElement
    const key = selector.value as keyof typeof models
    const model = models[key]
    if (!model) return
    if (!(await loadDog(model.url, model.name, model.appearance))) {
      selector.value = currentModel
      return
    }
    currentModel = key
    selector.querySelector('option[value="imported"]')?.remove()
    const reference = document.querySelector<HTMLElement>(".source-preview")
    if (reference) reference.hidden = false
    for (const id of ["source-original", "source-standing"]) {
      const preview = element<HTMLImageElement>(id)
      preview.src = id === "source-original" ? model.original : model.standing
      preview.alt = model.alt
    }
    const icon = document.querySelector<HTMLImageElement>(".asset-icon")
    if (icon) {
      icon.hidden = false
      icon.src = model.original
      icon.alt = model.alt
    }
    element("source-title").textContent =
      `See ${key === "huawei" ? "Huawei's" : "the tricolor dog's"} original photo`
    element("source-caption").textContent = `${model.name} reference photo`
  },
)

document
  .querySelectorAll<HTMLButtonElement>("[data-action]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      stopBark()
      fetchPlay.stop()
      dog.paused = false
      element("pause").textContent = "Pause"
      dog.playAction(button.dataset.action as DogAction)
      if (button.dataset.action === "bark") {
        barksRemaining = 2
        playBark()
      }
    })
  })
element("fetch-demo").addEventListener("click", () => {
  stopBark()
  fetchPlay.throwTo(new THREE.Vector3(-1.2, 0, -1.4))
})
document
  .querySelectorAll<HTMLButtonElement>("[data-view]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      dog.setView(button.dataset.view as DogView)
      document.querySelectorAll("[data-view]").forEach((tab) => {
        tab.classList.toggle("selected", tab === button)
      })
      element("render-status").textContent =
        `${button.dataset.view?.toUpperCase()} INSPECTION`
    })
  })
element("pause").addEventListener("click", () => {
  dog.paused = !dog.paused
  if (dog.paused) barkAudio.pause()
  else if (dog.action === "bark" && !barkAudio.ended) playBark()
  element("pause").textContent = dog.paused ? "Resume" : "Pause"
})
element("reset").addEventListener("click", () => {
  stopBark()
  fetchPlay.reset()
  dog.paused = false
  element("pause").textContent = "Pause"
  dog.playAction("idle")
  controls.reset()
})
const density = element<HTMLInputElement>("density")
density.addEventListener("input", () => {
  element("density-value").textContent = Number(density.value).toLocaleString()
})
density.addEventListener("change", async () => {
  busy(true)
  try {
    await dog.rebuildSplats(Number(density.value))
    element("splat-count").textContent = dog.sampleCount.toLocaleString()
  } catch (error) {
    density.value = String(dog.density)
    element("density-value").textContent = dog.density.toLocaleString()
    element("notice").hidden = false
    element("notice").textContent = String(error)
  } finally {
    busy(false)
  }
})
element<HTMLInputElement>("speed").addEventListener("input", (event) => {
  dog.speed = Number((event.target as HTMLInputElement).value)
  barkAudio.playbackRate = dog.speed
  element("speed-value").textContent =
    `${dog.speed.toFixed(2).replace(/0$/, "")}×`
})
element<HTMLInputElement>("model-upload").addEventListener(
  "change",
  async (event) => {
    if (loading) return
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const previous = currentUrl
    if (await loadDog(url, file.name)) {
      const selector = element<HTMLSelectElement>("dog-model")
      selector.querySelector('option[value="imported"]')?.remove()
      selector.add(new Option(file.name, "imported"))
      selector.value = "imported"
      currentModel = "imported"
      const reference = document.querySelector<HTMLElement>(".source-preview")
      if (reference) reference.hidden = true
      const icon = document.querySelector<HTMLImageElement>(".asset-icon")
      if (icon) icon.hidden = true
    }
    URL.revokeObjectURL(url)
    currentUrl = previous
    element<HTMLInputElement>("model-upload").value = ""
  },
)
const observer = new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect()
  renderer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
})
observer.observe(viewport)
controls.saveState()
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const delta = (now - lastFrame) / 1000
  fetchPlay.update(delta)
  if (
    loaded &&
    !loading &&
    dog.hasHeadLook &&
    fetchPlay.state === "idle" &&
    dog.action === "idle"
  ) {
    let heading = 0
    if (gazeActive && !orbiting) {
      gazeDirection.copy(camera.position).sub(dog.group.position)
      const distance = Math.hypot(gazeDirection.x, gazeDirection.z)
      gazeRight.setFromMatrixColumn(camera.matrixWorld, 0)
      gazeDirection.addScaledVector(gazeRight, gazeHorizontal * distance * 0.65)
      const difference =
        Math.atan2(-gazeDirection.x, -gazeDirection.z) - dog.group.rotation.y
      heading = Math.atan2(Math.sin(difference), Math.cos(difference))
    }
    dog.lookToward(heading)
  }
  dog.update(delta)
  fetchPlay.updateBallPosition()
  if (dog.action === "bark" && !dog.paused && barksRemaining > 0) {
    barkElapsed += Math.min(delta, 0.1) * dog.speed
    if (barkElapsed >= 0.8) {
      barkElapsed -= 0.8
      barksRemaining--
      barkAudio.currentTime = 0
      playBark()
    }
  }
  lastFrame = now
  controls.update()
  const targetFov = dog.action === "backflip" ? 68 : 38
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = THREE.MathUtils.damp(
      camera.fov,
      targetFov,
      12,
      Math.min(delta, 0.1),
    )
    camera.updateProjectionMatrix()
  }
  renderer.render(scene, camera)
  if (lastFetchState !== fetchPlay.state) {
    if (fetchPlay.state !== "idle") stopBark()
    lastFetchState = fetchPlay.state
    element("fetch-status").textContent =
      fetchPlay.state === "idle"
        ? dog.availableActions.includes("walk")
          ? "CLICK THE FLOOR TO PLAY FETCH · DRAG TO ORBIT"
          : "DRAG TO ORBIT"
        : fetchPlay.state === "returning"
          ? "BRINGING IT BACK"
          : fetchPlay.state === "picking-up"
            ? "PICKING IT UP"
            : "FETCHING THE BALL"
  }
  frames++
  if (now - lastFps > 1000) {
    element("fps").textContent = String(
      Math.round((frames * 1000) / (now - lastFps)),
    )
    frames = 0
    lastFps = now
  }
  if (lastAction !== dog.action) {
    if (dog.action !== "bark") stopBark()
    lastAction = dog.action
    element("action-status").textContent =
      DOG_ACTIONS.find(
        ({ name }) => name === dog.action,
      )?.label.toUpperCase() ?? dog.action.toUpperCase()
    document
      .querySelectorAll<HTMLButtonElement>("[data-action]")
      .forEach((button) => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.action === dog.action),
        )
        button.classList.toggle(
          "selected",
          button.dataset.action === dog.action,
        )
      })
  }
})
window.addEventListener("pagehide", () => {
  stopBark()
  observer.disconnect()
  renderer.setAnimationLoop(null)
  fetchPlay.dispose()
  dog.dispose()
  controls.dispose()
  spark.dispose()
  floor.geometry.dispose()
  floor.material.dispose()
  grid.geometry.dispose()
  if (Array.isArray(grid.material))
    grid.material.forEach((material) => {
      material.dispose()
    })
  else grid.material.dispose()
  renderer.dispose()
})
// Expose the same controller for integration and browser verification.
Object.assign(window, {
  dogSandbox: { dog, loadDog, renderer, fetchPlay, camera },
})
void loadDog(currentUrl)
