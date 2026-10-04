"""Bake dog actions onto a reviewed quadruped rig."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

parser = argparse.ArgumentParser()
parser.add_argument("input")
parser.add_argument("profile")
parser.add_argument("output")
parser.add_argument("blend")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
profile = json.loads(Path(args.profile).read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(args.input).resolve()))
rig = bpy.data.objects[profile["armature"]]
scene = bpy.context.scene
scene.render.fps = 30
rig.animation_data_create()
for track in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(track)
forward = Vector(profile["forward"])
up = Vector(profile.get("up", [0, 0, 1])).normalized()
side = forward.cross(up).normalized()


def pose(name, axis, angle):
    bone = rig.pose.bones[name]
    local_axis = bone.bone.matrix_local.to_quaternion().inverted() @ axis
    bone.rotation_mode = "QUATERNION"
    bone.rotation_quaternion = Quaternion(local_axis, angle)


def add_pose(name, axis, angle):
    bone = rig.pose.bones[name]
    local_axis = bone.bone.matrix_local.to_quaternion().inverted() @ axis
    bone.rotation_quaternion = bone.rotation_quaternion @ Quaternion(local_axis, angle)


def move(name, offset):
    bone = rig.pose.bones[name]
    bone.location = bone.bone.matrix_local.to_quaternion().inverted() @ offset


def smooth(start, end, t):
    x = max(0.0, min(1.0, (t - start) / (end - start)))
    return x * x * x * (10.0 + x * (-15.0 + 6.0 * x))


def window(start, rise, fall, end, t):
    return smooth(start, rise, t) * (1.0 - smooth(fall, end, t))


def jump_arc(t):
    phase = max(0.0, min(1.0, (t - 0.22) / 0.60))
    return max(0.0, math.sin(math.pi * phase)) ** 1.15


def gait(t, running=False):
    phases = {
        "front_positive_x": 0.0,
        "back_negative_x": 0.25,
        "front_negative_x": 0.5,
        "back_positive_x": 0.75,
    }
    for leg in profile["legs"]:
        offset = phases[leg["name"]]
        if running:
            offset = 0.0 if leg["name"].startswith("front") else 0.5
            if leg["name"].endswith("negative_x"):
                offset += 0.06
        phase = (t + offset) * math.tau * (2 if running else 1)
        swing = math.sin(phase)
        pose(leg["upper"], side, swing * (0.48 if running else 0.28))
        if leg.get("lower"):
            pose(leg["lower"], side, max(0.0, -swing) * (0.55 if running else 0.32))
        if leg.get("foot"):
            pose(leg["foot"], side, -swing * (0.15 if running else 0.10))
    bob = (0.045 if running else 0.012) * (1.0 - math.cos(t * math.tau * (4 if running else 2)))
    move(profile["root"], up * bob)
    pose(profile["head"], side, math.sin(t * math.tau * (4 if running else 2)) * 0.035)


def turn_gait(t):
    amount = smooth(0.0, 0.12, t) * (1.0 - smooth(0.84, 1.0, t))
    phases = {
        "front_positive_x": 0.0,
        "back_negative_x": 0.25,
        "front_negative_x": 0.5,
        "back_positive_x": 0.75,
    }
    for leg in profile["legs"]:
        swing = math.sin((t * 3.0 + phases[leg["name"]]) * math.tau)
        reach = 0.38 if leg["name"].endswith("positive_x") else 0.18
        pose(leg["upper"], side, amount * swing * reach)
        if leg.get("lower"):
            pose(leg["lower"], side, amount * max(0.0, -swing) ** 2 * 0.38)
        if leg.get("foot"):
            pose(leg["foot"], side, -amount * swing * 0.09)
    return amount * 0.014 * (1.0 - math.cos(t * math.tau * 6.0))


def secondary_motion(clip, t):
    looping = clip in {"idle", "walk", "run", "sniff", "wag"}
    envelope = 1.0 if looping else window(0.0, 0.12, 0.86, 1.0, t)
    breath = (1.0 - math.cos(t * math.tau)) * 0.5
    if clip in {"idle", "sniff", "wag"}:
        for index, name in enumerate(profile["torso"]):
            add_pose(name, side, (0.004 if index < 2 else -0.004) * breath)
        if profile.get("neck"):
            add_pose(profile["neck"], side, math.sin(t * math.tau) * 0.012)
    if profile.get("tail"):
        tail = profile.get("tail_chain", [profile["tail"]])
        frequency = 5 if clip in {"wag", "bark", "playbow"} else 2
        amplitude = 0.48 if clip in {"wag", "bark", "playbow"} else 0.14
        weights = [0.48 ** index for index in range(len(tail))]
        for index, (name, weight) in enumerate(zip(tail, weights)):
            lag = index * 0.32
            wave = math.sin(t * math.tau * frequency - lag) + math.sin(lag)
            pose(name, up, envelope * amplitude * weight / sum(weights) * wave)
    for index, name in enumerate(profile.get("ears", [])):
        lag = 0.4 + index * 0.18
        wave = math.sin(t * math.tau * 2 - lag) + math.sin(lag)
        amplitude = 0.055 if clip == "sniff" else 0.035 if clip == "jump" else 0.018
        pose(name, side, envelope * wave * amplitude)


def plant_contact(leg, strength=1.0, target_offset=None):
    if not leg.get("contact"):
        return
    bones = [rig.pose.bones[leg[key]] for key in ("upper", "lower", "foot") if leg.get(key)]
    bases = [bone.rotation_quaternion.copy() for bone in bones]
    axes = [bone.bone.matrix_local.to_quaternion().inverted() @ side for bone in bones]
    spread_axis = bones[0].bone.matrix_local.to_quaternion().inverted() @ forward
    target = rig.data.bones[leg["contact"]].head_local.copy()
    if target_offset is not None:
        target += target_offset
    goal = target

    def location(offsets):
        for bone, base, axis, angle in zip(bones, bases, axes, offsets):
            bone.rotation_quaternion = base @ Quaternion(axis, angle)
        bones[0].rotation_quaternion = bones[0].rotation_quaternion @ Quaternion(spread_axis, offsets[-1])
        bpy.context.view_layer.update()
        point = rig.pose.bones[leg["contact"]].matrix.translation
        return point.copy()

    offsets = [0.0] * (len(bones) + 1)
    for _ in range(30):
        point = location(offsets)
        error = goal - point
        if error.length < 0.001:
            break
        epsilon = 0.005
        derivatives = []
        for index in range(len(offsets)):
            probe = offsets.copy()
            probe[index] += epsilon
            derivatives.append((location(probe) - point) / epsilon)
        damping = 0.0003
        metric = Matrix(tuple(
            tuple(sum(value[row] * value[column] for value in derivatives)
                  + (damping if row == column else 0.0) for column in range(3))
            for row in range(3)
        ))
        correction = metric.inverted() @ error
        for index, derivative in enumerate(derivatives):
            step = derivative.dot(correction)
            limit = 0.25 if index == len(bones) else 2.2
            offsets[index] = max(-limit, min(limit, offsets[index] + max(-0.3, min(0.3, step))))
    location([offset * strength for offset in offsets])


clips = [
    ("idle", 90),
    ("walk", 36),
    ("run", 30),
    ("sit", 75),
    ("jump", 72),
    ("bark", 72),
    ("paw", 90),
    ("spin", 120),
    ("playbow", 75),
    ("sniff", 90),
    ("wag", 60),
]

for clip, length in clips:
    action = bpy.data.actions.new(clip)
    rig.animation_data.action = action
    scene.frame_start = 1
    scene.frame_end = length + 1
    for frame in range(1, length + 2):
        scene.frame_set(frame)
        t = (frame - 1) / length
        for bone in rig.pose.bones:
            bone.rotation_mode = "QUATERNION"
            bone.rotation_quaternion = Quaternion()
            bone.location = (0, 0, 0)
        if clip == "idle":
            pose(profile["head"], side, math.sin(t * math.tau) * 0.035)
        elif clip == "walk":
            gait(t)
        elif clip == "run":
            gait(t, running=True)
        elif clip == "sit":
            settle = smooth(0.0, 0.55, t)
            move(profile["root"], (up * -0.28 - forward * 0.05) * settle)
            pose(profile["torso"][0], side, 0.58 * settle)
            for leg in profile["legs"]:
                if leg["name"].startswith("back"):
                    pose(leg["upper"], side, 1.00 * settle)
                    pose(leg["lower"], side, -1.50 * settle)
            pose(profile["head"], side, -0.38 * settle)
        elif clip == "jump":
            crouch = window(0.0, 0.11, 0.19, 0.27, t) + window(0.75, 0.84, 0.91, 1.0, t)
            flight = jump_arc(t)
            tuck = window(0.19, 0.37, 0.60, 0.80, t)
            move(profile["root"], up * (0.34 * flight - 0.04 * crouch))
            for leg in profile["legs"]:
                front = leg["name"].startswith("front")
                pose(leg["upper"], side, (-0.46 if front else 0.32) * tuck)
                pose(leg["lower"], side, 0.36 * crouch + (0.78 if front else 0.62) * tuck)
            pose(profile["head"], side, 0.13 * flight)
        elif clip == "bark":
            bark = max(0.0, math.sin(t * math.tau * 3)) ** 2
            pose(profile["head"], side, -0.23 * bark)
            if profile.get("jaw"):
                pose(profile["jaw"], side, -0.55 * bark)
            move(profile["root"], forward * (-0.025 * bark))
            if profile.get("neck"):
                pose(profile["neck"], side, -0.07 * bark)
        elif clip == "paw":
            raise_paw = window(0.05, 0.25, 0.72, 0.92, t)
            wave = math.sin(t * math.tau * 3) * raise_paw
            chosen = next(leg for leg in profile["legs"] if leg["name"] == "front_positive_x")
            pose(chosen["upper"], side, -1.20 * raise_paw)
            pose(chosen["lower"], side, 0.90 * raise_paw)
            pose(chosen["foot"], side, 0.28 * wave)
            pose(profile["head"], up, 0.10 * raise_paw)
            move(profile["root"], (-side * 0.018 - up * 0.008) * raise_paw)
        elif clip == "playbow":
            bow = window(0.05, 0.28, 0.72, 0.96, t)
            move(profile["root"], up * (-0.10 * bow))
            for name in profile["torso"]:
                pose(name, side, -0.23 * bow / len(profile["torso"]))
            for leg in profile["legs"]:
                if leg["name"].startswith("front"):
                    pose(leg["lower"], side, 0.56 * bow)
                else:
                    pose(leg["upper"], side, -0.16 * bow)
            pose(profile["head"], side, -0.16 * bow)
        elif clip == "sniff":
            sniff = math.sin(t * math.tau * 2)
            move(profile["root"], up * -0.10)
            for name in profile["torso"][-2:]:
                pose(name, side, -0.17)
            pose(profile["head"], side, -0.48 + 0.05 * sniff)
            if profile.get("neck"):
                pose(profile["neck"], side, -0.82)
                add_pose(profile["neck"], up, 0.06 * math.sin(t * math.tau))
            if profile.get("jaw"):
                pose(profile["jaw"], side, -0.28 - 0.07 * sniff)
        elif clip == "wag":
            pose(profile["head"], side, 0.04 * math.sin(t * math.tau))
        secondary_motion(clip, t)
        if clip == "spin":
            bob = turn_gait(t)
            turn = smooth(0.0, 1.0, t) * math.tau
            pose(profile["root"], up, turn)
            root = rig.pose.bones[profile["root"]]
            pivot = Vector(profile.get("spin_pivot", root.bone.head_local))
            offset = pivot - root.bone.head_local
            displacement = offset - Quaternion(up, turn) @ offset
            move(profile["root"], displacement + up * bob)
        if clip in {"sit", "playbow", "sniff"}:
            for leg in profile["legs"]:
                offset = forward * 0.14 * settle if clip == "sit" and leg["name"].startswith("back") else None
                plant_contact(leg, target_offset=offset)
        elif clip == "jump" and crouch > 0:
            for leg in profile["legs"]:
                plant_contact(leg, min(1.0, crouch))
        elif clip == "paw":
            for leg in profile["legs"]:
                if leg["name"] != "front_positive_x":
                    plant_contact(leg)
        for bone in rig.pose.bones:
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
            bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 1, action)
    track.mute = True
    rig.animation_data.action = None
scene.frame_start = 1
scene.frame_end = 121
scene.frame_set(1)
for track in rig.animation_data.nla_tracks:
    track.mute = track.name != "idle"
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
Path(args.blend).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.blend).resolve()))
for track in rig.animation_data.nla_tracks:
    track.mute = False
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
for obj in scene.objects:
    if obj.type == "MESH" and any(modifier.type == "ARMATURE" and modifier.object == rig
                                  for modifier in obj.modifiers):
        obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(Path(args.output).resolve()), export_format="GLB",
                          use_selection=True,
                          export_animations=True, export_animation_mode="NLA_TRACKS",
                          export_force_sampling=True, export_anim_slide_to_zero=True,
                          export_frame_range=False)
print("DOG_ANIMATIONS_EXPORTED")
