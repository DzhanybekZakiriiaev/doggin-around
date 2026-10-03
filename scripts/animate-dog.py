"""Bake three motion clips onto a reviewed quadruped rig."""
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


for clip, length in [("idle", 90), ("walk", 36), ("spin", 120)]:
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
        else:
            cycles = 1 if clip == "walk" else 4
            for leg in profile["legs"]:
                phase = t * math.tau * cycles + leg["phase"] * math.pi
                pose(leg["upper"], side, math.sin(phase) * 0.30)
                if leg.get("lower"):
                    pose(leg["lower"], side, max(0, -math.sin(phase)) * 0.32)
                if leg.get("foot"):
                    pose(leg["foot"], side, -math.sin(phase) * 0.10)
            pose(profile["head"], side, math.sin(t * math.tau * cycles * 2) * 0.02)
        if profile.get("tail"):
            pose(profile["tail"], up, math.sin(t * math.tau * (2 if clip == "idle" else 4)) * 0.13)
        if clip == "spin":
            pose(profile["root"], up, t * math.tau)
            root = rig.pose.bones[profile["root"]]
            pivot = Vector(profile.get("spin_pivot", root.bone.head_local))
            offset = pivot - root.bone.head_local
            displacement = offset - Quaternion(up, t * math.tau) @ offset
            root.location = root.bone.matrix_local.to_quaternion().inverted() @ displacement
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
