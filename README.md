# Doggin Around

A local studio for Huawei's challenge dog, rendered as animated Gaussian splats. The dog has 11 selectable actions, can chase a ball across the browser playground, and takes spoken commands through push-to-talk.

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

Open http://localhost:5173. Choose Idle, Walk, Run, Sit, Jump, Bark, Paw, Spin, Play bow, Sniff, or Wag. Walk, Run, Sniff, Wag, and Idle loop. Sit holds its final pose. The other actions play once and return to Idle. Bark plays a short dog sound three times in step with the visible recoil.

Hold `V`, or press and hold the Hold to talk button, and say "sit", "spin around", "good boy", or "go fetch". Voice control needs an ElevenLabs key; see Voice control below. Click the playground floor or press Toss the ball to play fetch. The dog turns toward the ball, walks or runs after it based on distance, carries it home, and resumes idle. Drag to orbit, scroll to zoom, or switch to Mesh and Skeleton to inspect the asset. Density changes rebuild the splats and return to idle. Walk and Run play in place so the host scene can control travel independently.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Browser tests use a small known rig for most controls and load both generated dogs for motion checks. They run installed Google Chrome with WebGL.

## Voice control

Copy `.env.example` to `.env`, add an [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys), and restart the dev server:

```sh
cp .env.example .env
pnpm dev
```

Hold `V` and speak. The studio shows the live transcript in a comic speech bubble and the dog reacts as the words arrive. Without a key the studio still runs; the Hold to talk button explains what is missing.

The key stays on the machine running Vite. `vite.config.ts` adds a `POST /api/scribe-token` route that mints a [single-use realtime token](https://elevenlabs.io/docs/api-reference/tokens/create), valid for 15 minutes and consumed on use, and the browser connects with that. `loadEnv` reads the key with an empty prefix, so it is never inlined into the client bundle. The route also serves `vite preview`. Deploying the studio means porting that one route to the host.

### Speech to text

`src/voice/scribe.ts` streams microphone audio to [Scribe v2 Realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime) over a WebSocket and receives partial transcripts while you speak plus a committed transcript once the segment ends.

The socket opens when the page loads, so a command never pays connection time. Sessions are time limited and the token is single use, so a closed socket reconnects with a fresh token and exponential backoff.

Commits are manual rather than left to the model's voice activity detection. Hands-free segmentation in a loud room lets a neighbouring conversation command the dog. `src/voice/pcm-worklet.js` collects 100 ms frames and only forwards them between key press and release, so no audio leaves the worklet while the key is up. Frames are 16 kHz mono PCM16, base64 encoded; the audio context is requested at 16 kHz and resampled in the rare case a browser refuses that rate.

Keyterm prompting is not sent. The documentation disagrees over whether `scribe_v2_realtime` honours it, and the fuzzy matcher below already covers mishearings.

### Words to commands

`src/voice/commands.ts` is a local keyword parser with no network call, so "sit" reaches the dog in roughly the transcription latency rather than waiting for a language model. It runs on every partial transcript, not only the committed one.

It lowercases the text, strips punctuation and filler words, and drops the dog's name. A phrase table maps spoken forms onto commands, longest phrase first, so "stand up" is idle while a bare "up" is a jump. Unmatched words are stemmed ("sitting", "barks") and then repaired within one edit, which turns a misheard "sid" or "set" into sit.

Repairs are deliberately conservative. Every nearby keyword votes, so a word caught between two of them is dropped rather than guessed, and a keyword shorter than five letters also has to share its first sound. "park" never becomes "bark", "fun" never becomes "run", and "balk" matches nothing because it sits between bark, talk, and walk. Exact matches always beat repairs, which keeps "talk" on bark and "walk" on walk.

Commands come back in spoken order, so "come here and sit" runs both. `CommandStream` tracks what a partial already fired so the committed transcript does not repeat it, and compares the new command list against the fired one, so a correction ("sit" heard, "stand up" committed) replaces the tail instead of stacking onto it.

Beyond the 11 clips, "fetch" throws the ball, "stop" settles the dog, and "come here" walks it home. Praise is a tail wag.

An utterance that names an object or a place the table cannot resolve is marked for escalation. That second layer, a language model turning "go grab that stick by the fireplace" into structured JSON against the panel's objects, is not built yet. For now the studio says so in the speech bubble rather than leaving the dog silent.

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

The reviewed mapping for this model is `public/models/huawei-dog-rig.json`. It identifies the actual armature, root, torso, head, neck, jaw, tail, and four leg chains. `forward`, `up`, and `spin_pivot` use Blender's armature-local coordinates. Each newly generated rig must be inspected and its profile reviewed before animation.

```sh
blender --background --python scripts/animate-dog.py -- outputs/huawei-fullbody-generation/dog/mesh.glb public/models/huawei-dog-rig.json work/dog-authored.glb work/dog-authored.blend
mkdir -p work/labrador-bvh
curl -L https://ndownloader.figshare.com/files/43971117 -o work/raw_bvh_data.zip
unzip -j work/raw_bvh_data.zip 'raw_bvh_data/dog_quad_walk_001.bvh' 'raw_bvh_data/dog_quad_run_001.bvh' -d work/labrador-bvh
blender --background --python scripts/retarget-bvh.py -- work/dog-authored.blend work/labrador-bvh/dog_quad_walk_001.bvh work/dog-walk.glb work/dog-walk.blend --clip walk --replace-track walk --first 10981 --last 11141 --step 4 --loop --contact-floor
blender --background --python scripts/retarget-bvh.py -- work/dog-walk.blend work/labrador-bvh/dog_quad_run_001.bvh public/models/dog-animated.glb outputs/huawei-dog-animation.blend --clip run --replace-track run --first 2101 --last 2185 --step 4 --loop --loop-fade 4
```

The first script bakes 11 authored clips. The two retarget passes replace Walk and Run with Labrador motion-capture loops adapted from [*Lifelike Agility and Play in Quadrupedal Robots using Reinforcement Learning and Generative Pre-trained Models* by Lei Han et al.](https://springernature.figshare.com/articles/dataset/Lifelike_Agility_and_Play_in_Quadrupedal_Robots_using_Reinforcement_Learning_and_Generative_Pre-trained_Models/24968946), released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The source intervals were cropped, retargeted onto the Huawei dog, and blended into loops. Source frames are one-based Blender BVH frames. The final `.blend` file keeps the animation tracks editable. The earlier example dog's source is `outputs/dog-animation.blend` and its mapping is `public/models/dog-rig.json`.

The browser accepts self-contained animated GLBs with a skinned mesh, usable skin weights, and at least an `idle` clip. It shows controls for other supported clips found in the asset. Bone names need not follow a specific naming convention. Each skin supports up to 256 bones and four influences per Gaussian.

Walk is a lively in-place gait with approximate paw contact. Run is a short bounding loop with airborne frames. Sit, Jump, Bark, Paw, Spin, Play bow, Sniff, Wag, and Idle were authored for this rig. They are designed for a responsive hackathon demo, with no physics, realistic ground travel, or lip sync. The generated dog's mouth does not open cleanly, so Bark uses head motion and a sound cue. Each new AniGen skeleton needs a reviewed joint profile and retargeting pass. In Blender's Animation workspace, enable the desired NLA track to edit or preview a clip. Idle is enabled when opening the saved file.

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

Shape conversion samples triangle area, transfers barycentric skin weights, merges shared joints, and normalizes the four largest contributions. Colors come from material base color and texture UVs. The same bind matrices drive Three.js and Spark linear blend skinning. A static PLY alone cannot preserve this skeleton and animation data.

Voice control is wired into the studio in `src/main.ts`, not into the `Dog` class. `src/voice/commands.ts` has no browser or Three.js dependency, so a host scene can reuse the parser and map the commands onto its own behaviour. Photo-upload generation, language-model command interpretation, narration, and webtoon world creation are later integrations.

## Verified setup

The Huawei export retains one textured skinned mesh, 41 joints, valid skin weights, and 11 named animation clips. The original portrait run has only 8 joints. Inspection reports for both Huawei inputs are in `outputs/huawei-fullbody-rig-inspection.json` and `outputs/huawei-direct-rig-inspection.json`. The earlier example dog's report is in `outputs/dog-rig-inspection.json`. Unit tests cover sampling, bind transforms, fetch behavior, and the voice keyword parser. Chrome tests cover Gaussian rendering, controls, replacement, fetch, actions, a complete turn, leg motion, and the spoken command path. The voice browser test drives transcripts directly, so it needs neither a microphone nor an ElevenLabs key. Type checking, lint, and the production build pass.

The final Huawei dog measured 60 FPS for Idle, Walk, and Run with 50,000 splats at a 1440 by 960 Chrome viewport on the setup Mac. The median frame interval was 16.7 ms. Performance varies with device, pixel ratio, camera framing, and density. Spark's embedded runtime makes the initial JavaScript bundle relatively large, about 1.05 MB compressed.

Both setup pods were terminated after downloading their generated assets. The first took about 48 minutes at the quoted $0.50 per hour, which implies roughly $0.40 compute. The Huawei pod took about 28 minutes at the same quoted rate, which implies roughly $0.23 compute. Storage is additional, and these are estimates rather than settled charges. No pod is left running. Environment versions and generation metadata are preserved in `outputs/`.

## Sources

- [AniGen](https://github.com/VAST-AI-Research/AniGen)
- [Spark](https://github.com/sparkjsdev/spark)
- [PyTorch3D](https://github.com/facebookresearch/pytorch3d)
- [RunPod SSH documentation](https://docs.runpod.io/pods/configuration/use-ssh)
- [Labrador motion-capture dataset](https://springernature.figshare.com/articles/dataset/Lifelike_Agility_and_Play_in_Quadrupedal_Robots_using_Reinforcement_Learning_and_Generative_Pre-trained_Models/24968946), CC BY 4.0
- [Dog bark recording by Broadbeer](https://commons.wikimedia.org/wiki/File:George_vuf_1996.ogg), public domain
- [ElevenLabs Scribe v2 Realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime)

AniGen and Spark use MIT licenses for their main code. AniGen has separately licensed dependencies. The training-only CUBVH extension is not used by this inference setup. Retain upstream license and attribution records for generated assets and dependencies.
