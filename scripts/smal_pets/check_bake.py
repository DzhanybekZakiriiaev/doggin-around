"""Bake and inspect the canonical rig before expensive appearance training."""

import argparse
import json
from pathlib import Path
import numpy as np
import trimesh
from model import PetModel
from bake import bake_animations
from export import gait_cadence
from glb import write_animated_glb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bite-source", required=True)
    parser.add_argument("--bite-fit", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    fit = np.load(args.bite_fit)
    pet = PetModel(args.bite_source, args.bite_fit)
    transform = fit["coordinate_transform"]
    scale = np.linalg.norm(transform[:3, 0])
    pet.set_alignment(transform[:3, :3] / scale, scale, transform[:3, 3])
    rest = pet().detach().cpu().numpy()
    faces = pet.faces.cpu().numpy()
    clips, contact_errors = bake_animations(pet)
    floor = float(rest[[1330, 3282, 1521, 3473], 1].min())
    assert max(contact_errors.values()) * 2.6 < 0.013, contact_errors
    for name, clip in clips.items():
        assert clip["minimumPawHeight"] >= floor - 0.005, name
    write_animated_glb(output / "dog-animated.glb", rest, faces, clips, pet)
    for name, clip in clips.items():
        frame = -1 if name == "sit" else len(clip["times"]) // 2
        if name in {"walk", "run", "spin"}:
            frame = len(clip["times"]) // 4
        trimesh.Trimesh(vertices=clip["positions"][frame], faces=faces, process=False).export(output / f"{name}.obj")
    checks = {"status": "baked", "stage": "canonical_preflight", "vertexCount": len(rest), "jointCount": 35, "contact_max_errors": contact_errors, "contact_max_viewer_error": max(contact_errors.values()) * 2.6, "rest_paw_floor": floor, "gaitCadence": gait_cadence(rest, clips), "minimum_paw_heights": {name: clip["minimumPawHeight"] for name, clip in clips.items()}, "clip_durations": {name: clip["duration"] for name, clip in clips.items()}, "loop_seams": {name: float(np.abs(clip["positions"][0] - clip["positions"][-1]).max()) for name, clip in clips.items() if name != "sit"}}
    (output / "bake-check.json").write_text(json.dumps(checks, indent=2) + "\n")
    print(json.dumps(checks), flush=True)


if __name__ == "__main__":
    main()
