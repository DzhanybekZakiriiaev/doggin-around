# Doggin Around

A desktop studio for Huawei's challenge dog. Its default appearance is 50,000 photo-generated Gaussians animated by a 41-joint rig. The dog has 11 actions, responds to a thrown ball, and can be inspected as splats, a mesh, or a skeleton.

## Huawei challenge photo

`public/models/huawei-dog-reference.png` is the supplied portrait. It establishes the visible face, cream sunglasses, three daisies, blue head covering, and blue and orange bow. It does not show the dog's back or legs. `public/models/huawei-dog-fullbody.png` is an AI-generated full-body extension used to make the hidden anatomy plausible. The studio displays both references.

[AniGen](https://github.com/VAST-AI-Research/AniGen) provided the textured 41-joint quadruped in `public/models/dog-animated.glb`. Its mesh and skeleton remain the deformation cage and editable animation source in `outputs/huawei-dog-animation.blend`. The default visible appearance comes from a bounded [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) comparison, saved as `public/models/dog-triposplat-50000.ply` and paired with bone indices and weights. TripoSplat gave the muzzle, coat, ears, glasses, flowers, and bow more useful detail than surface sampling the AniGen mesh. The browser uses [Spark](https://sparkjs.dev/docs/splat-mesh/) to skin the Gaussians with the existing rig. [SMAL-pets](https://arxiv.org/html/2603.17131) informed the idea of binding a detailed Gaussian appearance to an animatable animal model.

The accessory regions are segmented from the generated Gaussians and rigidly attached to the head or neck joint. They are distinct moving regions, though they are not separate Blender mesh objects. The Mesh view shows the original AniGen deformation cage, so its accessories look softer than the default Splat view. No new ear, tail, or bow joints were added because the current generated geometry has no reliable skin weights for them.

The earlier AniGen example remains at `public/models/example-dog-animated.glb`. Imported animated GLBs continue to use surface sampling with bilinear texture color, more samples near high-contrast details, and a restrained pale fur layer. They need a skinned mesh, usable weights, and an `idle` clip. The captured 50,000-splat appearance is only selected for the supplied Huawei asset.

## Local development

Node, pnpm, and a desktop browser with WebGL are required. Blender is needed to regenerate animations or bindings.

Blender 5.2.2 is installed on the setup Mac. On another Mac, install it with `brew install --cask blender`. Use the application executable directly if `blender` is not available on your terminal's path.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173. Choose Idle, Walk, Run, Sit, Jump, Bark, Paw, Spin, Play bow, Sniff, or Wag. Walk, Run, Sniff, Wag, and Idle loop. Sit holds its final pose. The other actions play once and return to Idle. Bark plays a short dog sound three times in step with the visible recoil.

Click the playground floor or press Toss the ball to play fetch. The dog turns toward the ball, walks or runs after it based on distance, lowers its chest, neck, and head to sniff at the ball, lifts the ball toward its muzzle, carries it home, and resumes idle. Drag to orbit, scroll to zoom, or switch to Mesh and Skeleton to inspect the asset. Density changes rebuild the splats and return to idle. The default stays within 50,000 splats. Walk and Run play in place so the host scene can control travel independently.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Browser tests use installed Google Chrome with WebGL. They exercise the captured default dog, a small fixture rig, imported assets, controls, actions, and fetch.

## Generate and bind the Gaussian appearance

The selected RunPod comparison used one RTX A6000 48 GB pod with the official PyTorch 2.8.0 and CUDA 12.8 image. It ran the original portrait and full-body extension at 65,536, 131,072, and 262,144 Gaussians with seed 42, 20 steps, guidance 3, and shift 3. The full-body 65,536-splat result kept the recognizable face and gave a complete dog. Its source parameters are saved in `outputs/huawei-triposplat-fullbody-65536.npz`. The inference results are recorded in `outputs/huawei-triposplat-inference.json`.

To repeat inference on an NVIDIA GPU, clone the official source at the tested revision and install the runtime dependencies:

```sh
git clone https://github.com/VAST-AI-Research/TripoSplat.git TripoSplat
git -C TripoSplat checkout d8db9e018b413dd9c4a9fe22463781bf98e8e68d
python3 -m pip install uv
uv venv --system-site-packages triposplat-venv
uv pip install --python triposplat-venv/bin/python numpy==2.5.3 safetensors==0.8.0 pillow==12.3.0 tqdm==4.70.1 huggingface-hub==2.1.1
source triposplat-venv/bin/activate
```

Download the official weights at the tested revision:

```sh
python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='VAST-AI/TripoSplat',
    revision='56a96e603204ec410c4da60c13ea4fa09a2169a9',
    local_dir='TripoSplat/ckpts',
    allow_patterns=[
        'background_removal/birefnet.safetensors',
        'clip_vision/dino_v3_vit_h.safetensors',
        'diffusion_models/triposplat_fp16.safetensors',
        'vae/flux2-vae.safetensors',
        'vae/triposplat_vae_decoder_fp16.safetensors',
    ],
)
PY
```

Copy `scripts/generate-triposplat.py` and `public/models/huawei-dog-fullbody.png` to the GPU host, then run:

```sh
python generate-triposplat.py --source TripoSplat --weights TripoSplat/ckpts --image huawei-dog-fullbody.png --output generated/fullbody
```

This writes PLY, SPLAT, NPZ, a processed input image, and inference metadata for all three densities. Copy `generated/fullbody/dog-65536.npz` back to `outputs/huawei-triposplat-fullbody-65536.npz` before deleting the GPU pod. The saved NPZ allows binding to be repeated locally without renting a GPU again.

Bind the appearance to the current 41-joint GLB on a machine with Blender and NumPy:

```sh
blender --background --python scripts/bind-triposplat.py -- --input outputs/huawei-triposplat-fullbody-65536.npz --rig public/models/dog-animated.glb --output work/triposplat-binding --publish public/models
```

The binder aligns the generated Gaussians to the rig, transfers nearest-triangle barycentric skin weights, rigidly binds segmented accessories, and selects a constant 50,000-splat subset. The fixed selection favors the face, accessory regions, and dark detail. It retains 17,203 of 23,020 face-region splats and 5,632 of 7,212 head-accessory splats in the current result. A narrow lower-muzzle region receives stronger existing jaw-joint weights. The current 50,000-splat selection includes 771 such Gaussians. The bow, beard, glasses, and cap are excluded from that jaw adjustment. The binder writes diagnostic poses and distances in `work/triposplat-binding` and publishes the PLY, metadata, joint indices, and weights in `public/models`. Regenerate the binding whenever `dog-animated.glb` changes. Inspect front, side, three-quarter, and rear views as well as Walk, Bark, Sniff, and Spin before accepting a new binding. `rigSha256` in the metadata records which GLB produced the published appearance.

The comparison pod was terminated after 18 minutes and 19 seconds. The quoted combined rate was $0.54 per hour, implying a conservative $0.165 upper estimate. RunPod's pod-specific billing history reports $0.0897 for this run. The deleted pod was absent from the subsequent pod list. The run record is saved in `outputs/huawei-triposplat-run-receipt.json`.

## Generate a dog on RunPod

Use one RTX 3090 with 24 GB VRAM or an A40 with 48 GB. Start with the official `runpod-torch-v21` template, which includes Ubuntu 22.04, Python 3.10, and the CUDA 11.8 development toolkit. The host driver may be newer than the container CUDA toolkit. Configure 30 GB container disk, 100 GB `/workspace` disk, and SSH on `22/tcp`.

The tested container image is `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04`. The setup script upgrades its PyTorch environment to 2.4.0. Define `DOG_SSH_KEY` as your private key's local path and `DOG_SSH_HOST` and `DOG_SSH_PORT` from the new pod's direct SSH connection details before using the commands below.

Set `PUBLIC_KEY` and `SSH_PUBLIC_KEY` to your local public SSH key when creating the pod. Use the pod's current public IP and mapped SSH port. Restarting the pod may change that port. Keep the private key on your machine.

Transfer and run the setup script, then send Huawei's full-body reference to the pod:

```sh
scp -i "$DOG_SSH_KEY" -P "$DOG_SSH_PORT" scripts/setup-anigen.sh scripts/generate-dog.sh root@"$DOG_SSH_HOST":/workspace/
ssh -i "$DOG_SSH_KEY" -p "$DOG_SSH_PORT" root@"$DOG_SSH_HOST" 'bash /workspace/setup-anigen.sh'
scp -i "$DOG_SSH_KEY" -P "$DOG_SSH_PORT" public/models/huawei-dog-fullbody.png root@"$DOG_SSH_HOST":/workspace/huawei-dog-fullbody.png
ssh -i "$DOG_SSH_KEY" -p "$DOG_SSH_PORT" root@"$DOG_SSH_HOST" 'bash /workspace/generate-dog.sh /workspace/huawei-dog-fullbody.png'
```

For another photo, transfer it to the pod and pass its path to `generate-dog.sh`. Use a clear whole-body dog picture with visible legs. The tested Huawei run used seed 42, AniGen revision `c49db3d6b466537a02ccf2286688903d77af7e4f`, Solo and Auto checkpoints, PyTorch 2.4.0 with CUDA 11.8, dense SDPA attention, and sparse xformers attention. The exact generation command and environment are recorded in `outputs/huawei-fullbody-generation/generation.json` and `outputs/huawei-anigen-requirements.txt`.

The setup pins the tested AniGen revision and installs PyTorch 2.4.0 and xformers for sparse attention. It preinstalls PyTorch3D v0.7.9 because AniGen's installer references a missing v0.7.8 archive. It installs nvdiffrast v0.3.3 from source to match CUDA 11.8, rather than using the upstream CUDA 12 wheel, and adds the missing `rtree` dependency. Checkpoints download from `VAST-AI/AniGen`. GPU setup and first downloads can take substantially longer than inference.

Retrieve the output before terminating the pod:

```sh
scp -i "$DOG_SSH_KEY" -P "$DOG_SSH_PORT" -r root@"$DOG_SSH_HOST":/workspace/dog-output/. outputs/huawei-fullbody-generation/
scp -i "$DOG_SSH_KEY" -P "$DOG_SSH_PORT" root@"$DOG_SSH_HOST":/workspace/anigen-requirements.txt outputs/huawei-anigen-requirements.txt
```

The saved `outputs/huawei-direct-generation/` run used the original cropped photo and the same seed. `generate-dog.sh` replaces `/workspace/dog-output` on each run, so retrieve or rename the first result before running a second photo. Verify the GLB locally before terminating. Stopping releases compute but retains billable disk. Terminating deletes this pod's workspace. Preserve generated assets and environment records first. The sandbox only needs the local exported asset after generation.

## Blender animation

Inspect a new generated model first:

```sh
blender --background --python scripts/inspect-rig.py -- outputs/huawei-fullbody-generation/dog/mesh.glb work/huawei-rig.json
```

The reviewed mapping for this model is `public/models/huawei-dog-rig.json`. It identifies the actual armature, root, torso, head, neck, jaw, tail chain, ear joints, and four leg chains. `forward`, `up`, and `spin_pivot` use Blender's armature-local coordinates. Each newly generated rig must be inspected and its profile reviewed before animation.

```sh
blender --background --python scripts/animate-dog.py -- outputs/huawei-fullbody-generation/dog/mesh.glb public/models/huawei-dog-rig.json work/dog-authored.glb work/dog-authored.blend
mkdir -p work/labrador-bvh
curl -L https://ndownloader.figshare.com/files/43971117 -o work/raw_bvh_data.zip
unzip -j work/raw_bvh_data.zip 'raw_bvh_data/dog_quad_walk_001.bvh' 'raw_bvh_data/dog_quad_run_001.bvh' -d work/labrador-bvh
blender --background --python scripts/retarget-bvh.py -- work/dog-authored.blend work/labrador-bvh/dog_quad_walk_001.bvh work/dog-walk.glb work/dog-walk.blend --clip walk --replace-track walk --first 11253 --last 11341 --step 4 --loop --contact-floor
blender --background --python scripts/retarget-bvh.py -- work/dog-walk.blend work/labrador-bvh/dog_quad_run_001.bvh work/dog-mocap-base.glb work/dog-mocap-base.blend --clip run --replace-track run --first 2237 --last 2293 --step 4 --loop --loop-fade 4 --ground-clamp
```

The first script bakes 11 authored clips. The two retarget passes create a starting Walk and Run from Labrador motion-capture loops adapted from [*Lifelike Agility and Play in Quadrupedal Robots using Reinforcement Learning and Generative Pre-trained Models* by Lei Han et al.](https://springernature.figshare.com/articles/dataset/Lifelike_Agility_and_Play_in_Quadrupedal_Robots_using_Reinforcement_Learning_and_Generative_Pre-trained_Models/24968946), released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Each source interval covers one coherent stride. Retargeting removes heading while retaining pelvis pitch and roll, filters rotations, and matches the pose and tangent at the loop seam. Source frames are one-based Blender BVH frames. These commands produce a base asset, not the final published gait. The final Walk and Run retain the previous smooth clip timing and have the front wrists limited to 0.24 radians with shoulder and elbow contact correction. The final Sniff and Bark have deeper head and jaw articulation. `outputs/huawei-dog-animation.blend` was imported from the checked-in final GLB, so its 11 NLA tracks match the browser asset and remain editable. The earlier example dog's source is `outputs/dog-animation.blend` and its mapping is `public/models/dog-rig.json`.

The browser accepts self-contained animated GLBs with a skinned mesh, usable skin weights, and at least an `idle` clip. It shows controls for other supported clips found in the asset. Bone names need not follow a specific naming convention. Each skin supports up to 256 bones and four influences per Gaussian.

Walk is a lively in-place gait with contact correction. Run is a short bounding loop with airborne frames and a floor clamp. Sit lowers the haunches onto planted paws. Jump crouches, lifts, and lands back on its starting floor line. Fetch matches gait cadence to travel speed, pauses near the ball for a Sniff pickup, then resumes the same gait on the return. Bark, Paw, Spin, Play bow, Sniff, Wag, and Idle were authored for this rig. The existing neck, head, jaw, and ear joints move during Sniff and Bark. The lower muzzle deforms, but the generated closed-mouth shell has no inner-mouth geometry, so a clearly open mouth is not yet possible. There is no physics or lip sync. Each new AniGen skeleton needs a reviewed joint profile and retargeting pass. In Blender's Animation workspace, enable the desired NLA track to edit or preview a clip. Idle is enabled when opening the saved file.

Authored gestures use quintic easing, distributed spine bends, a tapered tail wave, and small delayed ear motion. Paw shifts weight toward the supporting legs and uses bounded inverse kinematics to keep their contact points planted in three dimensions. The existing 41 joints and rest geometry remain the binding source.

Action switches capture the rendered pose and ease into the new clip over 0.3 seconds. Repeating or interrupting an action uses the same transition, and completed gestures render their last frame before returning to Idle. Fetch uses measured planted-paw speeds of 2.25 units per second for Walk and 4.7 for Run to match animation cadence to travel.

### Additional motion datasets

The app retargets captured animation directly and does not train a motion model. The existing [Labrador BVH source](https://springernature.figshare.com/articles/dataset/Lifelike_Agility_and_Play_in_Quadrupedal_Robots_using_Reinforcement_Learning_and_Generative_Pre-trained_Models/24968946) is the immediate source for distributable clips under CC BY 4.0. Other datasets can inform future anatomical calibration, subject to their access and reuse terms:

- [InterPet4D](https://huggingface.co/datasets/ohicarip/interpet4d) includes skeletal trajectories and SMAL pose fits from natural interactions across 13 dogs. Its license is CC BY-NC 4.0, and the current release describes the SMAL fits as unrefined.
- [DigiDogs](https://cvssp.org/data/DigiDogs/) includes synthetic videos, 3D keypoints, and BVH motion. Its dataset terms restrict use to non-commercial research and prohibit redistribution.
- [RGBD-Dog from Kearney et al.](https://github.com/CAMERA-Bath/RGBD-Dog) includes real solved skeletal motion, meshes, and weights. Dataset access requires an academic release form.
- [RGBT-Dog](https://openaccess.thecvf.com/content/WACV2024/papers/Deane_RGBT-Dog_A_Parametric_Model_and_Pose_Prior_for_Canine_Body_WACV_2024_paper.pdf) describes a 43-joint parametric model and canine pose prior. A downloadable release and reuse license have not been verified for this project.
- [SyDog-Video](https://cvssp.org/data/SyDogVideo/) and Dogio-11 support temporal pose estimation rather than providing ready-to-use dog animation clips. SyDog-Video restricts use to non-commercial research and prohibits redistribution.

## Integration

```ts
import { Dog } from './src/dog'

const dog = new Dog()
scene.add(dog.group)
await dog.loadDog('/models/dog-animated.glb')
dog.playAction('spin')

// Call from the host scene's frame loop.
dog.update(deltaSeconds)

// Release GPU resources when leaving the scene.
dog.dispose()
```

Construct the host's `SparkRenderer` with `covSplats: true` and `accumExtSplats: true`. Move `dog.group` to place the dog inside another scene. Idle, Walk, Run, Sniff, and Wag loop. Sit holds its last pose. Jump, Bark, Paw, Spin, and Play bow return to Idle when finished. Set `dog.paused`, `dog.speed`, or call `dog.setView('mesh')` for inspection. The host application handles Bark audio, while the `Dog` class handles only motion.

The default Gaussian appearance is aligned to the deformation cage and carries four normalized joint influences per splat. For imported GLBs, shape conversion samples triangle area, transfers barycentric skin weights, and reads bilinear texture color. The same bind matrices drive Three.js and Spark linear blend skinning. A static PLY alone cannot preserve skeleton and animation data.

Photo-upload generation, voice interpretation, narration, and webtoon world creation are later integrations.

## Verified setup

The Huawei GLB retains one textured skinned mesh, 41 joints, valid skin weights, and 11 named clips. The original portrait run has only eight joints. Inspection reports for both inputs are in `outputs/huawei-fullbody-rig-inspection.json` and `outputs/huawei-direct-rig-inspection.json`. The earlier example dog's report is in `outputs/dog-rig-inspection.json`. Front, side, three-quarter, and rear views plus every action were inspected for accessory alignment, fur artifacts, paw contact, and ground penetration. The 50,000 Gaussians move coherently with the rig in Walk and Spin. The current suite has 36 passing unit tests and 21 passing Chrome tests, with two optional tricolor tests skipped. Type checking, lint, and the production build pass. The gait regression limits maximum front-wrist rotation to 0.24 radians, with minimum Walk and Run paw heights of -0.001 and -0.013 scene units. Maximum joint changes at 60 Hz are 0.229 radians for Walk and 0.150 for Run. Loop endpoint positions match, with velocity gaps of 0.186 and 0.318 scene units per second.

The live 50,000-splat app reported 60 FPS for the checked actions at 1440 by 960 in Chrome on the setup Mac, with no page or console errors. This meets the 45 FPS floor in that environment. Performance varies with device, pixel ratio, camera framing, and density. Spark's embedded runtime makes the initial JavaScript bundle relatively large, about 1.05 MB compressed.

All setup and comparison pods were terminated after downloading assets. Previous AniGen runs implied about $0.63 of compute at their quoted rates. The new TripoSplat run has a posted pod-specific charge of $0.0897, below its conservative $0.165 estimate. Environment versions and generation metadata are preserved in `outputs/`.

The supplied portrait cannot establish the dog's true hidden body. The reconstructed back and legs are a plausible synthetic interpretation. The accessory Gaussian regions follow head and neck joints but do not articulate petals or bow loops individually. Motion is authored and retargeted for this 41-joint dog and needs adaptation for a different rig.

## Sources

- [AniGen](https://github.com/VAST-AI-Research/AniGen)
- [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat)
- [SMAL-pets](https://arxiv.org/html/2603.17131)
- [Spark](https://github.com/sparkjsdev/spark)
- [PyTorch3D](https://github.com/facebookresearch/pytorch3d)
- [RunPod SSH documentation](https://docs.runpod.io/pods/configuration/use-ssh)
- [Labrador motion-capture dataset](https://springernature.figshare.com/articles/dataset/Lifelike_Agility_and_Play_in_Quadrupedal_Robots_using_Reinforcement_Learning_and_Generative_Pre-trained_Models/24968946), CC BY 4.0
- [Dog bark recording by Broadbeer](https://commons.wikimedia.org/wiki/File:George_vuf_1996.ogg), public domain

AniGen, TripoSplat, and Spark publish their main code under MIT licenses. AniGen has separately licensed dependencies. Check model and dependency terms before redistributing generated assets.
