"""Bake the Blender animator controls to the original deform skeleton."""

import argparse
import sys
from pathlib import Path

import bpy


parser = argparse.ArgumentParser()
parser.add_argument('blend', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()))
rig = bpy.data.objects['Armature']
controls = bpy.data.objects['Dog Controls']
if bpy.context.object and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for track in controls.animation_data.nla_tracks:
    track.is_solo = False
    track.mute = True
rig.animation_data.action = None
for track in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(track)

for track in controls.animation_data.nla_tracks:
    strip = track.strips[0]
    controls.animation_data.action = strip.action
    controls.animation_data.action_slot = strip.action_slot
    poses = []
    start, end = round(strip.action_frame_start), round(strip.action_frame_end)
    for frame in range(start, end + 1):
        bpy.context.scene.frame_set(frame)
        pose = {}
        for bone in rig.pose.bones:
            options = {} if not bone.parent else {
                'parent_matrix': bone.parent.matrix,
                'parent_matrix_local': bone.parent.bone.matrix_local,
            }
            pose[bone.name] = bone.bone.convert_local_to_pose(
                bone.matrix, bone.bone.matrix_local, invert=True, **options)
        poses.append(pose)
    action = bpy.data.actions.new('Baked_' + track.name)
    rig.animation_data.action = action
    previous = {}
    for frame, pose in enumerate(poses, 1):
        for name, matrix in pose.items():
            bone = rig.pose.bones[name]
            bone.matrix_basis = matrix
            if name in previous and bone.rotation_quaternion.dot(previous[name]) < 0:
                bone.rotation_quaternion.negate()
            previous[name] = bone.rotation_quaternion.copy()
            for path in ('location', 'rotation_quaternion', 'scale'):
                bone.keyframe_insert(data_path=path, frame=frame, group=name)
    bag = action.layers[0].strips[0].channelbag(rig.animation_data.action_slot)
    for curve in bag.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    output_track = rig.animation_data.nla_tracks.new()
    output_track.name = track.name
    output_track.strips.new(track.name, 1, action)
    output_track.mute = True
    rig.animation_data.action = None

controls.animation_data.action = None
for bone in rig.pose.bones:
    for constraint in bone.constraints:
        constraint.mute = True
for track in rig.animation_data.nla_tracks:
    track.mute = False
rig.hide_set(False)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH' and any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers):
        obj.select_set(True)
args.output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format='GLB', use_selection=True,
                         export_animations=True, export_animation_mode='NLA_TRACKS',
                         export_force_sampling=True, export_anim_slide_to_zero=True, export_frame_range=False)
print('CONTROLS_EXPORTED', args.output)
