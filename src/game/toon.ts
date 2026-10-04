import * as THREE from 'three';

// The comic look for meshes placed in the splat worlds: three-step toon shading with halftone dots
// in the shadows, and an ink outline drawn as an inverted hull pushed out along the normals.

const gradientMap = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
})();

/**
 * Toon material with screen-space halftone dots in the shadow band. `shadowLevel` is the brightness
 * (relative to the lit colour) below which dots start, growing as it gets darker.
 */
export function toonMaterial(color: THREE.ColorRepresentation, { dotSize = 6, shadowLevel = 0.75 } = {}) {
  const material = new THREE.MeshToonMaterial({ color, gradientMap });
  const base = new THREE.Color(color).convertLinearToSRGB(); // compared against the final, sRGB-encoded colour
  const litLuminance = Math.max(0.05, 0.299 * base.r + 0.587 * base.g + 0.114 * base.b);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.dotSize = { value: dotSize };
    shader.uniforms.shadowLuminance = { value: litLuminance * shadowLevel };
    shader.fragmentShader = `uniform float dotSize;\nuniform float shadowLuminance;\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        float shade = clamp(1.0 - lum / shadowLuminance, 0.0, 1.0);
        vec2 cell = mod(gl_FragCoord.xy, dotSize) - 0.5 * dotSize;
        if (length(cell) < dotSize * 0.42 * shade) gl_FragColor.rgb *= 0.6;
      }`,
    );
  };
  return material;
}

const outlineMaterials = new Map<string, THREE.ShaderMaterial>();

/** Ink outline: back faces pushed out along their normals by `width` (in object units). Works on skinned meshes. */
export function outlineMaterial(width: number, color: THREE.ColorRepresentation = 0x120c10) {
  const key = `${width}:${new THREE.Color(color).getHexString()}`;
  let material = outlineMaterials.get(key);
  if (!material) {
    material = new THREE.ShaderMaterial({
      uniforms: { width: { value: width }, color: { value: new THREE.Color(color) } },
      vertexShader: `
        #include <common>
        #include <skinning_pars_vertex>
        uniform float width;
        void main() {
          #include <beginnormal_vertex>
          #include <skinbase_vertex>
          #include <skinnormal_vertex>
          #include <begin_vertex>
          #include <skinning_vertex>
          transformed += normalize(objectNormal) * width;
          #include <project_vertex>
        }`,
      fragmentShader: `
        uniform vec3 color;
        void main() { gl_FragColor = vec4(color, 1.0); }`,
      side: THREE.BackSide,
    });
    outlineMaterials.set(key, material);
  }
  return material;
}

/** A toon-shaded mesh with its ink outline (or one in `outlineColor`, to make it stand out), as one group. */
export function inked(geometry: THREE.BufferGeometry, material: THREE.Material, outlineWidth: number, outlineColor?: THREE.ColorRepresentation) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, outlineMaterial(outlineWidth, outlineColor)));
  return group;
}
