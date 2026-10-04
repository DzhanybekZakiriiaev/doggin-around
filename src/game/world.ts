import RAPIER from '@dimforge/rapier3d-compat';
import { SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WorldRun } from './worlds-index';

export const EYE_HEIGHT = 1.6;

/**
 * A Marble world: the Gaussian splat for looks plus its collider mesh for physics.
 *
 * Marble assets come in its raw OpenCV frame (y down), so `root` flips them 180° about X.
 * Drafts carry no metric scale, so the world is scaled until the panorama camera (the origin)
 * sits EYE_HEIGHT above the collider floor, which matches how the input plates were framed.
 * The floor under the origin ends up at y = 0.
 */
export class MarbleWorld {
  readonly root = new THREE.Group();
  readonly colliderView: THREE.Group;
  readonly scale: number;
  private splat: SplatMesh;
  /** A sharper splat, loaded and waiting to replace `splat` the next time the world is off screen. */
  private sharper?: { splat: SplatMesh; swapped: () => void };
  private readonly body: RAPIER.RigidBody;

  private constructor(splat: SplatMesh, colliderView: THREE.Group, scale: number, body: RAPIER.RigidBody) {
    this.splat = splat;
    this.colliderView = colliderView;
    this.scale = scale;
    this.body = body;
  }

  static async load(
    run: WorldRun,
    resolution: string,
    physics: RAPIER.World,
    onStatus: (message: string) => void,
  ): Promise<MarbleWorld> {
    onStatus('Loading collider…');
    const gltf = await new GLTFLoader().loadAsync(`${run.baseUrl}collider.glb`);
    const colliderView = gltf.scene;
    const wireframe = new THREE.MeshBasicMaterial({
      color: 0x41f0c0,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    colliderView.traverse((object) => {
      if (object instanceof THREE.Mesh) object.material = wireframe;
    });
    colliderView.visible = false;

    const holder = new THREE.Group();
    holder.quaternion.set(1, 0, 0, 0); // 180° about X: OpenCV (y down) → three.js (y up)
    holder.add(colliderView);
    holder.updateMatrixWorld(true);

    // Camera height above the floor in raw model units, measured straight down from the origin.
    const down = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0));
    const floorHit = down.intersectObject(colliderView, true)[0];
    const rawHeight = floorHit?.distance;
    const scale = run.metricScale ?? (rawHeight ? EYE_HEIGHT / rawHeight : 1);
    if (!rawHeight) console.warn(`[world] No floor below the origin in ${run.id}; using scale ${scale}`);

    holder.scale.setScalar(scale);
    holder.position.y = rawHeight ? rawHeight * scale : 0;
    holder.updateMatrixWorld(true);

    const body = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    physics.createCollider(MarbleWorld.trimesh(colliderView), body);

    onStatus('Loading splats…');
    const splat = new SplatMesh({
      url: `${run.baseUrl}splats_${resolution}.spz`,
      lod: true, // builds a level-of-detail tree so the renderer can cap how many splats it draws
      onProgress: (event) => {
        if (event.lengthComputable) onStatus(`Loading splats ${Math.round((event.loaded / event.total) * 100)}%`);
      },
    });
    holder.add(splat);
    await splat.initialized;

    const world = new MarbleWorld(splat, colliderView, scale, body);
    world.root.add(holder);
    onStatus(`${run.label} · ${resolution} · scale ${scale.toFixed(2)}${run.metricScale ? ' (metric)' : ' (eye height)'}`);
    return world;
  }

  /**
   * Loads the same world at a higher splat resolution in the background and swaps it in while the world
   * is off screen (now, or the next time it's left), so nobody sees it pop. `swapped` runs after the swap.
   */
  async upgrade(run: WorldRun, resolution: string, swapped: () => void = () => {}) {
    const splat = new SplatMesh({ url: `${run.baseUrl}splats_${resolution}.spz`, lod: true });
    await splat.initialized;
    splat.recolor.copy(this.splat.recolor);
    this.sharper = { splat, swapped };
    if (!this.root.parent) this.swapSplats();
  }

  private swapSplats() {
    if (!this.sharper) return;
    const { splat, swapped } = this.sharper;
    this.sharper = undefined;
    this.splat.parent?.add(splat);
    this.splat.removeFromParent();
    this.splat.dispose();
    this.splat = splat;
    swapped();
  }

  /** Multiplies the painted colours (the cabin cold before the fire, warm after). */
  setTint(color: THREE.Color) {
    this.splat.recolor.copy(color);
  }

  /** Where the panorama camera stood, in world coordinates. */
  get panoOrigin(): THREE.Vector3 {
    return this.colliderView.parent!.position.clone();
  }

  /**
   * Casts a ray against the collider. `lon`/`lat` are degrees in the panorama: right of its centre and
   * above the horizon. The panorama centre faces -Z.
   */
  raycastPano(lon: number, lat: number, from = this.panoOrigin) {
    const lonRad = THREE.MathUtils.degToRad(lon);
    const latRad = THREE.MathUtils.degToRad(lat);
    const direction = new THREE.Vector3(
      Math.cos(latRad) * Math.sin(lonRad),
      Math.sin(latRad),
      -Math.cos(latRad) * Math.cos(lonRad),
    );
    return this.raycast(from, direction);
  }

  raycast(from: THREE.Vector3, direction: THREE.Vector3) {
    const hit = new THREE.Raycaster(from, direction.clone().normalize()).intersectObject(this.colliderView, true)[0];
    if (!hit?.face) return undefined;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.dot(direction) > 0) normal.negate(); // face the ray, whatever the triangle winding
    return { point: hit.point, normal, distance: hit.distance };
  }

  /** Bakes every collider mesh into one world-space triangle mesh for Rapier. */
  private static trimesh(view: THREE.Object3D): RAPIER.ColliderDesc {
    const vertices: number[] = [];
    const indices: number[] = [];
    const point = new THREE.Vector3();
    view.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const position = geometry.getAttribute('position');
      const base = vertices.length / 3;
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        vertices.push(point.x, point.y, point.z);
      }
      const index = geometry.getIndex();
      if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
      else for (let i = 0; i < position.count; i++) indices.push(base + i);
    });
    return RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices));
  }

  /** Adds a collider (given in world coordinates) that comes and goes with this world. */
  addCollider(physics: RAPIER.World, desc: RAPIER.ColliderDesc) {
    physics.createCollider(desc, this.body);
  }

  /** Shows the world and turns its collider on. */
  activate(scene: THREE.Scene) {
    scene.add(this.root);
    this.body.setEnabled(true);
  }

  /** Hides the world and turns its collider off, keeping it loaded for a quick return. */
  deactivate() {
    this.root.removeFromParent();
    this.body.setEnabled(false);
    this.swapSplats();
  }

  dispose(physics: RAPIER.World) {
    physics.removeRigidBody(this.body);
    this.root.removeFromParent();
    this.splat.dispose();
    this.sharper?.splat.dispose();
    this.colliderView.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }
}
