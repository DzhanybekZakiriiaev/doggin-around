#!/usr/bin/env bash
set -euo pipefail
export CUDA_HOME=/usr/local/cuda
export PATH="$CUDA_HOME/bin:$PATH"
export HF_HOME=/workspace/huggingface
export TORCH_HOME=/workspace/torch-cache
export PIP_CACHE_DIR=/workspace/pip-cache
export ATTN_BACKEND=sdpa
export SPARSE_ATTN_BACKEND=xformers
export MAX_JOBS=4
cd /workspace
if [ ! -d AniGen ]; then
  git clone --recurse-submodules https://github.com/VAST-AI-Research/AniGen.git
fi
cd AniGen
git checkout "${ANIGEN_REVISION:-c49db3d6b466537a02ccf2286688903d77af7e4f}"
git submodule update --init --recursive
python -m pip install uv
if [ ! -x .venv/bin/python ]; then
  uv venv --python python3.10 .venv
fi
source .venv/bin/activate
export TORCH_VERSION=2.4.0
uv pip install setuptools wheel ninja
uv pip install torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu118
uv pip install xformers==0.0.27.post2 --index-url https://download.pytorch.org/whl/cu118
if [ ! -d /workspace/pytorch3d ]; then
  git clone --depth 1 --branch v0.7.9 https://github.com/facebookresearch/pytorch3d.git /workspace/pytorch3d
fi
uv pip install /workspace/pytorch3d --no-build-isolation
if [ ! -d /workspace/nvdiffrast ]; then
  git clone --depth 1 --branch v0.3.3 https://github.com/NVlabs/nvdiffrast.git /workspace/nvdiffrast
fi
uv pip install /workspace/nvdiffrast --no-build-isolation --reinstall-package nvdiffrast
source ./setup.sh --torch --basic
uv pip install rtree
python -c 'from anigen.utils.ckpt_utils import ensure_ckpts
ensure_ckpts()'
git rev-parse HEAD > /workspace/anigen-revision.txt
uv pip freeze > /workspace/anigen-requirements.txt
echo "ANIGEN_SETUP_READY"
