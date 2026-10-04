# SMAL-pets research reproduction

This direct pipeline reconstructs the two optimization stages and face skinning described in [SMAL-pets](https://arxiv.org/html/2603.17131v1). It is an independent implementation because the official implementation has not been published. It uses the authorized [BITE](https://github.com/runa91/bite_release) D-SMAL model with 3889 vertices, all 35 joint weights, shape and pose correctives, seven limb parameters and full vertex offsets. The authorized model has a zero pose-corrective basis, which is preserved exactly.

Install requirements in the research GPU environment after Torch 2.4 CUDA 11.8, PyTorch3D 0.7.9 and the BITE dependencies. Keep model data and derived research assets outside the published source tree according to the upstream license.

## Direct stages

Export BITE's canonical fit with betas, betas_limbs, identity pose_rotmat and offsets. Export a TRELLIS Gaussian PLY and proxy mesh in the same frame.

    python scripts/smal_pets/train.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --proxy-ply /workspace/tricolor/proxy/proxy.ply \
      --proxy-mesh /workspace/tricolor/proxy/proxy.obj \
      --proxy-up z \
      --output /workspace/tricolor/training \
      --stop-after 100

Inspect initial_alignment.png and initial_alignment.obj before the long fit. Resume the exact state to complete 15000 bound and 25000 free iterations.

    python scripts/smal_pets/train.py \
      --bite-source /workspace/bite \
      --bite-fit /workspace/tricolor/bite-fit/canonical.npz \
      --proxy-ply /workspace/tricolor/proxy/proxy.ply \
      --proxy-mesh /workspace/tricolor/proxy/proxy.obj \
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

Use --ply to rebind an edited DGE PLY. The original checkpoint and latest.ply remain the appearance fallback.

## Implementation choices

Targets are rendered from TRELLIS Gaussians while its mesh supplies geometric alignment. This preserves the generator's appearance. The paper renders its generated mesh instead. cameras.json records this difference as trellis-gaussians.

The proxy is normalized to a unit maximum mesh span. The 96 calibrated cameras use 512 pixels, radius 2 and a 40 degree field of view. Eight interleaved cameras are held out. Target and prediction use the same white background. Camera matrices follow OpenCV with positive Z forward and positive Y down.

Stage I assigns four splats to each face and learns softmax barycentric positions. Covariance follows the paper's normal and triangle-centroid basis with normal thickness 0.0001. Shape, limb length, pose, translation, global scale and vertex offsets are optimized jointly.

Stage II frees positions, rotations and scales. Photometry uses 0.8 L1 and 0.2 DSSIM. Structural terms use mean squared edge-length change, uniform Laplacian, offsets and selected leg and jaw pose deviations. The distance term is mean Euclidean point-to-triangle distance with weight 10 and detached Gaussian positions. Opacity weight is 0.001 in both stages, with negative opacity in Stage I and entropy in Stage II.

Adam uses betas 0.9 and 0.999 and epsilon 1e-8. Bound learning rates are shape 0.002, limbs 0.001, pose and offsets 0.0005, barycentric logits 0.01, colors 0.0025 and opacity logits 0.025. Free mesh rates are divided by ten. Free Gaussian rates are position 0.00016 decaying exponentially to 0.0000016, color 0.0025, scale 0.005, rotation 0.001 and opacity 0.025.

Adaptive density control runs every 100 steps during the first 15000 free iterations. The projected gradient threshold is 0.0002 and opacity threshold is 0.005. Small splats clone exactly. Large splats replace their parent with two rotated Gaussian samples and scales divided by 1.6. Opacity resets every 3000 steps. The count is capped at 150000.

The exporter samples idle, walk, run, sit, jump, bark, paw, spin, playbow, sniff and wag at 30 FPS. The animated GLB contains the real 35-joint skeleton. Its four-influence skin serves inspection only. Gaussian and structural appearance use the full D-SMAL vertices in the binary clips. Contact refinement reports actual residuals in numerical-checks.json. Gait travel speed comes from backward stance-paw velocity multiplied by the viewer's 2.6 scale.

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

The reference checks identity, rigid motion, uniform stretch, articulation and degenerate triangles. PLY rows and binding rows keep the same order. Binary arrays are little-endian Uint32 faces, Uint16 binding IDs and Float32 values. topologyHash is SHA256 of the raw Uint32 faces bytes.

training.json records actual iteration counts and completion. A shortened run is never recorded as a complete paper reproduction.
