"""Bake dog actions onto a reviewed quadruped rig."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

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


def move(name, offset):
    bone = rig.pose.bones[name]
    bone.location = bone.bone.matrix_local.to_quaternion().inverted() @ offset


def smooth(start, end, t):
    x = max(0.0, min(1.0, (t - start) / (end - start)))
    return x * x * (3.0 - 2.0 * x)


def window(start, rise, fall, end, t):
    return smooth(start, rise, t) * (1.0 - smooth(fall, end, t))


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


def plant_contact(leg):
    if not leg.get("contact"):
        return
    bones = [rig.pose.bones[leg["upper"]], rig.pose.bones[leg["lower"]]]
    bases = [bone.rotation_quaternion.copy() for bone in bones]
    axes = [bone.bone.matrix_local.to_quaternion().inverted() @ side for bone in bones]
    target = rig.data.bones[leg["contact"]].head_local
    goal = Vector((target.dot(forward), target.dot(up)))

    def location(offsets):
        for bone, base, axis, angle in zip(bones, bases, axes, offsets):
            bone.rotation_quaternion = base @ Quaternion(axis, angle)
        bpy.context.view_layer.update()
        point = rig.pose.bones[leg["contact"]].matrix.translation
        return Vector((point.dot(forward), point.dot(up)))

    offsets = [0.0, 0.0]
    for _ in range(7):
        point = location(offsets)
        error = goal - point
        if error.length < 0.003:
            break
        epsilon = 0.005
        first = (location([offsets[0] + epsilon, offsets[1]]) - point) / epsilon
        second = (location([offsets[0], offsets[1] + epsilon]) - point) / epsilon
        damping = 0.002
        a = first.dot(first) + damping
        b = first.dot(second)
        d = second.dot(second) + damping
        c = first.dot(error)
        e = second.dot(error)
        determinant = a * d - b * b
        offsets[0] += max(-0.25, min(0.25, (c * d - b * e) / determinant))
        offsets[1] += max(-0.25, min(0.25, (a * e - b * c) / determinant))
        offsets = [max(-1.3, min(1.3, value)) for value in offsets]
    location(offsets)


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
            move(profile["root"], up * (-0.16 * settle))
            pose(profile["torso"][0], side, 0.35 * settle)
            for leg in profile["legs"]:
                if leg["name"].startswith("back"):
                    pose(leg["upper"], side, 0.48 * settle)
                    pose(leg["lower"], side, -0.78 * settle)
            pose(profile["head"], side, -0.16 * settle)
        elif clip == "jump":
            crouch = window(0.0, 0.12, 0.19, 0.27, t) + window(0.77, 0.85, 0.92, 1.0, t)
            flight = window(0.22, 0.44, 0.58, 0.82, t)
            move(profile["root"], up * (0.26 * flight - 0.06 * crouch))
            for leg in profile["legs"]:
                pose(leg["upper"], side, (-0.30 if leg["name"].startswith("front") else 0.38) * flight)
                pose(leg["lower"], side, 0.40 * crouch + 0.48 * flight)
            pose(profile["head"], side, 0.10 * flight)
        elif clip == "bark":
            bark = max(0.0, math.sin(t * math.tau * 3)) ** 2
            pose(profile["head"], side, -0.23 * bark)
            if profile.get("jaw"):
                pose(profile["jaw"], side, 0.55 * bark)
            move(profile["root"], forward * (-0.025 * bark))
        elif clip == "paw":
            raise_paw = window(0.05, 0.25, 0.72, 0.92, t)
            wave = math.sin(t * math.tau * 3) * raise_paw
            chosen = next(leg for leg in profile["legs"] if leg["name"] == "front_positive_x")
            pose(chosen["upper"], side, -1.20 * raise_paw)
            pose(chosen["lower"], side, 0.90 * raise_paw)
            pose(chosen["foot"], side, 0.28 * wave)
            pose(profile["head"], up, 0.10 * raise_paw)
        elif clip == "playbow":
            bow = window(0.05, 0.28, 0.72, 0.96, t)
            move(profile["root"], up * (-0.10 * bow))
            pose(profile["torso"][-1], side, -0.23 * bow)
            for leg in profile["legs"]:
                if leg["name"].startswith("front"):
                    pose(leg["lower"], side, 0.56 * bow)
                else:
                    pose(leg["upper"], side, -0.16 * bow)
            pose(profile["head"], side, -0.16 * bow)
        elif clip == "sniff":
            pose(profile["head"], side, -0.25 + 0.05 * math.cos(t * math.tau * 2))
            if profile.get("neck"):
                pose(profile["neck"], side, -0.15 + 0.04 * math.sin(t * math.tau))
        elif clip == "wag":
            pose(profile["head"], side, 0.04 * math.sin(t * math.tau))
        if profile.get("tail"):
            speed = 5 if clip in {"wag", "bark", "playbow"} else 2
            amount = 0.46 if clip in {"wag", "bark", "playbow"} else 0.13
            pose(profile["tail"], up, math.sin(t * math.tau * speed) * amount)
        if clip == "spin":
            gait(t, running=True)
            pose(profile["root"], up, t * math.tau)
            root = rig.pose.bones[profile["root"]]
            pivot = Vector(profile.get("spin_pivot", root.bone.head_local))
            offset = pivot - root.bone.head_local
            displacement = offset - Quaternion(up, t * math.tau) @ offset
            move(profile["root"], displacement)
        if clip in {"sit", "playbow"}:
            for leg in profile["legs"]:
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
