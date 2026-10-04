"""Bake eleven action profiles with full D-SMAL deformation."""

import math
import numpy as np
import torch
from scipy.spatial.transform import Rotation
from model import axis_angle_matrix

CLIPS = {"idle": 90, "walk": 36, "run": 15, "sit": 75, "jump": 72, "bark": 72, "paw": 90, "spin": 120, "playbow": 75, "sniff": 90, "wag": 60}
LEGS = [(7, 8, 9, 1330), (11, 12, 13, 3282), (17, 18, 19, 1521), (21, 22, 23, 3473)]


def smooth(start, end, value):
    x = np.clip((value - start) / (end - start), 0, 1)
    return x ** 3 * (10 - 15 * x + 6 * x * x)


def window(start, rise, fall, end, value):
    return smooth(start, rise, value) * (1 - smooth(fall, end, value))


def bake_animations(pet, fps=30):
    device = pet.betas.device
    rest = pet().detach().cpu().numpy()
    initial = axis_angle_matrix(pet.pose).detach().cpu().numpy()[0]
    alignment = pet.alignment.detach().cpu().numpy()
    parents = pet.smal.parents
    head = int(parents[32])
    neck = int(parents[head])
    torso = []
    ancestor = int(parents[neck])
    while ancestor > 0:
        torso.append(ancestor)
        ancestor = int(parents[ancestor])
    torso = torso[::-1] or [1, 2, 3]
    forward = rest[1863] - rest[452]
    forward[1] = 0
    forward /= max(np.linalg.norm(forward), 1e-8)
    up = np.array([0.0, 1.0, 0.0])
    side = np.cross(forward, up)
    bases = []
    for joint in range(35):
        parent_rotation = np.eye(3) if joint == 0 else bases[int(parents[joint])]
        bases.append(parent_rotation @ initial[joint])
    local_side = np.array([(alignment @ rotation).T @ side for rotation in bases])
    local_up = np.array([(alignment @ rotation).T @ up for rotation in bases])
    targets = rest[[leg[3] for leg in LEGS]]
    floor_height = float(targets[:, 1].min())

    def joint_pose(rotations, offset):
        world_rotations = []
        for joint in range(35):
            parent_rotation = alignment if joint == 0 else world_rotations[int(parents[joint])]
            world_rotations.append(parent_rotation @ rotations[joint])
        native_joints = pet.smal.J_transformed.detach().cpu().numpy()[0]
        joint_positions = native_joints @ alignment.T * float(pet.log_scale.detach().exp()) + pet.translation.detach().cpu().numpy() + offset
        local_positions = joint_positions.copy()
        local_rotations = rotations.copy()
        local_rotations[0] = world_rotations[0]
        for joint in range(1, 35):
            parent = int(parents[joint])
            local_positions[joint] = world_rotations[parent].T @ (joint_positions[joint] - joint_positions[parent])
        return local_positions.astype(np.float32), Rotation.from_matrix(local_rotations).as_quat().astype(np.float32)

    rest_joint_translations, rest_joint_quaternions = joint_pose(initial, np.zeros(3))
    pet.rest_joint_translations = rest_joint_translations
    pet.rest_joint_quaternions = rest_joint_quaternions
    clips = {}
    contact_errors = {}
    for name, length in CLIPS.items():
        frames = []
        joint_translations = []
        joint_quaternions = []
        errors = []
        for frame in range(length + 1):
            t = frame / length
            rotations = initial.copy()
            translation = np.zeros(3)

            def rotate(joint, angle, axis=None):
                vector = local_side[joint] if axis is None else axis[joint]
                rotations[joint] = rotations[joint] @ Rotation.from_rotvec(vector * angle).as_matrix()

            if name in ("walk", "run", "spin"):
                running = name == "run"
                amount = smooth(0, 0.12, t) * (1 - smooth(0.84, 1, t)) if name == "spin" else 1
                offsets = [0, 0.06, 0.5, 0.56] if running else [0, 0.5, 0.75, 0.25]
                for index, (upper, lower, foot, _) in enumerate(LEGS):
                    swing = math.sin(2 * math.pi * (t * (3 if name == "spin" else 1) + offsets[index]))
                    amplitude = 0.48 if running else 0.28
                    if name == "spin":
                        amplitude = 0.38 if index % 2 == 0 else 0.18
                    rotate(upper, amount * swing * amplitude)
                    rotate(lower, amount * max(0, -swing) * (0.55 if running else 0.32))
                    rotate(foot, -amount * swing * (0.15 if running else 0.10))
                translation += up * (0.045 if running else 0.012) * (1 - math.cos(4 * math.pi * t))
                rotate(head, math.sin(4 * math.pi * t) * 0.035)
                if name == "spin":
                    turn = smooth(0, 1, t) * 2 * math.pi
                    rotate(0, turn, local_up)
                    center = pet.translation.detach().cpu().numpy()
                    translation += Rotation.from_rotvec(up * turn).apply(center) - center
            elif name == "idle":
                rotate(head, math.sin(2 * math.pi * t) * 0.035)
            elif name == "sit":
                settle = smooth(0, 0.55, t)
                translation += (-0.28 * up - 0.05 * forward) * settle
                rotate(torso[0], 0.58 * settle)
                for upper, lower, _, _ in LEGS[2:]:
                    rotate(upper, 1.0 * settle)
                    rotate(lower, -1.5 * settle)
                rotate(head, -0.38 * settle)
            elif name == "jump":
                crouch = window(0, 0.11, 0.19, 0.27, t) + window(0.75, 0.84, 0.91, 1, t)
                flight = max(0, math.sin(math.pi * np.clip((t - 0.22) / 0.60, 0, 1))) ** 1.15
                tuck = window(0.19, 0.37, 0.60, 0.80, t)
                translation += up * (0.34 * flight - 0.04 * crouch)
                for index, (upper, lower, _, _) in enumerate(LEGS):
                    rotate(upper, (-0.46 if index < 2 else 0.32) * tuck)
                    rotate(lower, 0.36 * crouch + (0.78 if index < 2 else 0.62) * tuck)
                rotate(head, 0.13 * flight)
            elif name == "bark":
                bark = max(0, math.sin(6 * math.pi * t)) ** 2
                rotate(head, -0.23 * bark)
                rotate(32, -0.55 * bark)
                rotate(neck, -0.07 * bark)
                translation += forward * -0.025 * bark
            elif name == "paw":
                lift = window(0.05, 0.25, 0.72, 0.92, t)
                rotate(7, 1.20 * lift)
                rotate(8, -0.90 * lift)
                rotate(9, 0.28 * math.sin(6 * math.pi * t) * lift)
                rotate(head, 0.10 * lift, local_up)
                translation += (-side * 0.018 - up * 0.008) * lift
            elif name == "playbow":
                bow = window(0.05, 0.28, 0.72, 0.96, t)
                translation += up * -0.10 * bow
                for joint in torso:
                    rotate(joint, -0.23 * bow / len(torso))
                for index, (upper, lower, _, _) in enumerate(LEGS):
                    rotate(lower if index < 2 else upper, (0.56 if index < 2 else -0.16) * bow)
                rotate(head, -0.16 * bow)
            elif name == "sniff":
                translation += up * -0.07
                for joint in torso[-2:]:
                    rotate(joint, -0.12)
                rotate(head, -0.38 + 0.05 * math.sin(4 * math.pi * t))
                rotate(neck, -0.62)
                rotate(neck, 0.06 * math.sin(2 * math.pi * t), local_up)
                rotate(32, -0.28 - 0.07 * math.sin(4 * math.pi * t))
            elif name == "wag":
                rotate(head, 0.04 * math.sin(2 * math.pi * t))
            looping = name in {"idle", "walk", "run", "sniff", "wag"}
            envelope = 1 if looping else window(0, 0.12, 0.86, 1, t)
            breath = (1 - math.cos(2 * math.pi * t)) * 0.5
            if name in {"idle", "sniff", "wag"}:
                for index, joint in enumerate(torso):
                    rotate(joint, (0.004 if index < 2 else -0.004) * breath)
                rotate(neck, math.sin(2 * math.pi * t) * 0.012)
            tail_weights = np.array([0.48 ** index for index in range(7)])
            tail_weights /= tail_weights.sum()
            frequency = 5 if name in {"wag", "bark", "playbow"} else 2
            amplitude = 0.48 if frequency == 5 else 0.14
            for index, joint in enumerate(range(25, 32)):
                lag = index * 0.32
                rotate(joint, envelope * amplitude * tail_weights[index] * (math.sin(2 * math.pi * frequency * t - lag) + math.sin(lag)), local_up)
            for index, joint in enumerate((33, 34)):
                lag = 0.4 + index * 0.18
                rotate(joint, envelope * (math.sin(4 * math.pi * t - lag) + math.sin(lag)) * (0.035 if name == "jump" else 0.018))
            pose = torch.as_tensor(Rotation.from_matrix(rotations).as_rotvec(), device=device, dtype=torch.float32)[None]
            offset = torch.as_tensor(translation, device=device, dtype=torch.float32)
            contact = list(range(4)) if name in {"sit", "playbow", "sniff"} or name == "jump" and flight < 1e-5 else [1, 2, 3] if name == "paw" else []
            if contact:
                joint_ids = [joint for index in contact for joint in LEGS[index][:3]]
                point_ids = [LEGS[index][3] for index in contact]
                goal = targets[contact].copy()
                if name == "sit":
                    for index, leg in enumerate(contact):
                        if leg >= 2:
                            goal[index] += forward * 0.14 * settle
                goal = torch.as_tensor(goal, device=device, dtype=torch.float32)
                correction = torch.zeros((len(joint_ids), 3), device=device, requires_grad=True)
                optimizer = torch.optim.LBFGS([correction], lr=1.0, max_iter=40, history_size=10, line_search_fn="strong_wolfe", tolerance_grad=1e-8, tolerance_change=1e-10)
                mask = torch.nn.functional.one_hot(torch.as_tensor(joint_ids, device=device), 35).float()
                def closure():
                    optimizer.zero_grad()
                    pet.zero_grad(set_to_none=True)
                    corrected = pose + (mask.T @ correction)[None]
                    planted = pet(corrected, offset)[point_ids]
                    loss = (planted - goal).square().mean() + 0.000001 * correction.square().mean()
                    loss.backward()
                    return loss
                optimizer.step(closure)
                pose = (pose + (mask.T @ correction.detach())[None]).detach()
                pet.zero_grad(set_to_none=True)
            with torch.no_grad():
                positions = pet(pose, offset).cpu().numpy().astype(np.float32)
                if name in {"walk", "run", "spin", "jump"}:
                    lift = max(0, floor_height - float(positions[[leg[3] for leg in LEGS], 1].min()))
                    translation += up * lift
                    offset = torch.as_tensor(translation, device=device, dtype=torch.float32)
                    positions = pet(pose, offset).cpu().numpy().astype(np.float32)
                final_rotations = axis_angle_matrix(pose).cpu().numpy()[0]
            frames.append(positions)
            translations, quaternions = joint_pose(final_rotations, translation)
            joint_translations.append(translations)
            joint_quaternions.append(quaternions)
            if contact:
                errors.append(float(np.linalg.norm(positions[point_ids] - goal.cpu().numpy(), axis=1).max()))
        frames = np.stack(frames)
        assert np.isfinite(frames).all(), name
        if name in {"idle", "walk", "run", "wag", "spin", "jump", "bark", "paw", "playbow"}:
            assert np.max(np.abs(frames[0] - frames[-1])) < 1e-4, name
        clips[name] = {"duration": length / fps, "times": np.arange(length + 1, dtype=np.float32) / fps, "positions": frames, "jointTranslations": np.stack(joint_translations), "jointQuaternions": np.stack(joint_quaternions), "minimumPawHeight": float(frames[:, [leg[3] for leg in LEGS], 1].min())}
        contact_errors[name] = max(errors, default=0)
        print(f"Baked {name} with {len(frames)} frames", flush=True)
    return clips, contact_errors
