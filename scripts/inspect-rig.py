"""Inspect a GLB with Blender before assigning animation joints."""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("input")
parser.add_argument("output")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(args.input).resolve()))
rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
result = {"rigs": [], "meshes": []}
custom_shapes = {bone.custom_shape for rig in rigs for bone in rig.pose.bones if bone.custom_shape}
for rig in rigs:
    bones = []
    for bone in rig.data.bones:
        bones.append({"name": bone.name, "parent": bone.parent.name if bone.parent else None,
                      "head": list(bone.head_local), "tail": list(bone.tail_local),
                      "children": [child.name for child in bone.children]})
    result["rigs"].append({"name": rig.name, "matrix": [list(row) for row in rig.matrix_world], "bones": bones})
for mesh in [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj not in custom_shapes]:
    weights = [sum(group.weight for group in vertex.groups) for vertex in mesh.data.vertices]
    result["meshes"].append({"name": mesh.name, "vertices": len(mesh.data.vertices),
                             "bounds": [list(mesh.matrix_world @ Vector(corner)) for corner in mesh.bound_box],
                             "groups": [group.name for group in mesh.vertex_groups],
                             "materials": [material.name for material in mesh.data.materials],
                             "weight_range": [min(weights), max(weights)],
                             "unweighted_vertices": sum(weight <= 0 for weight in weights),
                             "texture_images": [node.image.name for material in mesh.data.materials
                                                if material.node_tree for node in material.node_tree.nodes
                                                if node.type == "TEX_IMAGE" and node.image]})
Path(args.output).write_text(json.dumps(result, indent=2))
print(json.dumps({"rigs": len(rigs), "bones": [len(rig.data.bones) for rig in rigs]}))
