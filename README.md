# Doggin Around

A local studio for Huawei's challenge dog, rendered as animated Gaussian splats. The dog can idle, walk, spin, and play fetch in the browser.

The default asset is `public/models/dog-animated.glb`. The earlier AniGen example dog remains available at `public/models/example-dog-animated.glb` for comparison. Both are editable through their saved Blender projects.

## Huawei challenge photo

`public/models/huawei-dog-reference.png` is the supplied challenge image. It shows the dog's head and upper body with sunglasses, daisies, and a blue bow. `public/models/huawei-dog-fullbody.png` is an AI-generated extension that adds the missing legs and back for reconstruction. The added anatomy is synthetic. The studio shows both images so the source and intermediate step remain clear.

AniGen generated a textured 41-bone quadruped from the full-body extension. Running the same model directly on the cropped challenge photo produced only an 8-bone rig. The selected full-body result supports all four leg chains, a head, and a tail. It resembles the supplied dog, although the small accessory details are soft. For closer visual fidelity, attach glasses, flowers, and bow as separate objects to the head or neck bones in Blender. The 3D generator does not guarantee faithful accessories.

Meshy remains an alternative if it produces a closer likeness. Its [web app supports quadruped rigging](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging), while its [rigging API currently targets humanoids](https://docs.meshy.ai/en/api/rigging). Its [quadruped animation library](https://www.meshy.ai/animation-library) lists walking, so a Meshy dog would still need reviewed idle and spin clips. [Meshy 6 and 7 downloads require a paid plan](https://help.meshy.ai/en/articles/10421033-why-can-t-i-download-my-model), and this project has not compared an exported Meshy dog. Compare the face, accessories, leg structure, skin weights, and final browser frame rate before switching generators. The Gaussian conversion and fetch interaction can use either source once it is an animated GLB.

The pipeline is AniGen on an NVIDIA GPU, Blender for motion clips, then Three.js and Spark in the browser. The visible dog consists of surface-sampled Gaussians driven by the GLB skeleton. This is not photometric 3DGS training or recovered individual fur strands.

## Local development

Node and pnpm are required. Blender is required for creating animations and test fixtures.

Blender 5.2.2 is installed on the setup Mac. On another Mac, install it with `brew install --cask blender`. Use the application executable directly if `blender` is not available on your terminal's path.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:5173. Use Idle, Walk, and Spin to control the dog. Click a location on the playground floor or press Toss the ball to play fetch. The ball travels to that spot, the dog turns and walks after it, carries it home, and resumes idle. Drag to orbit, scroll to zoom, or switch to Mesh and Skeleton to inspect the asset. Density changes rebuild the splats and return to idle. The walk clip runs in place so the host scene can control travel independently.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Browser tests use a small known rig for most controls and load both generated dogs for motion checks. They run installed Google Chrome with WebGL.

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

The reviewed mapping for this model is `public/models/huawei-dog-rig.json`. It identifies the actual armature, root, torso, head, tail, and four leg chains. `forward`, `up`, and `spin_pivot` use Blender's armature-local coordinates. The animation script uses these directions to calculate the leg swing axis and turn around the torso. Diagonal legs use matching phases. Each newly generated rig must be inspected and its profile reviewed before animation.

```sh
blender --background --python scripts/animate-dog.py -- outputs/huawei-fullbody-generation/dog/mesh.glb public/models/huawei-dog-rig.json public/models/dog-animated.glb outputs/huawei-dog-animation.blend
```

The script bakes idle, walk, and spin clips and exports them from separate NLA tracks. The `.blend` file remains editable. The earlier example dog's source is `outputs/dog-animation.blend` and its mapping is `public/models/dog-rig.json`. The browser accepts self-contained animated GLBs with a skinned mesh, usable skin weights, and clips named `idle`, `walk`, and `spin`. Missing clips or unsupported rigs show an error. Bone names need not follow a specific naming convention. Each skin supports up to 256 bones and four influences per Gaussian.

These are simple authored motion clips. Walk runs in place and the paws can slide during stepping. Ground contact, realistic locomotion, lip sync, and physics are not implemented. In Blender's Animation workspace, enable the desired NLA track to edit or preview a clip. Idle is enabled when opening the saved file.

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

Construct the host's `SparkRenderer` with `covSplats: true` and `accumExtSplats: true`. Move `dog.group` to place the dog inside another scene. Idle and walk loop. Spin plays once and returns to idle. Set `dog.paused`, `dog.speed`, or call `dog.setView('mesh')` for inspection.

Shape conversion samples triangle area, transfers barycentric skin weights, merges shared joints, and normalizes the four largest contributions. Colors come from material base color and texture UVs. The same bind matrices drive Three.js and Spark linear blend skinning. A static PLY alone cannot preserve this skeleton and animation data.

Photo-upload generation, voice interpretation, narration, and webtoon world creation are later integrations.

## Verified setup

The Huawei export retains one textured skinned mesh, 41 joints, valid skin weights, and three named animation clips. The original portrait run has only 8 joints. Inspection reports for both Huawei inputs are in `outputs/huawei-fullbody-rig-inspection.json` and `outputs/huawei-direct-rig-inspection.json`. The earlier example dog's report is in `outputs/dog-rig-inspection.json`. Unit tests cover sampling, bind transforms, and fetch behavior. Chrome tests cover Gaussian rendering, controls, replacement, mobile layout, fetch, and both generated dogs' complete turn and leg motion. Type checking, lint, and the production build pass.

The earlier example dog rendered at approximately 58 to 60 FPS with 50,000 splats in Chrome on the setup Mac. Huawei dog playback has also reached approximately 59 to 60 FPS after loading. Performance varies with device, pixel ratio, camera framing, and density. Spark's embedded runtime makes the initial JavaScript bundle relatively large, about 1.05 MB compressed.

Both setup pods were terminated after downloading their generated assets. The first took about 48 minutes at the quoted $0.50 per hour, which implies roughly $0.40 compute. The Huawei pod took about 28 minutes at the same quoted rate, which implies roughly $0.23 compute. Storage is additional, and these are estimates rather than settled charges. No pod is left running. Environment versions and generation metadata are preserved in `outputs/`.

## Sources

- [AniGen](https://github.com/VAST-AI-Research/AniGen)
- [Spark](https://github.com/sparkjsdev/spark)
- [PyTorch3D](https://github.com/facebookresearch/pytorch3d)
- [RunPod SSH documentation](https://docs.runpod.io/pods/configuration/use-ssh)

AniGen and Spark use MIT licenses for their main code. AniGen has separately licensed dependencies. The training-only CUBVH extension is not used by this inference setup. Retain upstream license and attribution records for generated assets and dependencies.
