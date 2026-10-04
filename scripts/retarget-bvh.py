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
    "joint_9": "b__LeftFinger",
    "joint_27": "b_RightClav",
    "joint_31": "b_RightArm",
    "joint_35": "b_RightForeArm",
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


LEGS = (
    (("joint_5", "joint_7", "joint_8"), "joint_6", "b__LeftFinger"),
    (("joint_31", "joint_35", "joint_36"), "joint_34", "b_RightFinger"),
    (("joint_10", "joint_11", "joint_4"), "joint_3", "b_LeftToe"),
    (("joint_30", "joint_32", "joint_33"), "joint_38", "b_RightToe"),
)
# Allowed sideways bend in radians.
HINGES = {"joint_7": 0.14, "joint_35": 0.14, "joint_11": 0.16, "joint_32": 0.16,
          "joint_8": 0.22, "joint_36": 0.22, "joint_4": 0.18, "joint_33": 0.18,
          "joint_9": 0.18, "joint_37": 0.18}


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


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
            "feet": {name: source.pose.bones[name].matrix.translation.copy()
                     for _, _, name in LEGS},
        })
    return samples


def smooth_loop(poses, passes, loop, blend_frames=None):
    if loop:
        first, first_root = poses[0]
        last, last_root = poses[-1]
        errors = {name: last[name].inverted() @ first[name] for name in first}
        drift = last_root - first_root
        start = max(0, len(poses) - 1 - blend_frames) if blend_frames else 0
        for index, (rotation, root) in enumerate(poses):
            factor = ease((index - start) / (len(poses) - 1 - start))
            for name in rotation:
                rotation[name] = (rotation[name] @ Quaternion().slerp(errors[name], factor)).normalized()
            poses[index] = (rotation, root - drift * factor)

    count = len(poses) - 1 if loop else len(poses)
    for _ in range(passes):
        filtered = []
        for index in range(count):
            left = poses[(index - 1) % count if loop else max(0, index - 1)]
            right = poses[(index + 1) % count if loop else min(count - 1, index + 1)]
            rotation, root = poses[index]
            filtered.append(({
                name: value.slerp(left[0][name].slerp(right[0][name], 0.5), 0.5).normalized()
                for name, value in rotation.items()
            }, root.lerp((left[1] + right[1]) * 0.5, 0.5)))
        poses[:] = filtered + [(filtered[0][0].copy(), filtered[0][1].copy())] if loop else filtered
    if loop:
        close_tangent(poses)


def close_tangent(poses):
    # Match the rotation and translation speeds across the seam.
    left, right = poses[-2], poses[1]
    seam = ({name: left[0][name].slerp(right[0][name], 0.5).normalized()
             for name in left[0]}, (left[1] + right[1]) * 0.5)
    poses[0] = seam
    poses[-1] = ({name: rotation.copy() for name, rotation in seam[0].items()}, seam[1].copy())


def smooth_wrists(poses, loop):
    # The source carpus channels have the sharpest spikes.
    count = len(poses) - 1 if loop else len(poses)
    for _ in range(4):
        values = []
        for index in range(count):
            left = poses[(index - 1) % count if loop else max(0, index - 1)][0]
            right = poses[(index + 1) % count if loop else min(count - 1, index + 1)][0]
            values.append({name: poses[index][0][name].slerp(left[name].slerp(right[name], 0.5), 0.5)
                           for name in ("joint_8", "joint_36")})
        for index, rotations in enumerate(values):
            poses[index][0].update(rotations)
    if loop:
        close_tangent(poses)


def apply_pose(target, pose):
    rotations, root = pose
    for name, rotation in rotations.items():
        target.pose.bones[name].rotation_quaternion = rotation
    target.pose.bones["joint_18"].location = root
    bpy.context.view_layer.update()


def contact_pose(target, chain, contact, goal, strength):
    bones = [target.pose.bones[name] for name in chain]
    bases = [bone.rotation_quaternion.copy() for bone in bones]
    axes = [bone.bone.matrix_local.to_quaternion().inverted() @ Vector((1, 0, 0))
            for bone in bones]
    offsets = [0.0] * len(bones)

    def point(values):
        for bone, base, axis, value in zip(bones, bases, axes, values):
            bone.rotation_quaternion = base @ Quaternion(axis, value)
        bpy.context.view_layer.update()
        location = target.pose.bones[contact].matrix.translation
        return Vector((location.y, location.z))

    for _ in range(12):
        current = point(offsets)
        error = goal - current
        if error.length < 0.0005:
            break
        derivatives = []
        for index in range(len(bones)):
            probe = offsets.copy()
            probe[index] += 0.003
            derivatives.append((point(probe) - current) / 0.003)
        damping = 0.0005
        a = sum(value.x * value.x for value in derivatives) + damping
        b = sum(value.x * value.y for value in derivatives)
        d = sum(value.y * value.y for value in derivatives) + damping
        determinant = a * d - b * b
        x = (d * error.x - b * error.y) / determinant
        y = (a * error.y - b * error.x) / determinant
        for index, derivative in enumerate(derivatives):
            step = max(-0.08, min(0.08, derivative.x * x + derivative.y * y))
            offsets[index] = max(-0.24, min(0.24, offsets[index] + step))
    point([offset * strength for offset in offsets])


def bake(target, samples, align, clip, scale, include_travel, loop, loop_fade,
         contact_floor, ground_clamp, replace_track, smooth_passes):
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
    rig_bones = list(target.data.bones)
    keyed_poses = []
    if not all(name in target.pose.bones for name in JOINTS):
        raise ValueError("Target is not the reviewed 41-bone Huawei rig")

    source_forward = reference["rotation"]["b_Hips"].inverted() @ (align.inverted() @ Vector((0, 1, 0)))
    reference_heading = align.inverted() @ Vector((0, 1, 0))
    for sample in samples:
        world_rotations = {}
        frame_pose = {}
        heading = sample["rotation"]["b_Hips"] @ source_forward
        heading.z = 0
        yaw = math.atan2(heading.y, heading.x) - math.atan2(reference_heading.y, reference_heading.x)
        hip_stabilizer = Quaternion(Vector((0, 0, 1)), -yaw)
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

            if bone.name in HINGES:
                swing, twist = basis.to_swing_twist("X")
                if swing.angle > HINGES[bone.name]:
                    swing = Quaternion().slerp(swing, HINGES[bone.name] / swing.angle)
                basis = swing @ Quaternion(Vector((1, 0, 0)), twist)
                desired = parent_world @ parent_rest.inverted() @ rest @ basis
            pose_bone = target.pose.bones[bone.name]
            pose_bone.rotation_quaternion = basis.normalized()
            frame_pose[bone.name] = pose_bone.rotation_quaternion.copy()
            world_rotations[bone.name] = desired.normalized()

        travel = align @ (sample["hip"] - reference["hip"])
        if not include_travel:
            travel.x = 0
            travel.y = 0
        root = target.pose.bones["joint_18"]
        root_basis = root.bone.matrix_local.to_3x3().inverted()
        root.location = root_basis @ (travel * scale)
        keyed_poses.append((frame_pose, root.location.copy()))

    smooth_loop(keyed_poses, smooth_passes, loop, loop_fade)
    smooth_wrists(keyed_poses, loop)

    if contact_floor or ground_clamp:
        feet = tuple(contact for _, contact, _ in LEGS)
        floor = min(target.data.bones[name].head_local.z for name in feet)
        heights = {name: [sample["feet"][name].z for sample in samples] for _, _, name in LEGS}
        thresholds = {name: min(values) + (max(values) - min(values)) * 0.25
                      for name, values in heights.items()}
        corrected = []
        for index, frame_pose in enumerate(keyed_poses):
            apply_pose(target, frame_pose)
            minimum = min(target.pose.bones[name].matrix.translation.z for name in feet)
            correction = floor - minimum
            if ground_clamp:
                correction = max(0.0, correction)
            root = target.pose.bones["joint_18"]
            root_basis = root.bone.matrix_local.to_3x3().inverted()
            root.location = root.location + root_basis @ Vector((0, 0, correction))
            bpy.context.view_layer.update()
            for chain, contact, source_name in LEGS:
                location = target.pose.bones[contact].matrix.translation.copy()
                band = max(1.0, (max(heights[source_name]) - min(heights[source_name])) * 0.15)
                strength = ease((thresholds[source_name] - heights[source_name][index]) / band)
                if location.z < floor + 0.025:
                    strength = max(strength, ease((floor + 0.025 - location.z) / 0.025))
                if strength > 0:
                    goal = Vector((location.y, floor))
                    contact_pose(target, chain, contact, goal, strength)
            corrected.append(({bone.name: bone.rotation_quaternion.copy() for bone in target.pose.bones},
                              root.location.copy()))
        keyed_poses = corrected
        smooth_loop(keyed_poses, 1, loop)
        for frame_pose in keyed_poses:
            apply_pose(target, frame_pose)
            minimum = min(target.pose.bones[name].matrix.translation.z for name in feet)
            if minimum < floor:
                root = target.pose.bones["joint_18"]
                root.location += root.bone.matrix_local.to_3x3().inverted() @ Vector((0, 0, floor - minimum))
                frame_pose[1][:] = root.location

    action = bpy.data.actions.new(clip)
    target.animation_data.action = action
    previous = {}
    for frame, frame_pose in enumerate(keyed_poses, start=1):
        apply_pose(target, frame_pose)
        for bone in target.pose.bones:
            if bone.name in previous and bone.rotation_quaternion.dot(previous[bone.name]) < 0:
                bone.rotation_quaternion.negate()
            previous[bone.name] = bone.rotation_quaternion.copy()
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
        target.pose.bones["joint_18"].keyframe_insert(data_path="location", frame=frame, group="joint_18")
    channelbag = action.layers[0].strips[0].channelbag(target.animation_data.action_slot)
    for curve in channelbag.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"

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
    parser.add_argument("--smooth-passes", type=int, default=2)
    parser.add_argument("--contact-floor", action="store_true")
    parser.add_argument("--ground-clamp", action="store_true")
    parser.add_argument("--replace-track")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if args.step < 1 or args.first < 1 or args.last < args.first:
        parser.error("Invalid source frame range")
    if args.scale <= 0 or not math.isfinite(args.scale):
        parser.error("Scale must be positive and finite")
    if args.loop_fade < 1:
        parser.error("Loop fade must be positive")
    if args.smooth_passes < 0 or args.smooth_passes > 8:
        parser.error("Smoothing passes must be between zero and eight")
    if args.loop and (args.last - args.first) // args.step < 3:
        parser.error("A loop needs at least four sampled poses")

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
         args.loop, args.loop_fade, args.contact_floor, args.ground_clamp,
         args.replace_track, args.smooth_passes)
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
