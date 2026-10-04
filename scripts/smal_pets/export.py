"""Export ordered PLY splats, ten-face bindings and full vertex clips."""

import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import torch
from gaussians import progressive_order, read_ply, write_ply
from geometry import bind_faces, deform
from model import PetModel
from bake import bake_animations
from glb import write_animated_glb


def gait_cadence(rest, clips):
    forward = rest[1863] - rest[452]
    forward[1] = 0
    forward /= max(np.linalg.norm(forward), 1e-8)
    result = {}
    for name in ("walk", "run"):
        clip = clips[name]
        paws = clip["positions"][:, [1330, 3282, 1521, 3473]]
        dt = np.diff(clip["times"])[:, None]
        velocities = np.einsum("flc,c->fl", np.diff(paws, axis=0), forward) / dt
        height = paws[:-1, :, 1]
        low = height <= np.quantile(height, 0.4, axis=0)[None]
        backwards = -velocities[low & (velocities < -1e-5)]
        if not len(backwards):
            raise RuntimeError(f"No stance velocity found for {name}")
        result[name] = {"cyclesPerSecond": 1 / clip["duration"], "travelSpeed": float(np.median(backwards) * 2.6)}
    return result


def write_asset(output, parameters, rest, faces, clips, contact_errors=None, pet=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "clips").mkdir(exist_ok=True)
    face_ids, weights = bind_faces(parameters["means"], rest, faces)
    files = {"splats": "splats.ply", "restPositions": "rest.positions.bin", "faces": "faces.bin", "faceIds": "face-ids.bin", "weights": "face-weights.bin"}
    write_ply(output / files["splats"], parameters)
    np.asarray(rest, dtype="<f4").tofile(output / files["restPositions"])
    np.asarray(faces, dtype="<u4").tofile(output / files["faces"])
    face_ids.astype("<u2").tofile(output / files["faceIds"])
    weights.astype("<f4").tofile(output / files["weights"])
    exported_clips = []
    for name, clip in clips.items():
        times = f"clips/{name}.times.bin"
        positions = f"clips/{name}.positions.bin"
        clip["times"].astype("<f4").tofile(output / times)
        clip["positions"].astype("<f4").tofile(output / positions)
        exported_clips.append({"name": name, "duration": clip["duration"], "times": times, "positions": positions})
    mouth_vertex = 1863 if len(rest) == 3889 else 0
    mouth_candidates = np.where((faces == mouth_vertex).any(axis=1))[0]
    mouth_face = int(mouth_candidates[0])
    barycentric = [float(index == mouth_vertex) for index in faces[mouth_face]]
    cadence = gait_cadence(rest, clips) if len(rest) == 3889 else {name: {"cyclesPerSecond": 1 / clips[name]["duration"], "travelSpeed": 1.0} for name in ("walk", "run")}
    manifest = {"version": 1, "kind": "smal-pets-faces", "count": len(parameters["means"]), "vertexCount": len(rest), "faceCount": len(faces), "nearestFaces": 10, "coordinateSpace": "mesh-local-y-up", "topologyHash": hashlib.sha256(np.asarray(faces, dtype="<u4").tobytes()).hexdigest(), "files": files, "clips": exported_clips, "mouth": {"face": mouth_face, "barycentric": barycentric}, "gaitCadence": cadence}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    sample = np.arange(min(4096, len(parameters["means"])))
    points = parameters["means"][sample]
    quaternions = parameters["quats"][sample]
    scales = np.exp(parameters["log_scales"][sample])
    posed, rotated, sized = deform(points, quaternions, scales, rest, rest, faces, face_ids[sample], weights[sample])
    identity_error = float(np.max(np.abs(posed - points)))
    if identity_error > 2e-6:
        raise RuntimeError(f"Face binding identity mismatch {identity_error}")
    if not np.allclose(np.linalg.norm(rotated, axis=1), 1, atol=1e-5):
        raise RuntimeError("Face binding produced invalid quaternions")
    if not np.allclose(sized, scales, atol=2e-6):
        raise RuntimeError("Face binding changed rest scales")
    (output / "numerical-checks.json").write_text(json.dumps({"identity_max_error": identity_error, "weight_sum_max_error": float(np.abs(weights.sum(1) - 1).max()), "count": len(parameters["means"]), "sampleCount": len(points), "contact_max_errors": contact_errors or {}, "minimum_paw_heights": {name: clip.get("minimumPawHeight") for name, clip in clips.items()}, "vertexCount": len(rest), "full_smal": len(rest) == 3889}, indent=2) + "\n")
    if pet is not None:
        write_animated_glb(output / "dog-animated.glb", rest, faces, clips, pet)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bite-source", required=True)
    parser.add_argument("--bite-fit", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--ply")
    parser.add_argument("--output", required=True)
    parser.add_argument("--counts", type=int, nargs="+", default=[50000, 100000, 150000])
    args = parser.parse_args()
    saved = torch.load(args.checkpoint, map_location="cuda", weights_only=False)
    if saved["stage"] != "free":
        raise RuntimeError("Export requires the free Gaussian stage")
    pet = PetModel(args.bite_source, args.bite_fit)
    pet.load_state_dict(saved["pet"])
    rest = pet().detach().cpu().numpy()
    faces = pet.faces.cpu().numpy()
    parameters = read_ply(args.ply) if args.ply else {name: value.cpu().numpy() for name, value in saved["gaussians"].items()}
    order = progressive_order(parameters)
    parameters = {name: value[order] for name, value in parameters.items()}
    clips, contact_errors = bake_animations(pet)
    write_asset(args.output, parameters, rest, faces, clips, contact_errors, pet)
    densities = []
    for cap in args.counts:
        count = min(cap, len(parameters["means"]))
        selected = {name: value[:count] for name, value in parameters.items()}
        path = Path(args.output) / f"density-{cap}"
        write_asset(path, selected, rest, faces, clips, contact_errors)
        densities.append({"requested": cap, "count": count, "manifest": f"density-{cap}/manifest.json"})
    (Path(args.output) / "densities.json").write_text(json.dumps(densities, indent=2) + "\n")
    print(json.dumps({"export": args.output, "count": len(parameters["means"]), "densities": densities}), flush=True)


if __name__ == "__main__":
    main()
