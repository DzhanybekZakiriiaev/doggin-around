"""Create a small known rig for browser skinning tests."""
import math
from pathlib import Path

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.object.armature_add()
rig = bpy.context.object
rig.name = "TestRig"
bpy.ops.object.mode_set(mode="EDIT")
root = rig.data.edit_bones[0]
root.name = "root"
root.head = (0, 0, 0)
root.tail = (0, 0, 0.8)
tip = rig.data.edit_bones.new("tip")
tip.head = (0, 0, 0.8)
tip.tail = (0, 0, 1.6)
tip.parent = root
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, location=(0, 0, 0.8))
mesh = bpy.context.object
mesh.scale = (0.6, 0.4, 0.8)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
material = bpy.data.materials.new("Warm orange")
material.diffuse_color = (0.7, 0.25, 0.04, 1)
material.use_nodes = True
material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.7, 0.25, 0.04, 1)
mesh.data.materials.append(material)
for name in ("root", "tip"):
    mesh.vertex_groups.new(name=name)
for vertex in mesh.data.vertices:
    weight = min(1, max(0, vertex.co.z / 1.6 + 0.5))
    mesh.vertex_groups["tip"].add([vertex.index], weight, "REPLACE")
    mesh.vertex_groups["root"].add([vertex.index], 1 - weight, "REPLACE")
modifier = mesh.modifiers.new("Skin", "ARMATURE")
modifier.object = rig
mesh.parent = rig
rig.animation_data_create()
for clip, length in [("idle", 30), ("walk", 30), ("spin", 60)]:
    action = bpy.data.actions.new(clip)
    rig.animation_data.action = action
    for frame in range(1, length + 2):
        t = (frame - 1) / length
        for bone in rig.pose.bones:
            bone.rotation_mode = "XYZ"
            bone.rotation_euler = (0, 0, 0)
        if clip == "spin":
            rig.pose.bones["root"].rotation_euler.y = t * math.tau
        else:
            rig.pose.bones["tip"].rotation_euler.z = math.sin(t * math.tau) * (0.08 if clip == "idle" else 0.4)
        for bone in rig.pose.bones:
            bone.keyframe_insert("rotation_euler", frame=frame)
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 1, action)
    track.mute = True
    rig.animation_data.action = None
for track in rig.animation_data.nla_tracks:
    track.mute = False
bpy.context.scene.frame_set(1)
Path("work").mkdir(exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(Path("work/test-rig.glb").resolve()), export_format="GLB",
                          export_animations=True, export_animation_mode="NLA_TRACKS",
                          export_force_sampling=True, export_frame_range=False)
