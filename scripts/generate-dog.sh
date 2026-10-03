#!/usr/bin/env bash
set -euo pipefail
export CUDA_HOME=/usr/local/cuda
export PATH="$CUDA_HOME/bin:$PATH"
export HF_HOME=/workspace/huggingface
export TORCH_HOME=/workspace/torch-cache
export ATTN_BACKEND=sdpa
export SPARSE_ATTN_BACKEND=xformers
cd /workspace/AniGen
source .venv/bin/activate
python example.py --image_path "${1:-assets/cond_images/dog.png}" --output_dir /workspace/dog-output --output_name dog --seed 42
python - "${1:-assets/cond_images/dog.png}" <<'PY'
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
import torch

Path('/workspace/dog-output/generation.json').write_text(json.dumps({
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'anigen_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'pytorch_version': torch.__version__,
    'cuda_runtime': torch.version.cuda,
    'gpu': torch.cuda.get_device_name(),
    'seed': 42,
    'command': ['python', 'example.py', '--image_path', sys.argv[1], '--output_dir',
                '/workspace/dog-output', '--output_name', 'dog', '--seed', '42'],
    'models': ['ss_flow_solo', 'slat_flow_auto'],
    'attention': {'dense': 'sdpa', 'sparse': 'xformers'},
}, indent=2))
PY
echo "DOG_GENERATION_READY"
