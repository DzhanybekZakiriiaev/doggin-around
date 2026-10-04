# SMAL-pets research reproduction

This direct pipeline reconstructs the two optimization stages and face skinning described in [SMAL-pets](https://arxiv.org/html/2603.17131v1). It is an independent implementation because the official implementation has not been published. It uses the authorized [BITE](https://github.com/runa91/bite_release) D-SMAL model with 3889 vertices, all 35 joint weights, shape and pose correctives, seven limb parameters and full vertex offsets. The authorized model has a zero pose-corrective basis, which is preserved exactly.

Install requirements in the research GPU environment after Torch 2.4 CUDA 11.8, PyTorch3D 0.7.9 and the BITE dependencies. Keep model data and derived research assets outside the published source tree according to the upstream license.

Activate the installed environment before running these commands so GSplat can find Ninja and CUDA.

    export PATH=/workspace/tricolor/venv/bin:/usr/local/cuda/bin:$PATH
    export CUDA_HOME=/usr/local/cuda
    export TORCH_CUDA_ARCH_LIST=8.6
    export MAX_JOBS=4

## Direct stages

Export BITE's canonical fit with betas, betas_limbs, identity pose_rotmat and offsets. Export a TRELLIS Gaussian PLY and proxy mesh in the same frame.

    python scripts/smal_pets/train.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --proxy-ply /workspace/tricolor/proxy/proxy.ply \
      --proxy-mesh /workspace/tricolor/proxy/proxy.obj \
      --proxy-up z \
      --initialization /workspace/tricolor/alignment-init.json \
      --output /workspace/tricolor/training \
      --stop-after 100

Inspect initial_alignment.png and initial_alignment.obj before the long fit. Resume the exact state to complete 15000 bound and 25000 free iterations.

The optional --initialization JSON supplies rotation, scale and translation from anatomical correspondences. It can also supply joint_rotvec keyed by joint index and limb_values keyed by limb parameter index. These settings use upstream native joint coordinates and are copied into the training directory. Four paw anchors and a floor constraint avoid matching paw tips to shanks. Inspect the head and relaxed tail before fitting. Whole-surface ICP is unsuitable when a straight tail or coat thickness biases scale.

    python scripts/smal_pets/train.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --proxy-ply /workspace/tricolor/proxy/proxy.ply \
      --proxy-mesh /workspace/tricolor/proxy/proxy.obj \
      --initialization /workspace/tricolor/alignment-init.json \
      --output /workspace/tricolor/training \
      --resume /workspace/tricolor/training/checkpoint.pt

The bounded DGE stage consumes cameras.json, images and latest.ply from this directory. Export its PLY only when editing succeeded and the result was visually accepted.

    /workspace/tricolor/dge-venv/bin/python scripts/smal_pets/dge_refine.py \
      --training /workspace/tricolor/training \
      --dge-source /workspace/DGE \
      --output /workspace/tricolor/training/dge

This performs one consistent edit of twenty calibrated views and 1000 fitting steps. Add --prepare-only to validate the calibrated COLMAP export without diffusion or training.

    python scripts/smal_pets/export.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --checkpoint /workspace/tricolor/training/checkpoint.pt \
      --output /workspace/tricolor/export

The export CLI requires a completed free stage and records actual bound and free iteration counts in training-provenance.json. Use --ply to rebind an edited DGE PLY. The original checkpoint and latest.ply remain the appearance fallback. Use --baked-npz to reuse preserved full-SMAL vertex buffers. Use --baked-glb to recover those buffers from solved skeleton tracks. Rest vertices and topology must match the final fit. Add --rebake-clips to replace specific profiles while keeping every contact and floor gate. The final export preserves baked-clips.npz and the exact GLB alongside binary clips.

## Implementation choices

Targets are rendered from TRELLIS Gaussians while its mesh supplies geometric alignment. This preserves the generator's appearance. The paper renders its generated mesh instead. cameras.json records this difference as trellis-gaussians.

The proxy is normalized to a unit maximum mesh span. The 96 calibrated cameras use 512 pixels, radius 2 and a 40 degree field of view. Eight interleaved cameras are held out. Target and prediction use the same white background. Camera matrices follow OpenCV with positive Z forward and positive Y down.

Stage I assigns four splats to each face and learns softmax barycentric positions. Covariance follows the paper's normal and triangle-centroid basis with normal thickness 0.0001. Shape, limb length, pose, translation, global scale and vertex offsets are optimized jointly.

Stage II frees positions, rotations and scales. Photometry uses 0.8 L1 and 0.2 DSSIM. Structural terms use mean squared edge-length change and mean uniform Laplacian vector norm. Offsets and selected leg and jaw pose deviations use squared L2 norms, summed across components as in Equation 3. The distance term is mean Euclidean point-to-triangle distance with weight 10 and detached Gaussian positions. Opacity weight is 0.001 in both stages, with negative opacity in Stage I and entropy in Stage II.

Adam uses betas 0.9 and 0.999 and epsilon 1e-8. Bound learning rates are shape 0.002, limbs 0.001, pose and offsets 0.0005, barycentric logits 0.01, colors 0.0025 and opacity logits 0.025. Free mesh rates are divided by ten. Free Gaussian rates are position 0.00016 decaying exponentially to 0.0000016, color 0.0025, scale 0.005, rotation 0.001 and opacity 0.025.

Adaptive density control runs every 100 steps during the first 15000 free iterations. The projected gradient threshold is 0.0002 and opacity threshold is 0.005. Small splats clone exactly. Large splats replace their parent with two rotated Gaussian samples and scales divided by 1.6. Opacity resets every 3000 steps. The count is capped at 150000.

The exporter rotates the complete pet and Gaussian covariances to face negative Z with Y up. It samples idle, walk, run, sit, jump, bark, paw, spin, playbow, sniff and wag at 30 FPS. The animated GLB contains the real 35-joint skeleton. Its four-influence skin serves inspection only. Gaussian and structural appearance use the full D-SMAL vertices in the binary clips. Contact refinement freezes fitted parameters and constrains paw anchors, sole points, foot orientation and the full mesh floor. It reports actual residuals in numerical-checks.json. Gait travel speed comes from backward stance-paw velocity multiplied by 2.6 divided by the actual rest mesh maximum span.

Splats use deterministic spatial ordering across 32 by 32 by 32 cells. Each cell prioritizes opacity, then cells interleave in seed 42 order. Density files use identical 50000, 100000 and 150000 prefixes. Smaller trained models are never padded.

## Numerical checks

    python scripts/smal_pets/check_density.py
    python scripts/smal_pets/check_rasterizer.py \
      --output /workspace/tricolor/checks/rasterizer-check.json
    python scripts/smal_pets/check_bake.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --output /workspace/tricolor/checks/bake
    python scripts/smal_pets/check_model.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --output /workspace/tricolor/model-check.json
    python scripts/smal_pets/check_deformation.py tests/fixtures/smal-pets-parity.json
    pnpm exec biome format --write tests/fixtures/smal-pets-parity.json

Binding uses ten nearest rest-face centers with normalized inverse distance and a 1e-8 floor. Positions use rigid face frames. Quaternions use hemisphere-aligned normalized blending. Scales use the weighted square root of the posed-to-rest perimeter ratio. Degenerate faces use identity rotation and unit scale while preserving centroid translation.

Export rotates the torso axis from rear to front paws toward -Z, preserving the fitted head turn. The same torso axis defines gait direction and measured stance speed. The mouth attachment uses the author's mouth-low vertex 910, with its containing face and one-hot barycentric coordinates. Ground sniff combines a modest crouch with spine, neck and head motion. The pickup sample at 0.85 seconds lies within its held low pose.

The optional restTransforms buffer preserves Float32 XYZW quaternions and XYZ scales in two RGBA texels per Gaussian. Its zero padding and row order match the progressively ordered PLY. Density presets above the actual count are marked unavailable. No points are padded or duplicated.

The reference checks identity, rigid motion, uniform stretch, articulation and degenerate triangles. PLY rows and binding rows keep the same order. Binary arrays are little-endian Uint32 faces, Uint16 binding IDs and Float32 values. topologyHash is SHA256 of the raw Uint32 faces bytes.

training.json records actual iteration counts and completion. A shortened run is never recorded as a complete paper reproduction.

## Completed tricolor run

The completed fit used 15000 bound and 25000 free steps. Its pre-DGE appearance contains 37926 real Gaussians and measured PSNR 43.9274 and SSIM 0.996132 across the eight held-out proxy views. The authorized 39-dog D-SMAL model has a zero-valued learned pose-corrective basis. The full model and that basis were preserved.

The single 1000-step DGE pass completed, but its whole-body result lost tan markings and eye detail. The accepted appearance preserves 34743 original non-tail rows and uses 2782 genuine refined tail rows with neutral black source fur colors. It contains 37525 real rows. accepted-appearance.json records the selection and dge-result.json preserves the completed refinement result. The rejected whole-body edit remains in the research archive.

The unaffected motion buffers were recovered by evaluating the full D-SMAL model from solved 35-joint GLB tracks. All eleven saved OBJ poses matched within 2.37e-7. Recovered contact and full-floor metrics differed by at most 1.20e-7. motion-recovery.json labels this decoded source. Sit was selectively rebaked after reducing its first torso pitch from 0.58 to 0.45. Its final pose remains held. Sniff was then selectively rebaked with a 0.115 crouch, total spine bend 0.65, neck -0.75, head 0.1, head yaw -0.6 and jaw -0.2. This reduced its visible back hump. All thirty unaffected asset files and sixty-five unaffected NPZ fields matched exactly.

The final maximum error across paw anchors and sole triplets is approximately 0.00563 viewer units. Maximum full-mesh floor penetration is 0.001965 viewer units. Both pass the unchanged 0.013 gate. Binding rest identity error is 5.96e-8 and normalized weight-sum error is 1.19e-7. Mouth-low vertex 910 at sniff time 0.85 is approximately [-0.09306, 0.21968, -0.76725] in centered viewer units above the floor. Sniff contact error is 2.10e-5 viewer units and its full-mesh floor penetration is 2.50e-6. Its maximum sole orientation error is 0.040 degrees. The full-SMAL vertex reconstruction from its final skeleton tracks matches within 1.79e-7. selective-motion-checks.json preserves these checks.

The final package preserves baked-clips.npz, all full vertex binary clips and dog-animated.glb. rest-transforms.bin stores the exact Float32 Gaussian covariance transforms. The 50000, 100000 and 150000 presets are unavailable because the accepted model contains 37525 rows. No rows were padded or duplicated.

Reuse the finalized motions and accepted appearance without another contact solve:

    export PATH=/workspace/tricolor/venv/bin:/usr/local/cuda/bin:$PATH
    export CUDA_HOME=/usr/local/cuda TORCH_CUDA_ARCH_LIST=8.6 MAX_JOBS=4
    python scripts/smal_pets/export.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --checkpoint /workspace/tricolor/training/checkpoint.pt \
      --ply /workspace/tricolor/training/dge/accepted-appearance.ply \
      --baked-npz /workspace/tricolor/export-calm-sniff/baked-clips.npz \
      --output /workspace/tricolor/export-reused

To regenerate only Sniff from this preserved source, add --rebake-clips sniff. Source rest vertices and topology must still match the completed fit. The prior validated export remains at export-fallback-before-sniff for comparison.
