import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

parser = argparse.ArgumentParser(description='Run pinned official TripoSplat inference and export parameters')
parser.add_argument('--source',type=Path,required=True)
parser.add_argument('--weights',type=Path,required=True)
parser.add_argument('--image',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args = parser.parse_args()
sys.path.insert(0,str(args.source.resolve()))

import numpy as np
import torch
from triposplat import TripoSplatPipeline

args.output.mkdir(parents=True,exist_ok=True)
weights = args.weights.resolve()
pipe = TripoSplatPipeline(
    ckpt_path=str(weights/'diffusion_models/triposplat_fp16.safetensors'),
    decoder_path=str(weights/'vae/triposplat_vae_decoder_fp16.safetensors'),
    dinov3_path=str(weights/'clip_vision/dino_v3_vit_h.safetensors'),
    flux2_vae_encoder_path=str(weights/'vae/flux2-vae.safetensors'),
    rmbg_path=str(weights/'background_removal/birefnet.safetensors'),
    device='cuda',
)
torch.cuda.reset_peak_memory_stats()
started = time.time()
counts = [65536,131072,262144]
gaussians,prepared = pipe.run(
    str(args.image.resolve()),seed=42,steps=20,guidance_scale=3.0,shift=3.0,
    num_gaussians=counts,show_progress=True,
)
prepared.save(args.output/'preprocessed.png')
summary = {
    'expected_source_revision':'d8db9e018b413dd9c4a9fe22463781bf98e8e68d',
    'expected_weight_revision':'56a96e603204ec410c4da60c13ea4fa09a2169a9',
    'input_sha256':hashlib.sha256(args.image.read_bytes()).hexdigest(),
    'seed':42,'steps':20,'guidance_scale':3.0,'shift':3.0,
    'inference_decode_seconds':time.time()-started,
    'peak_allocated_vram_gb':torch.cuda.max_memory_allocated()/1e9,
    'torch':torch.__version__,'cuda':torch.version.cuda,'assets':[],
}
for count,gaussian in zip(counts,gaussians):
    stem = args.output/('dog-'+str(count))
    gaussian.save_ply(str(stem.with_suffix('.ply')))
    gaussian.save_splat(str(stem.with_suffix('.splat')))
    xyz,rotation = gaussian._transformed_xyz_rot()
    scales = gaussian.get_scaling.detach().cpu().numpy()
    opacity = gaussian.get_opacity.detach().cpu().numpy()
    color = (gaussian._features_dc[:,0,:].detach().cpu().numpy()*0.28209479177387814+0.5).clip(0,1)
    np.savez_compressed(stem.with_suffix('.npz'),xyz=xyz,rotation=rotation,scales=scales,opacity=opacity,color=color)
    summary['assets'].append({
        'count':int(len(xyz)),
        'finite_xyz':bool(np.isfinite(xyz).all()),
        'ply_sha256':hashlib.sha256(stem.with_suffix('.ply').read_bytes()).hexdigest(),
    })
(args.output/'generation.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary),flush=True)
