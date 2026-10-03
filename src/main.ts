import { SparkRenderer } from "@sparkjsdev/spark"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { Dog, type DogAction, type DogView } from "./dog"
import { FetchInteraction } from "./fetch"
import "./style.css"

const app = document.querySelector<HTMLDivElement>("#app")
if (!app) throw new Error("The app container is missing")
app.innerHTML = `
  <header><a class="brand" href="/">doggin<span>around</span><i>✳</i></a><span class="label">GAUSSIAN DOG STUDIO</span><span class="connection"><i></i> LOCAL SANDBOX</span></header>
  <main>
    <section class="studio">
      <div class="scene-heading"><span class="eyebrow">01 / THE PLAYGROUND</span><h1>A little dog.<br>A whole new dimension.</h1><p>Built from a photo. Brought to life in splats.</p></div>
      <div id="viewport" aria-label="Interactive 3D dog viewer"></div>
      <div class="scene-footer"><span><i class="live-dot"></i> <span id="render-status">Preparing your dog</span></span><span id="fetch-status">CLICK THE FLOOR TO PLAY FETCH <b>·</b> DRAG TO ORBIT</span></div>
      <div id="notice" role="status">Loading the animated dog…</div>
    </section>
    <aside>
      <div class="eyebrow">02 / MEET YOUR DOG</div><h2>Your new companion.</h2><p class="intro">A photo, a rig, a little personality.</p>
      <div class="asset-card"><img class="asset-icon" src="/models/huawei-dog-reference.png" alt="" /><div><strong id="asset-name">Huawei's dog</strong><span id="asset-detail">Photo → rig → animated splats</span></div></div>
      <details class="source-preview"><summary>See Huawei's original photo</summary><figure><img loading="lazy" src="/models/huawei-dog-reference.png" alt="White fluffy dog with sunglasses, flowers, and a blue bow" /><figcaption>Huawei's supplied photo</figcaption></figure><figure><img loading="lazy" src="/models/huawei-dog-fullbody.png" alt="Full-body extension of the supplied dog photo" /><figcaption>Generated full-body reference</figcaption></figure></details>
      <label class="upload" for="model-upload">↗ Import animated GLB<input id="model-upload" type="file" accept=".glb" /></label>
      <div class="section-label">GIVE IT SOMETHING TO DO</div>
      <div class="actions"><button type="button" data-action="idle" class="selected"><span class="action-icon" aria-hidden="true">◌</span>Idle</button><button type="button" data-action="walk"><span class="action-icon" aria-hidden="true">↝</span>Walk</button><button type="button" data-action="spin"><span class="action-icon" aria-hidden="true">⟳</span>Spin</button></div>
      <button type="button" id="fetch-demo" class="fetch-invite">◌ Toss the ball <span>or click the playground</span></button>
      <div class="transport"><button type="button" id="pause">Pause</button><button type="button" id="reset">Reset pose</button><span id="action-status">IDLE</span></div>
      <div class="section-label">TAKE A CLOSER LOOK</div>
      <div class="view-tabs" role="group" aria-label="Rendering mode"><button type="button" data-view="splats" class="selected">Splats</button><button type="button" data-view="mesh">Mesh</button><button type="button" data-view="skeleton">Skeleton</button></div>
      <label class="slider-label" for="density">Splat density <span id="density-value">50,000</span></label><input id="density" type="range" min="10000" max="100000" step="10000" value="50000" />
      <div class="range-endpoints"><span>LIGHTER</span><span>MORE DETAIL</span></div>
      <label class="slider-label" for="speed">Animation speed <span id="speed-value">1.0×</span></label><input id="speed" type="range" min="0.25" max="2" step="0.25" value="1" />
      <div class="metrics"><div><span id="splat-count">-</span><small>GAUSSIANS</small></div><div><span id="fps">0</span><small>FRAMES / SEC</small></div></div>
      <p class="footnote">Surface-sampled Gaussians, driven by a real skeleton. Select a view to see how it works.</p>
    </aside>
  </main>
  <footer><span>FETCHING REALITY / STORMHACKS 2026</span><span>A PHOTO IS JUST THE BEGINNING ↗</span></footer>
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
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100)
camera.position.set(4.3, 2.5, -5.4)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.85, 0)
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
const dog = new Dog()
scene.add(dog.group)
const fetchPlay = new FetchInteraction(dog, scene, camera, viewport)
let loaded = false
let loading = false
let lastAction = ""
let lastFetchState = ""
let frames = 0
let lastFps = performance.now()
let lastFrame = performance.now()
let currentUrl = "/models/dog-animated.glb"

function busy(value: boolean): void {
  loading = value
  document
    .querySelectorAll<HTMLButtonElement>("aside button")
    .forEach((button) => {
      button.disabled = value || !loaded
    })
  element<HTMLInputElement>("density").disabled = value || !loaded
  element<HTMLInputElement>("model-upload").disabled = value
}

async function loadDog(url: string, name = "Huawei's dog"): Promise<void> {
  fetchPlay.reset()
  busy(true)
  element("notice").hidden = false
  element("notice").textContent = "Building your dog's Gaussians…"
  try {
    await dog.loadDog(url)
    loaded = true
    currentUrl = url
    element("asset-name").textContent = name
    element("asset-detail").textContent =
      "3 motion clips · textured skin · live rig"
    element("notice").hidden = true
    element("render-status").textContent = "LIVE GAUSSIAN RENDERING"
    element("splat-count").textContent = dog.sampleCount.toLocaleString()
  } catch (error) {
    loaded = dog.sampleCount > 0
    element("notice").textContent =
      error instanceof Error ? error.message : "Could not load this dog"
    element("render-status").textContent = loaded
      ? "PREVIOUS DOG LOADED"
      : "MODEL NEEDED"
  } finally {
    busy(false)
  }
}

document
  .querySelectorAll<HTMLButtonElement>("[data-action]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      fetchPlay.stop()
      dog.paused = false
      element("pause").textContent = "Pause"
      dog.playAction(button.dataset.action as DogAction)
    })
  })
element("fetch-demo").addEventListener("click", () => {
  fetchPlay.throwTo(new THREE.Vector3(1.8, 0, -1.5))
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
  element("pause").textContent = dog.paused ? "Resume" : "Pause"
})
element("reset").addEventListener("click", () => {
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
    element("notice").hidden = false
    element("notice").textContent = String(error)
  } finally {
    busy(false)
  }
})
element<HTMLInputElement>("speed").addEventListener("input", (event) => {
  dog.speed = Number((event.target as HTMLInputElement).value)
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
    await loadDog(url, file.name)
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
  dog.update(delta)
  lastFrame = now
  controls.update()
  renderer.render(scene, camera)
  if (lastFetchState !== fetchPlay.state) {
    lastFetchState = fetchPlay.state
    element("fetch-status").textContent =
      fetchPlay.state === "idle"
        ? "CLICK THE FLOOR TO PLAY FETCH · DRAG TO ORBIT"
        : fetchPlay.state === "returning"
          ? "BRINGING IT BACK"
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
    lastAction = dog.action
    element("action-status").textContent = dog.action.toUpperCase()
    document
      .querySelectorAll<HTMLButtonElement>("[data-action]")
      .forEach((button) => {
        button.classList.toggle(
          "selected",
          button.dataset.action === dog.action,
        )
      })
  }
})
window.addEventListener("pagehide", () => {
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
Object.assign(window, { dogSandbox: { dog, loadDog, renderer, fetchPlay } })
void loadDog(currentUrl)
