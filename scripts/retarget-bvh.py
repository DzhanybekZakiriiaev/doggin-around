"""Retarget a Labrador BVH sample onto the reviewed Huawei dog rig."""

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


JOINTS = {
    "joint_18": "b_Hips",
    "joint_17": "b_Spine",
    "joint_25": "b_Spine1",
    "joint_24": "b_Spine2",
    "joint_23": "b_Spine3",
    "joint_22": "b__Neck",
    "joint_14": "b_Head",
    "joint_15": "b_Tail001",
    "joint_16": "b_Tail003",
    "joint_19": "b_Tail006",
    "joint_26": "b_Tail008",
    "joint_13": "b_LeftClav",
    "joint_5": "b_LeftArm",
    "joint_7": "b_LeftForeArm",
    "joint_8": "b_LeftHand",
    "joint_9": "b__LeftFinger",
    "joint_27": "b_RightClav",
    "joint_31": "b_RightArm",
    "joint_35": "b_RightForeArm",
    "joint_36": "b_RightHand",
    "joint_37": "b_RightFinger",
    "joint_12": "b_LeftLegUpper",
    "joint_10": "b_LeftLeg",
    "joint_11": "b_LeftLeg1",
    "joint_4": "b_LeftAnkle",
    "joint_3": "b_LeftToe",
    "joint_28": "b_RightLegUpper",
    "joint_30": "b_RightLeg",
    "joint_32": "b_RightLeg1",
    "joint_33": "b_RightAnkle",
    "joint_38": "b_RightToe",
}


def alignment(source, reference_frame):
    bpy.context.scene.frame_set(reference_frame)
    hips = source.pose.bones["b_Hips"].matrix.translation
    head = source.pose.bones["b_Head"].matrix.translation
    direction = (head - hips).copy()
    direction.z = 0
    if direction.length < 1e-5:
        raise ValueError("Source dog heading cannot be determined")
    return direction.normalized().rotation_difference(Vector((0, 1, 0)))


def sample_source(source, first, last, step):
    samples = []
    for frame in range(first, last + 1, step):
        bpy.context.scene.frame_set(frame)
        samples.append({
            "rotation": {
                source_name: source.pose.bones[source_name].matrix.to_quaternion().copy()
                for source_name in set(JOINTS.values())
            },
            "hip": source.pose.bones["b_Hips"].matrix.translation.copy(),
        })
    return samples


def bake(target, samples, align, clip, scale, include_travel, loop, loop_fade,
         contact_floor, replace_track):
    if replace_track:
        target.animation_data_create()
        target.animation_data.action = None
        for track in list(target.animation_data.nla_tracks):
            if track.name == replace_track:
                target.animation_data.nla_tracks.remove(track)
            else:
                track.mute = True
    else:
        target.animation_data_clear()
        target.animation_data_create()
    for bone in target.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = Quaternion()
        bone.location = (0, 0, 0)

    reference = samples[0]
    action = bpy.data.actions.new(clip)
    target.animation_data.action = action
    rig_bones = list(target.data.bones)
    keyed_poses = []
    if not all(name in target.pose.bones for name in JOINTS):
        raise ValueError("Target is not the reviewed 41-bone Huawei rig")

    for frame, sample in enumerate(samples, start=1):
        world_rotations = {}
        frame_pose = {}
        hip_stabilizer = reference["rotation"]["b_Hips"] @ sample["rotation"]["b_Hips"].inverted()
        for bone in rig_bones:
            rest = bone.matrix_local.to_quaternion()
            if bone.parent:
                parent_rest = bone.parent.matrix_local.to_quaternion()
                parent_world = world_rotations[bone.parent.name]
            else:
                parent_rest = Quaternion()
                parent_world = Quaternion()

            source_name = JOINTS.get(bone.name)
            if source_name:
                stabilized = hip_stabilizer @ sample["rotation"][source_name]
                delta = stabilized @ reference["rotation"][source_name].inverted()
                desired = align @ delta @ align.inverted() @ rest
                if bone.parent:
                    basis = rest.inverted() @ parent_rest @ parent_world.inverted() @ desired
                else:
                    basis = rest.inverted() @ desired
            else:
                basis = Quaternion()
                desired = parent_world @ parent_rest.inverted() @ rest

            pose_bone = target.pose.bones[bone.name]
            pose_bone.rotation_quaternion = basis.normalized()
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
            frame_pose[bone.name] = pose_bone.rotation_quaternion.copy()
            world_rotations[bone.name] = desired.normalized()

        travel = align @ (sample["hip"] - reference["hip"])
        if not include_travel:
            travel.x = 0
            travel.y = 0
        root = target.pose.bones["joint_18"]
        root_basis = root.bone.matrix_local.to_3x3().inverted()
        root.location = root_basis @ (travel * scale)
        root.keyframe_insert(data_path="location", frame=frame, group=root.name)
        keyed_poses.append((frame_pose, root.location.copy()))

    if loop and len(samples) >= 8:
        fade = min(loop_fade, len(samples) // 4)
        first_pose, first_root = keyed_poses[0]
        for index in range(len(samples) - fade, len(samples)):
            factor = (index - (len(samples) - fade) + 1) / fade
            frame_pose, root_location = keyed_poses[index]
            frame = index + 1
            for bone in target.pose.bones:
                bone.rotation_quaternion = frame_pose[bone.name].slerp(first_pose[bone.name], factor)
                bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
            root = target.pose.bones["joint_18"]
            root.location = root_location.lerp(first_root, factor)
            root.keyframe_insert(data_path="location", frame=frame, group=root.name)

    if contact_floor:
        feet = ("joint_9", "joint_37", "joint_3", "joint_38")
        floor = min(target.data.bones[name].head_local.z for name in feet)
        for frame in range(1, len(samples) + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            minimum = min(target.pose.bones[name].matrix.translation.z for name in feet)
            root = target.pose.bones["joint_18"]
            root_basis = root.bone.matrix_local.to_3x3().inverted()
            root.location = root.location + root_basis @ Vector((0, 0, floor - minimum))
            root.keyframe_insert(data_path="location", frame=frame, group=root.name)

    track = target.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 1, action)
    track.mute = True
    target.animation_data.action = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model")
    parser.add_argument("bvh")
    parser.add_argument("output")
    parser.add_argument("blend")
    parser.add_argument("--clip", default="walk_dataset")
    parser.add_argument("--first", type=int, default=1)
    parser.add_argument("--last", type=int, default=241)
    parser.add_argument("--step", type=int, default=4)
    parser.add_argument("--scale", type=float, default=0.009)
    parser.add_argument("--travel", action="store_true")
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--loop-fade", type=int, default=6)
    parser.add_argument("--contact-floor", action="store_true")
    parser.add_argument("--replace-track")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if args.step < 1 or args.first < 1 or args.last < args.first:
        parser.error("Invalid source frame range")
    if args.scale <= 0 or not math.isfinite(args.scale):
        parser.error("Scale must be positive and finite")
    if args.loop_fade < 1:
        parser.error("Loop fade must be positive")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    model = Path(args.model).resolve()
    if model.suffix == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(model))
    else:
        bpy.ops.import_scene.gltf(filepath=str(model))
    target = bpy.data.objects["Armature"]
    existing_rigs = {obj.name for obj in bpy.context.scene.objects if obj.type == "ARMATURE"}
    bpy.ops.import_anim.bvh(filepath=str(Path(args.bvh).resolve()))
    sources = [obj for obj in bpy.context.scene.objects
               if obj.type == "ARMATURE" and obj.name not in existing_rigs]
    if len(sources) != 1:
        raise ValueError("Expected one BVH armature")
    source = sources[0]
    if not all(name in source.pose.bones for name in set(JOINTS.values())):
        raise ValueError("BVH skeleton is not the expected Labrador rig")

    align = alignment(source, args.first)
    samples = sample_source(source, args.first, args.last, args.step)
    bake(target, samples, align, args.clip, args.scale, args.travel,
         args.loop, args.loop_fade, args.contact_floor, args.replace_track)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 1
    scene.frame_end = len(samples)
    scene.frame_set(1)
    for obj in list(scene.objects):
        if obj.type == "ARMATURE" and obj != target:
            bpy.data.objects.remove(obj, do_unlink=True)

    for track in target.animation_data.nla_tracks:
        track.mute = track.name != "idle"

    blend = Path(args.blend).resolve()
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))

    for track in target.animation_data.nla_tracks:
        track.mute = False

    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    for obj in scene.objects:
        if obj.type == "MESH" and any(mod.type == "ARMATURE" and mod.object == target
                                      for mod in obj.modifiers):
            obj.select_set(True)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_frame_range=False,
    )
    print("RETARGET_EXPORTED", output, "frames", len(samples))


if __name__ == "__main__":
    main()
