import argparse
import hashlib
import json
import sys
import math
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

project = Path.cwd()
parser = argparse.ArgumentParser(description='Bind existing TripoSplat Gaussians to the dog GLB')
parser.add_argument('--input',type=Path,default=project/'outputs/huawei-triposplat-fullbody-65536.npz')
parser.add_argument('--rig',type=Path,default=project/'public/models/dog-animated.glb')
parser.add_argument('--output',type=Path,default=project/'work/triposplat-comparison/binding')
parser.add_argument('--publish',type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out = args.output.resolve()
out.mkdir(parents=True,exist_ok=True)
started = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(args.rig.resolve()))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
rig.animation_data.action = None
for track in rig.animation_data.nla_tracks:
    track.mute = True
for bone in rig.pose.bones:
    bone.matrix_basis = Matrix.Identity(4)
bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()
mesh.data.calc_loop_triangles()
vertices = np.array([mesh.matrix_world @ v.co for v in mesh.data.vertices], dtype=np.float64)
faces = np.array([t.vertices for t in mesh.data.loop_triangles])
bvh = BVHTree.FromPolygons([Vector(p) for p in vertices], faces.tolist(), all_triangles=True)
kd = KDTree(len(vertices))
for i, p in enumerate(vertices):
    kd.insert(Vector(p), i)
kd.balance()
raw = np.load(args.input.resolve())
xyz = raw['xyz'].astype(np.float64)
scales = raw['scales'].astype(np.float64)
opacity = raw['opacity'].reshape(-1).astype(np.float64)
color = raw['color'].astype(np.float64)
quats = raw['rotation'].astype(np.float64)
quats /= np.linalg.norm(quats, axis=1, keepdims=True)
w, x, y, z = quats.T
rot = np.empty((len(xyz), 3, 3))
rot[:, 0, 0] = 1-2*(y*y+z*z)
rot[:, 0, 1] = 2*(x*y-z*w)
rot[:, 0, 2] = 2*(x*z+y*w)
rot[:, 1, 0] = 2*(x*y+z*w)
rot[:, 1, 1] = 1-2*(x*x+z*z)
rot[:, 1, 2] = 2*(y*z-x*w)
rot[:, 2, 0] = 2*(x*z-y*w)
rot[:, 2, 1] = 2*(y*z+x*w)
rot[:, 2, 2] = 1-2*(x*x+y*y)
r0 = np.array([[0,0,-1],[1,0,0],[0,-1,0]], dtype=float)
p0 = xyz @ r0.T
rng = np.random.default_rng(42)
select = rng.choice(np.flatnonzero(opacity > 0.2), 2500, replace=False)
source = p0[select]
initial_scale = (np.prod(np.ptp(vertices, axis=0)) / np.prod(np.ptp(source, axis=0))) ** (1/3)

def closest(p):
    return np.array([kd.find(Vector(v))[0] for v in p])

candidates = []
for angle in np.arange(-180, 180, 15):
    a = math.radians(float(angle))
    rotation = np.array([[math.cos(a),-math.sin(a),0],[math.sin(a),math.cos(a),0],[0,0,1]])
    scale = initial_scale
    linear = rotation * scale
    translation = vertices.mean(0) - source.mean(0) @ linear.T
    for iteration in range(12):
        transformed = source @ linear.T + translation
        target = closest(transformed)
        distance = np.linalg.norm(transformed-target, axis=1)
        keep = distance <= np.quantile(distance, 0.85)
        src = source[keep]
        dst = target[keep]
        src_mean, dst_mean = src.mean(0), dst.mean(0)
        u, s, vt = np.linalg.svd((src-src_mean).T @ (dst-dst_mean))
        rr = vt.T @ u.T
        if np.linalg.det(rr) < 0:
            vt[-1] *= -1
            rr = vt.T @ u.T
        ss = float(np.sum((src-src_mean) @ rr.T * (dst-dst_mean)) / np.sum((src-src_mean)**2))
        linear = rr * ss
        translation = dst_mean - src_mean @ linear.T
    transformed = source @ linear.T + translation
    distances = np.linalg.norm(transformed-closest(transformed), axis=1)
    score = float(np.mean(np.minimum(distances, 0.15)**2))
    candidates.append((score, float(angle), linear, translation))
    print('ALIGN', angle, score, flush=True)
score, angle, linear, translation = min(candidates, key=lambda item: item[0])
full_linear = linear @ r0
positions = xyz @ full_linear.T + translation
covariance = np.einsum('nij,nj,nkj->nik',rot,scales**2,rot)
covariance = full_linear @ covariance @ full_linear.T
bone_names = [b.name for b in rig.data.bones]
name_to_bone = {n:i for i,n in enumerate(bone_names)}
vertex_weights = np.zeros((len(vertices),len(bone_names)))
for vertex in mesh.data.vertices:
    for group in vertex.groups:
        name = mesh.vertex_groups[group.group].name
        if name in name_to_bone:
            vertex_weights[vertex.index,name_to_bone[name]] = group.weight
weights = np.zeros((len(positions),len(bone_names)))
triangle_index = np.empty(len(positions),dtype=np.int32)
nearest_distance = np.empty(len(positions))
for i,p in enumerate(positions):
    point, normal, index, distance = bvh.find_nearest(Vector(p))
    a,b,c = vertices[faces[index]]
    v0,v1,v2 = b-a,c-a,np.array(point)-a
    d00,d01,d11 = v0@v0,v0@v1,v1@v1
    d20,d21 = v2@v0,v2@v1
    denominator = d00*d11-d01*d01
    if abs(denominator) < 1e-15:
        bary = np.array([1,0,0])
    else:
        v = (d11*d20-d01*d21)/denominator
        wv = (d00*d21-d01*d20)/denominator
        bary = np.clip([1-v-wv,v,wv],0,1)
        bary /= np.sum(bary)
    weights[i] = bary @ vertex_weights[faces[index]]
    triangle_index[i] = index
    nearest_distance[i] = distance
sys.path.insert(0,str(Path(__file__).resolve().parent))
from triposplat_accessories import segment_accessories
head_mask, neck_mask, accessory_metadata = segment_accessories(positions,color,bone_names)
weights[head_mask] = 0
weights[head_mask,accessory_metadata['head_joint']] = 1
weights[neck_mask] = 0
weights[neck_mask,accessory_metadata['neck_joint']] = 1
face_mask = (positions[:,1] > 0.09) & (positions[:,2] > 0.13) & (np.abs(positions[:,0]) < 0.30)
dark_detail = (color.min(axis=1) < 0.2) & (positions[:,2] > 0.1)
importance = opacity * np.power(np.maximum(np.linalg.det(covariance),0),1/3)
importance *= 1 + 0.4*face_mask + 0.55*head_mask + 0.4*neck_mask + 0.2*dark_detail
indices50 = np.argsort(-importance)[:50000]
joint_indices = np.argsort(-weights,axis=1)[:,:4]
joint_weights = np.take_along_axis(weights,joint_indices,axis=1)
joint_weights /= joint_weights.sum(1,keepdims=True)
weights[:] = 0
np.put_along_axis(weights,joint_indices,joint_weights,axis=1)
np.savez_compressed(out/'bound-65536.npz',xyz=positions,covariance=covariance,opacity=opacity,color=color,joints=joint_indices,weights=joint_weights,bone_names=np.array(bone_names),nearest_distance=nearest_distance,head_mask=head_mask,neck_mask=neck_mask,indices50=indices50)
np.savez_compressed(out/'bound-50000.npz',xyz=positions[indices50],covariance=covariance[indices50],opacity=opacity[indices50],color=color[indices50],joints=joint_indices[indices50],weights=joint_weights[indices50],bone_names=np.array(bone_names))
for count,selected in [(65536,np.arange(65536)),(50000,indices50)]:
    (out/('skin-joints-'+str(count)+'.bin')).write_bytes(joint_indices[selected].astype('uint8').tobytes())
    (out/('skin-weights-'+str(count)+'.bin')).write_bytes(joint_weights[selected].astype('<f4').tobytes())
(out/'mesh-faces.bin').write_bytes(faces.astype('<u4').tobytes())
(out/'rig-binding.json').write_text(json.dumps({'bone_names':bone_names,'joints_type':'uint8','weights_type':'float32-le','influences_per_splat':4,'space':'Blender Z up world','to_three_matrix':[[1,0,0],[0,0,1],[0,-1,0]],'accessories':accessory_metadata},indent=2))
rest_bones = np.array([rig.matrix_world @ b.matrix_local for b in rig.data.bones])
rest_inverse = np.linalg.inv(rest_bones)


def matrix_quaternion(m):
    return np.array([Matrix(r.tolist()).to_quaternion()[:] for r in m])


def save_ply(path, xyz_out, cov_out, count):
    values, vectors = np.linalg.eigh(cov_out)
    bad = np.linalg.det(vectors) < 0
    vectors[bad,:,0] *= -1
    q = matrix_quaternion(vectors)
    header = 'ply\nformat binary_little_endian 1.0\nelement vertex '+str(len(xyz_out))+'\n'
    names = ['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3']
    header += ''.join('property float '+name+'\n' for name in names)+'end_header\n'
    o = np.clip(opacity,1e-6,1-1e-6)
    array = np.column_stack([xyz_out,np.zeros_like(xyz_out),(color-0.5)/0.28209479177387814,np.log(o/(1-o)),np.log(np.sqrt(np.maximum(values,1e-12))),q]).astype('<f4')
    if count < len(array):
        array = array[indices50]
        header = header.replace('element vertex '+str(len(xyz_out)), 'element vertex '+str(count))
    path.write_bytes(header.encode()+array.tobytes())

if args.publish:
    published = args.publish.resolve()
    published.mkdir(parents=True,exist_ok=True)
    conversion = np.array([[1,0,0],[0,0,1],[0,-1,0]],dtype=float)
    mesh_local_xyz = positions @ conversion.T
    mesh_local_covariance = conversion @ covariance @ conversion.T
    stem = 'dog-triposplat-50000'
    (published/(stem+'-joints.bin')).write_bytes(joint_indices[indices50].astype('uint8').tobytes())
    (published/(stem+'-weights.bin')).write_bytes(joint_weights[indices50].astype('<f4').tobytes())
    save_ply(published/(stem+'.ply'),mesh_local_xyz,mesh_local_covariance,50000)
    metadata = {
        'version':1,'count':50000,
        'joints':stem+'-joints.bin','weights':stem+'-weights.bin','ply':stem+'.ply',
        'bone_names':bone_names,'coordinateSpace':'Original GLB skinned mesh local frame, Three Y up',
        'colorSpace':'Official TripoSplat DC RGB inverse, matching PLY loader values',
        'jointsType':'uint8','weightsType':'float32-le','influencesPerSplat':4,
        'rigSha256':hashlib.sha256(args.rig.read_bytes()).hexdigest(),
        'inputSha256':hashlib.sha256(args.input.read_bytes()).hexdigest(),
        'selection':'Fixed rest-pose opacity times covariance volume to power one third, boosted for face, accessories, and dark detail',
        'alignment':{'linear':full_linear.tolist(),'translation':translation.tolist()},
        'accessories':accessory_metadata,
    }
    (published/(stem+'.json')).write_text(json.dumps(metadata,indent=2))
    print('PUBLISHED',str(published/(stem+'.json')),flush=True)

metrics = {
    'alignment':{'initial_yaw_deg':angle,'linear':full_linear.tolist(),'translation':translation.tolist(),'sample_chamfer_mse':score},
    'nearest_surface_distance':{str(q):float(np.quantile(nearest_distance,q)) for q in [0.5,0.9,0.95,0.99]},
    'bones':bone_names,'accessories':accessory_metadata,'selection_50000':'One constant rest-pose subset ranked by opacity times covariance volume to power one third, boosted for face, accessories, and dark detail','poses':[]
}
for clip,frame in [('rest',0),('idle',18),('walk',8),('walk',16),('walk',24),('spin',24)]:
    for track in rig.animation_data.nla_tracks:
        track.mute = track.name != clip
    rig.update_tag(refresh={'OBJECT','DATA','TIME'})
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    evaluated_rig = rig.evaluated_get(depsgraph)
    posed = np.array([evaluated_rig.matrix_world @ evaluated_rig.pose.bones[name].matrix for name in bone_names])
    transforms = posed @ rest_inverse
    blended = np.einsum('nb,bij->nij',weights,transforms)
    deformed = np.einsum('nij,nj->ni',blended[:,:3,:3],positions)+blended[:,:3,3]
    cov = blended[:,:3,:3] @ covariance @ np.transpose(blended[:,:3,:3],(0,2,1))
    label = clip+'-'+str(frame)
    evaluated_mesh = mesh.evaluated_get(depsgraph)
    mesh_positions = np.array([evaluated_mesh.matrix_world @ v.co for v in evaluated_mesh.data.vertices],dtype='<f4')
    (out/(label+'.mesh.bin')).write_bytes(mesh_positions.tobytes())
    save_ply(out/(label+'-65536.ply'),deformed,cov,65536)
    save_ply(out/(label+'-50000.ply'),deformed,cov,50000)
    displacement = np.linalg.norm(deformed-positions,axis=1)
    determinant = np.linalg.det(blended[:,:3,:3])
    metrics['poses'].append({'label':label,'finite':bool(np.isfinite(deformed).all() and np.isfinite(cov).all()),'displacement_median':float(np.median(displacement)),'displacement_p99':float(np.quantile(displacement,.99)),'negative_jacobian_fraction':float(np.mean(determinant<0)),'min_jacobian':float(determinant.min())})
    print('POSE', metrics['poses'][-1],flush=True)
metrics['elapsed_seconds'] = time.time()-started
(out/'metrics.json').write_text(json.dumps(metrics,indent=2))
print('BINDING_COMPLETE',json.dumps(metrics),flush=True)
