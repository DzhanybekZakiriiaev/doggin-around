# BITE initialization

Run the author checkpoint and test-time fit in the isolated GPU environment created for this research demo.

```bash
python scripts/bite/run.py \
  --bite-source /workspace/bite \
  --image /workspace/tricolor/original.png \
  --output /workspace/tricolor/bite-fit \
  --steps 301
```

The source and model data come from the [author's Hugging Face Space](https://huggingface.co/spaces/runa91/bite_gradio/tree/4b24155a5bf43ea09b2280386e69783f7af6fab8). The runner uses the original refinement config, `forrelease_v0` checkpoint, and `bite_loss_weights_ttopt.json`. Vertex offsets start at iteration 150, matching the published procedure.

The source directory must include `src`, `data`, the `forrelease_v0` checkpoint, and `checkpoint/barc_normflow_pret/rgbddog_v3_model.pt`. The core `ImgCrops` dataset supplies the published crop and normalization constants.

`compat.py` updates the renderer's camera version guard and legacy vertex texture API for PyTorch3D 0.7.9. It also replaces Pillow's removed image type helper. These edits apply only to the downloaded source checkout.

The runner requires a loaded checkpoint, a working CUDA rasterizer with finite gradients, finite image inference, and a finite optimizer step. `gates.json` records these checks and the completed step count.

Outputs:

- `fit.npz` contains fitted shape, limb scales, local joint rotation matrices, camera translation and focal length, compact and full symmetric offsets, vertices, and faces
- `canonical.npz` preserves the fitted shape and offsets with identity local rotations, zero native translation, and normalized standing vertices in a right-handed Y-up frame facing -Z
- `smal_model.npz` preserves the dense skin weights, shape and pose bases, joint regressor, scale mask, parent indices, and topology for full SMAL evaluation
- OBJ meshes, silhouette images, the fitted overlay, and a canonical preview support inspection
- `optimization.json` and `loss-weights.json` preserve fit evidence

The `coordinate_transform` in `canonical.npz` maps native BITE vertices to the canonical frame. `native_verts` and rotation parameters remain in the author's native frame. Each full offset is applied before joint regression and pose blend shapes.

Keep downloaded licensed models and generated research meshes under ignored local asset directories. The [BITE license](https://github.com/runa91/bite_release/blob/main/LICENSE) governs their use and redistribution.
