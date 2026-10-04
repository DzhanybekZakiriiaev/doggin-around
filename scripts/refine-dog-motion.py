"""Refine the reviewed Huawei clips and save an editable Blender control rig."""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


SIDE = Vector((1, 0, 0))
FORWARD = Vector((0, 1, 0))
UP = Vector((0, 0, 1))
FPS = 60


def smooth(value):
    value = max(0, min(1, value))
    return value ** 3 * (10 + value * (-15 + 6 * value))


def envelope(t):
    return smooth(t / 0.18) * smooth((1 - t) / 0.18)


def add_rotation(rig, name, axis, angle):
    bone = rig.pose.bones[name]
    local_axis = bone.bone.matrix_local.to_quaternion().inverted() @ axis
    bone.rotation_quaternion @= Quaternion(local_axis, angle)


def add_location(rig, name, offset):
    bone = rig.pose.bones[name]
    bone.location += bone.bone.matrix_local.to_3x3().inverted() @ offset


def turn_head(rig, profile, axis, angle):
    bpy.context.view_layer.update()
    head = rig.pose.bones[profile['head']]
    jaw = rig.pose.bones[profile['jaw']]
    before = head.matrix.copy()
    jaw_before = jaw.matrix.copy()
    add_rotation(rig, profile['head'], axis, angle)
    bpy.context.view_layer.update()
    jaw.matrix = head.matrix @ before.inverted() @ jaw_before
    bpy.context.view_layer.update()


def flatten_paw(rig, leg):
    bone = rig.pose.bones[leg['foot']]
    rest = bone.bone.matrix_local.to_quaternion()
    parent_rest = bone.parent.bone.matrix_local.to_quaternion()
    bone.rotation_quaternion = (
        rest.inverted() @ parent_rest @ bone.parent.matrix.to_quaternion().inverted() @ rest
    ).normalized()


def plant_paw(rig, leg, target, flat=False):
    if flat:
        flatten_paw(rig, leg)
        bpy.context.view_layer.update()
        upper, lower, wrist = [rig.pose.bones[leg[key]] for key in ('upper', 'lower', 'foot')]
        shoulder, elbow, ankle = [bone.head.copy() for bone in (upper, lower, wrist)]
        toe = rig.pose.bones[leg['contact']].head.copy()
        ankle_target = target - (toe - ankle)
        direction = ankle_target - shoulder
        first, second = (elbow - shoulder).length, (ankle - elbow).length
        distance = max(abs(first - second) + 0.0001, min(first + second - 0.0001, direction.length))
        direction.normalize()
        pole = elbow - shoulder
        pole -= direction * pole.dot(direction)
        pole.normalize()
        along = (first * first - second * second + distance * distance) / (2 * distance)
        elbow_target = shoulder + direction * along + pole * math.sqrt(max(0, first * first - along * along))

        def rotate_to(bone, old, new):
            rotation = old.normalized().rotation_difference(new.normalized())
            bone.matrix = Matrix.Translation(bone.head) @ (rotation @ bone.matrix.to_quaternion()).to_matrix().to_4x4()
            bpy.context.view_layer.update()

        rotate_to(upper, elbow - shoulder, elbow_target - shoulder)
        rotate_to(lower, wrist.head - lower.head, shoulder + direction * distance - lower.head)
        flatten_paw(rig, leg)
        bpy.context.view_layer.update()
        return (target - rig.pose.bones[leg['contact']].head).length
    names = [leg['upper'], leg['lower'], leg['foot']]
    bones = [rig.pose.bones[name] for name in names]
    bases = [bone.rotation_quaternion.copy() for bone in bones]
    axes = [bone.bone.matrix_local.to_quaternion().inverted() @ SIDE for bone in bones]
    spread = bones[0].bone.matrix_local.to_quaternion().inverted() @ FORWARD
    values = [0.0] * (len(bones) + 1)

    def position(offsets):
        for bone, base, axis, value in zip(bones, bases, axes, offsets):
            bone.rotation_quaternion = base @ Quaternion(axis, value)
        bones[0].rotation_quaternion @= Quaternion(spread, offsets[-1])
        bpy.context.view_layer.update()
        return rig.pose.bones[leg['contact']].matrix.translation.copy()

    for _ in range(24):
        current = position(values)
        error = target - current
        if error.length < 0.00015:
            break
        derivatives = []
        for index in range(len(values)):
            probe = values.copy()
            probe[index] += 0.002
            derivatives.append((position(probe) - current) / 0.002)
        metric = Matrix(tuple(tuple(
            sum(v[row] * v[column] for v in derivatives) + (0.00005 if row == column else 0)
            for column in range(3)) for row in range(3)))
        correction = metric.inverted() @ error
        for index, derivative in enumerate(derivatives):
            limit = 0.3 if index == len(bones) else 1.3
            step = max(-0.12, min(0.12, derivative.dot(correction)))
            values[index] = max(-limit, min(limit, values[index] + step))
    return (target - position(values)).length


def snapshot(rig):
    return {bone.name: (bone.location.copy(), bone.rotation_quaternion.copy(), bone.scale.copy())
            for bone in rig.pose.bones}


def restore(rig, pose):
    for name, (location, rotation, scale) in pose.items():
        bone = rig.pose.bones[name]
        bone.location = location
        bone.rotation_quaternion = rotation
        bone.scale = scale
    bpy.context.view_layer.update()


def sample_clips(rig):
    data = rig.animation_data
    tracks = list(data.nla_tracks)
    for track in tracks:
        track.is_solo = False
        track.mute = True
    clips = {}
    source_fps = bpy.context.scene.render.fps
    for track in tracks:
        strip = track.strips[0]
        data.action = strip.action
        data.action_slot = strip.action_slot
        start, end = strip.action_frame_start, strip.action_frame_end
        count = round((end - start) / source_fps * FPS)
        poses = []
        for index in range(count + 1):
            frame = start + (end - start) * index / count
            bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
            poses.append(snapshot(rig))
        clips[track.name] = poses
    data.action = None
    for track in tracks:
        data.nla_tracks.remove(track)
    return clips


def refine_jump(rig, profile, t):
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = Quaternion()

    def pulse(start, peak, end):
        if t <= peak:
            return smooth((t - start) / (peak - start))
        return 1 - smooth((t - peak) / (end - peak))

    flight = pulse(0.26, 0.46, 0.80)
    crouch = pulse(0.0, 0.12, 0.27)
    absorb = pulse(0.69, 0.84, 1.0)
    pitch = 0.14 * pulse(0.15, 0.31, 0.53) - 0.15 * pulse(0.50, 0.71, 0.96)
    add_location(rig, profile['root'], UP * (0.29 * flight - 0.035 * crouch - 0.04 * absorb))
    add_rotation(rig, profile['root'], SIDE, pitch)
    for name in profile['torso']:
        add_rotation(rig, name, SIDE, 0.015 * (crouch - absorb))
    add_rotation(rig, profile['neck'], SIDE, -pitch * 0.6)
    add_rotation(rig, profile['head'], SIDE, -pitch * 0.2)
    for index, name in enumerate(profile['tail_chain']):
        add_rotation(rig, name, SIDE, 0.035 * math.sin(t * math.tau - index * 0.3) * envelope(t))
    bpy.context.view_layer.update()
    error = 0
    for leg in profile['legs']:
        front = leg['name'].startswith('front')
        lift = pulse(0.15, 0.43, 0.73) if front else pulse(0.28, 0.51, 0.86)
        target = rig.data.bones[leg['contact']].head_local.copy()
        target += UP * ((0.38 if front else 0.36) * lift)
        target += FORWARD * ((0.045 if front else 0.015) * lift)
        chain = leg
        if not front:
            chain = dict(leg, upper=rig.pose.bones[leg['upper']].parent.name,
                         lower=leg['upper'], foot=leg['lower'])
        error = max(error, plant_paw(rig, chain, target, flat=front))
    return error


def refine_dig(rig, profile, t):
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = Quaternion()
    cycle = t * math.tau
    add_location(rig, profile['root'], SIDE * (0.012 * math.cos(cycle)) - UP * 0.015)
    add_rotation(rig, profile['root'], SIDE, -0.16)
    for name in profile['torso']:
        add_rotation(rig, name, SIDE, -0.025)
        add_rotation(rig, name, FORWARD, 0.009 * math.cos(cycle))
    add_rotation(rig, profile['neck'], SIDE, -0.10)
    turn_head(rig, profile, SIDE, -0.05)
    for index, name in enumerate(profile['tail_chain']):
        add_rotation(rig, name, UP, 0.035 * math.sin(cycle - index * 0.35))
    bpy.context.view_layer.update()
    error = 0
    for leg in profile['legs']:
        front = leg['name'].startswith('front')
        target = rig.data.bones[leg['contact']].head_local.copy()
        chain = leg
        if front:
            phase = (t + leg['phase'] * 0.5) % 1
            if phase < 0.5:
                # Scrape backward on the ground, then lift to reach forward.
                target += FORWARD * (0.08 - 0.15 * smooth(phase * 2))
            else:
                recovery = (phase - 0.5) * 2
                target += FORWARD * (-0.07 + 0.15 * smooth(recovery))
                target += UP * (0.085 * math.sin(math.pi * recovery) ** 2)
        else:
            chain = dict(leg, upper=rig.pose.bones[leg['upper']].parent.name,
                         lower=leg['upper'], foot=leg['lower'])
        error = max(error, plant_paw(rig, chain, target, flat=front))
    return error


def refine_backflip(rig, profile, t):
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = Quaternion()

    def pulse(start, peak, end):
        if t <= peak:
            return smooth((t - start) / (peak - start))
        return 1 - smooth((t - peak) / (end - peak))

    crouch = pulse(0, 0.14, 0.22)
    landing = pulse(0.78, 0.86, 1)
    tuck = smooth((t - 0.27) / 0.11) * (1 - smooth((t - 0.62) / 0.12))
    add_location(rig, profile['root'], -UP * (0.055 * crouch + 0.055 * landing))
    for name in profile['torso']:
        add_rotation(rig, name, SIDE, 0.025 * (crouch + landing) - 0.025 * tuck)
    add_rotation(rig, profile['neck'], SIDE, -0.08 * tuck)
    turn_head(rig, profile, SIDE, -0.06 * tuck)
    for name in profile['tail_chain']:
        add_rotation(rig, name, SIDE, 0.08 * tuck)
    bpy.context.view_layer.update()
    error = 0
    for leg in profile['legs']:
        front = leg['name'].startswith('front')
        target = rig.data.bones[leg['contact']].head_local.copy()
        target += UP * ((0.18 if front else 0.16) * tuck)
        target += FORWARD * ((-0.04 if front else 0.06) * tuck)
        chain = leg
        if not front:
            chain = dict(leg, upper=rig.pose.bones[leg['upper']].parent.name,
                         lower=leg['upper'], foot=leg['lower'])
        error = max(error, plant_paw(rig, chain, target, flat=front))

    flight = max(0, min(1, (t - 0.22) / 0.56))
    height = 0.66 * 4 * flight * (1 - flight)
    rotation = Quaternion(SIDE, math.tau * smooth((t - 0.26) / 0.48))
    root = rig.pose.bones[profile['root']]
    pivot = rig.data.bones[profile['root']].head_local + FORWARD * 0.14 + UP * 0.04
    root.matrix = (Matrix.Translation(pivot + UP * height)
                   @ rotation.to_matrix().to_4x4() @ Matrix.Translation(-pivot) @ root.matrix)
    bpy.context.view_layer.update()
    return error


def refine_pose(rig, profile, clip, t):
    if clip == 'jump':
        return refine_jump(rig, profile, t)
    if clip == 'dig':
        return refine_dig(rig, profile, t)
    if clip == 'backflip':
        return refine_backflip(rig, profile, t)
    looping = clip in {'idle', 'wag', 'sniff', 'walk', 'run'}
    amount = 1 if looping else envelope(t)
    contacts = {leg['name']: rig.pose.bones[leg['contact']].matrix.translation.copy()
                for leg in profile['legs']}
    if clip in {'sit', 'sniff'}:
        for leg in profile['legs']:
            contacts[leg['name']] = rig.data.bones[leg['contact']].head_local.copy()
            if clip == 'sit' and leg['name'].startswith('back'):
                contacts[leg['name']] += FORWARD * (0.14 * smooth(t / 0.55))
    if clip in {'walk', 'run'}:
        return 0

    breath = math.sin(t * math.tau)
    sway = math.sin(t * math.tau) * amount
    if clip in {'idle', 'wag'}:
        add_location(rig, profile['root'], Vector((0.009 * sway, 0.003 * breath, 0.003 * (1 - math.cos(t * math.tau)))))
        for index, name in enumerate(profile['torso']):
            add_rotation(rig, name, FORWARD, (0.013 if index < 2 else -0.013) * sway)
            add_rotation(rig, name, SIDE, 0.006 * breath)
        look = 0 if clip == 'idle' else 0.13 * math.sin(t * math.tau) + 0.035 * math.sin(t * math.tau * 2)
        add_rotation(rig, profile['neck'], UP, look * 0.6)
        add_rotation(rig, profile['head'], UP, look * 0.4)
        if clip == 'wag':
            add_rotation(rig, profile['head'], FORWARD, 0.045 * math.sin(t * math.tau * 2))
    elif clip == 'paw':
        add_rotation(rig, profile['torso'][0], FORWARD, -0.035 * amount)
        add_rotation(rig, profile['torso'][-1], FORWARD, 0.022 * amount)
        add_rotation(rig, profile['neck'], UP, -0.10 * amount)
    elif clip == 'sniff':
        add_location(rig, profile['root'], SIDE * (0.004 * sway))
        add_location(rig, profile['root'], UP * -0.02)
        add_rotation(rig, profile['torso'][-2], SIDE, -0.035)
        add_rotation(rig, profile['torso'][-1], SIDE, -0.035)
        add_rotation(rig, profile['neck'], SIDE, 0.12)
        add_rotation(rig, profile['head'], SIDE, 0.05)
        add_rotation(rig, profile['neck'], UP, 0.04 * math.sin(t * math.tau))
        add_rotation(rig, profile['head'], FORWARD, 0.025 * math.sin(t * math.tau * 2))
    elif clip == 'bark':
        pulse = math.sin(t * math.tau * 3) * amount
        for index, name in enumerate(profile['torso']):
            add_rotation(rig, name, SIDE, (0.012 if index < 2 else -0.008) * pulse)
        add_rotation(rig, profile['neck'], FORWARD, 0.025 * pulse)
    elif clip == 'sit':
        settle = smooth(t / 0.55)
        add_rotation(rig, profile['torso'][-1], SIDE, 0.035 * settle)
        add_rotation(rig, profile['neck'], SIDE, -0.035 * settle)
        for leg in profile['legs']:
            if not leg['name'].startswith('back'):
                continue
            knee = rig.pose.bones[leg['upper']]
            hip = knee.parent
            for name, angle in [(hip.name, 0.95), (knee.name, -1.3), (leg['lower'], 0.8), (leg['foot'], -0.45)]:
                rig.pose.bones[name].rotation_quaternion = Quaternion()
                add_rotation(rig, name, SIDE, angle * settle)
    elif clip == 'spin':
        add_rotation(rig, profile['neck'], UP, 0.18 * amount)
        add_rotation(rig, profile['head'], UP, 0.10 * amount)
        for index, name in enumerate(profile['torso']):
            add_rotation(rig, name, UP, (0.025 if index < 2 else 0.015) * amount)
    bpy.context.view_layer.update()
    error = 0
    for leg in profile['legs']:
        if clip in {'jump', 'spin'} or (clip == 'paw' and leg['name'] == 'front_positive_x'):
            continue
        flat = clip == 'sniff' and leg['name'].startswith('front')
        chain = leg
        if clip in {'sit', 'sniff'} and leg['name'].startswith('back'):
            chain = dict(leg, upper=rig.pose.bones[leg['upper']].parent.name,
                         lower=leg['upper'], foot=leg['lower'])
        error = max(error, plant_paw(rig, chain, contacts[leg['name']], flat))
    return error


def bake(rig, profile, clips):
    report = {}
    for clip, poses in clips.items():
        refined = []
        error = 0
        for index, pose in enumerate(poses):
            restore(rig, pose)
            error = max(error, refine_pose(rig, profile, clip, index / (len(poses) - 1)))
            # Keep the same neutral face beneath every action's motion.
            add_rotation(rig, profile['neck'], UP, 0.315)
            add_rotation(rig, profile['neck'], SIDE, -0.08)
            turn_head(rig, profile, UP, 0.135)
            turn_head(rig, profile, SIDE, -0.04)
            refined.append(snapshot(rig))
        action = bpy.data.actions.new('refined_' + clip)
        rig.animation_data.action = action
        previous = {}
        for frame, pose in enumerate(refined, 1):
            restore(rig, pose)
            for bone in rig.pose.bones:
                if bone.name in previous and bone.rotation_quaternion.dot(previous[bone.name]) < 0:
                    bone.rotation_quaternion.negate()
                previous[bone.name] = bone.rotation_quaternion.copy()
                for path in ('location', 'rotation_quaternion', 'scale'):
                    bone.keyframe_insert(data_path=path, frame=frame, group=bone.name)
        bag = action.layers[0].strips[0].channelbag(rig.animation_data.action_slot)
        for curve in bag.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
        track = rig.animation_data.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, 1, action)
        track.mute = True
        rig.animation_data.action = None
        report[clip] = {'frames': len(poses), 'maxContactError': error}
    return report


def make_controls(rig, profile):
    controls = rig.copy()
    controls.data = rig.data.copy()
    controls.name = 'Dog Controls'
    controls.data.name = 'Huawei animator controls'
    bpy.context.scene.collection.objects.link(controls)
    controls.animation_data_clear()
    controls.animation_data_create()
    labels = {profile['root']: 'Pelvis', profile['neck']: 'Neck', profile['head']: 'Head',
              profile['jaw']: 'Jaw'}
    labels.update({name: 'Spine_' + str(index + 1) for index, name in enumerate(profile['torso'])})
    labels.update({name: 'Tail_' + str(index + 1) for index, name in enumerate(profile['tail_chain'])})
    labels.update({name: 'Ear_' + str(index + 1) for index, name in enumerate(profile['ears'])})
    for leg in profile['legs']:
        for part in ('upper', 'lower', 'foot', 'contact'):
            labels[leg[part]] = leg['name'] + '_' + part
    names = {bone.name: 'CTRL_' + labels.get(bone.name, bone.name) for bone in rig.data.bones}
    for bone in controls.data.bones:
        bone.name = names[bone.name]
        bone.use_deform = False
    for track in rig.animation_data.nla_tracks:
        source = track.strips[0]
        action = source.action.copy()
        action.name = 'Controls_' + track.name
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for old, new in names.items():
                            curve.data_path = curve.data_path.replace('["' + old + '"]', '["' + new + '"]')
        target = controls.animation_data.nla_tracks.new()
        target.name = track.name
        target.strips.new(track.name, 1, action)
        target.mute = track.name != 'idle'
        track.mute = True
    for bone in rig.pose.bones:
        constraint = bone.constraints.new('COPY_TRANSFORMS')
        constraint.name = 'Animator control'
        constraint.target = controls
        constraint.subtarget = names[bone.name]
        constraint.owner_space = 'WORLD'
        constraint.target_space = 'WORLD'
    make_paw_controls(controls, profile, names)
    shapes = bpy.data.collections.new('Control shapes')
    bpy.context.scene.collection.children.link(shapes)
    shapes.hide_render = True
    for name, radius in [('body', 0.12), ('head', 0.095), ('limb', 0.045)]:
        mesh = bpy.data.meshes.new('Shape_' + name)
        points = [(math.cos(i * math.tau / 32) * radius, 0, math.sin(i * math.tau / 32) * radius)
                  for i in range(32)]
        mesh.from_pydata(points, [(i, (i + 1) % 32) for i in range(32)], [])
        obj = bpy.data.objects.new('Shape_' + name, mesh)
        shapes.objects.link(obj)
        obj.hide_set(True)
        obj.hide_render = True
    for old, name in names.items():
        bone = controls.pose.bones[name]
        kind = 'body' if old in [profile['root'], *profile['torso']] else 'head' if old in [profile['head'], profile['neck']] else 'limb'
        bone.custom_shape = bpy.data.objects['Shape_' + kind]
        bone.use_custom_shape_bone_size = False
        bone.custom_shape_scale_xyz = (1, 1, 1)
        bone.custom_shape_wire_width = 2.5
        bone.color.palette = 'THEME04' if kind == 'body' else 'THEME03' if kind == 'head' else 'THEME01'
    controls.show_in_front = True
    rig.hide_set(True)
    bpy.ops.object.select_all(action='DESELECT')
    controls.select_set(True)
    bpy.context.view_layer.objects.active = controls
    bpy.ops.object.mode_set(mode='POSE')
    return controls


def make_paw_controls(controls, profile, names):
    bpy.ops.object.select_all(action='DESELECT')
    controls.select_set(True)
    bpy.context.view_layer.objects.active = controls
    bpy.ops.object.mode_set(mode='EDIT')
    mechanisms = controls.data.collections.new('IK mechanisms')
    targets = []
    for leg in profile['legs']:
        chain = [leg['upper'], leg['lower'], leg['foot']]
        points = [controls.data.edit_bones[names[name]].head.copy()
                  for name in [*chain, leg['contact']]]
        parent = controls.data.edit_bones[names[leg['upper']]].parent
        for index, name in enumerate(chain):
            bone = controls.data.edit_bones.new('MCH_' + name)
            bone.head = points[index]
            bone.tail = points[index + 1]
            bone.parent = parent
            bone.use_connect = index > 0
            bone.use_deform = False
            mechanisms.assign(bone)
            helper = controls.data.edit_bones.new('MATCH_' + name)
            helper.matrix = controls.data.edit_bones[names[name]].matrix.copy()
            helper.length = 0.04
            helper.parent = bone
            helper.use_deform = False
            mechanisms.assign(helper)
            parent = bone
        target_name = 'PAW_' + leg['name']
        target = controls.data.edit_bones.new(target_name)
        target.head = points[-1]
        target.tail = points[-1] + UP * 0.08
        target.use_deform = False
        targets.append((leg, target_name))
    bpy.ops.object.mode_set(mode='OBJECT')
    for leg, target_name in targets:
        target = controls.pose.bones[target_name]
        target['IK'] = 0.0
        target.id_properties_ui('IK').update(min=0, max=1, description='Use 1 to move the paw with this target, or 0 for the captured FK motion')
        target.color.palette = 'THEME03'
        mechanism = controls.pose.bones['MCH_' + leg['foot']]
        constraint = mechanism.constraints.new('IK')
        constraint.target = controls
        constraint.subtarget = target_name
        constraint.chain_count = 3
        constraint.use_stretch = False
        constraint.iterations = 64
        for name in [leg['upper'], leg['lower'], leg['foot']]:
            bone = controls.pose.bones[names[name]]
            constraint = bone.constraints.new('COPY_ROTATION')
            constraint.name = 'Paw IK'
            constraint.target = controls
            constraint.subtarget = 'MATCH_' + name
            constraint.owner_space = 'WORLD'
            constraint.target_space = 'WORLD'
            driver = constraint.driver_add('influence').driver
            driver.type = 'AVERAGE'
            variable = driver.variables.new()
            variable.name = 'ik'
            variable.type = 'SINGLE_PROP'
            variable.targets[0].id = controls
            variable.targets[0].data_path = f'pose.bones["{target_name}"]["IK"]'
    data = controls.animation_data
    for track in data.nla_tracks:
        track.mute = True
    for track in data.nla_tracks:
        strip = track.strips[0]
        data.action = strip.action
        data.action_slot = strip.action_slot
        for frame in range(round(strip.action_frame_start), round(strip.action_frame_end) + 1):
            bpy.context.scene.frame_set(frame)
            for leg, target_name in targets:
                target = controls.pose.bones[target_name]
                contact = controls.pose.bones[names[leg['contact']]].matrix.translation.copy()
                target.location = target.bone.matrix_local.inverted() @ contact
                target.keyframe_insert(data_path='location', frame=frame, group=target_name)
    data.action = None
    for track in data.nla_tracks:
        track.mute = track.name != 'idle'
    mechanisms.is_visible = False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--profile', type=Path, default=Path('public/models/huawei-dog-rig.json'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--blend', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))
    profile = json.loads(args.profile.read_text())
    rig = bpy.data.objects[profile['armature']]
    if len(rig.data.bones) != 41:
        raise ValueError('This refinement requires the reviewed 41-joint Huawei dog')
    modifiers = [modifier for obj in bpy.context.scene.objects if obj.type == 'MESH'
                 for modifier in obj.modifiers if modifier.type == 'ARMATURE']
    for modifier in modifiers:
        modifier.show_viewport = False
    clips = sample_clips(rig)
    clips['dig'] = [clips['idle'][0]] * (round(1.2 * FPS) + 1)
    clips['backflip'] = [clips['idle'][0]] * (round(2.2 * FPS) + 1)
    scene = bpy.context.scene
    scene.render.fps = FPS
    report = bake(rig, profile, clips)
    if max(item['maxContactError'] for item in report.values()) > 0.003:
        raise ValueError('A support paw cannot reach its target. Review the pose before export')
    for modifier in modifiers:
        modifier.show_viewport = True
    scene.frame_start = 1
    scene.frame_end = len(clips['idle'])
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format='GLB',
                             export_animations=True, export_animation_mode='NLA_TRACKS',
                             export_force_sampling=True, export_anim_slide_to_zero=True,
                             export_frame_range=False)
    make_controls(rig, profile)
    scene.frame_set(1)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_distance = 2.5
                area.spaces.active.region_3d.view_location = Vector((0, 0, 0))
                area.spaces.active.shading.type = 'MATERIAL'
    args.blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()))
    args.output.with_suffix('.motion.json').write_text(json.dumps(report, indent=2) + '\n')
    print('MOTION_REFINED', json.dumps(report))


if __name__ == '__main__':
    main()
