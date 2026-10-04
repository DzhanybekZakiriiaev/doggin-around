import { dyno, Readback, SplatModifier } from "@sparkjsdev/spark"
import type * as THREE from "three"
import type { FaceAppearance } from "../../src/faceAppearance"

export async function readFaceGaussians(
  appearance: FaceAppearance,
  renderer: THREE.WebGLRenderer,
): Promise<number[]> {
  const source = appearance.splats.extSplats
  const modifier = appearance.splats.objectModifiers?.[0]
  if (!source || !modifier) throw new Error("Missing face Gaussian source")
  const sourceGraph = dyno.dynoBlock(
    { index: "int" },
    { gsplat: dyno.Gsplat },
    ({ index }) => {
      if (!index) throw new Error("Missing Gaussian index")
      return { gsplat: source.fetchSplat({ index }) }
    },
  )
  const posed = new SplatModifier(modifier).apply(sourceGraph)
  const reader = dyno.dynoBlock(
    { index: "int" },
    { rgba8: "vec4" },
    ({ index }) => {
      const address = new dyno.Dyno({
        inTypes: { index: "int" },
        outTypes: { gaussian: "int", component: "int" },
        inputs: { index },
        statements: ({ inputs, outputs }) => [
          `${outputs.gaussian} = ${inputs.index} / 10;`,
          `${outputs.component} = ${inputs.index} % 10;`,
        ],
      })
      posed.inputs.index = address.outputs.gaussian
      const bytes = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, component: "int" },
        outTypes: { rgba8: "vec4" },
        inputs: {
          gsplat: posed.outputs.gsplat,
          component: address.outputs.component,
        },
        statements: ({ inputs, outputs }) => [
          `float values[10] = float[10](
        ${inputs.gsplat}.center.x, ${inputs.gsplat}.center.y, ${inputs.gsplat}.center.z,
        ${inputs.gsplat}.quaternion.x, ${inputs.gsplat}.quaternion.y, ${inputs.gsplat}.quaternion.z, ${inputs.gsplat}.quaternion.w,
        ${inputs.gsplat}.scales.x, ${inputs.gsplat}.scales.y, ${inputs.gsplat}.scales.z);
        uint bits = floatBitsToUint(values[${inputs.component}]);
        ${outputs.rgba8} = vec4(float(bits & 255u), float((bits >> 8u) & 255u), float((bits >> 16u) & 255u), float(bits >> 24u)) / 255.0;`,
        ],
      })
      return { rgba8: bytes.outputs.rgba8 }
    },
  )
  const readback = new Readback({ renderer })
  const count = source.numSplats * 10
  const buffer = Readback.ensureBuffer(count, new Float32Array(count))
  const { material } = readback.prepareProgramMaterial(reader)
  try {
    await readback.renderReadback({ reader, count, readback: buffer })
    return Array.from(buffer.subarray(0, count))
  } finally {
    readback.dispose()
    material.dispose()
  }
}
