#!/usr/bin/env python3
"""
Runs a monocular depth model on a single still image.

Spawned from client/js/modules/depth.js via child_process.spawn - never run
directly from ExtendScript, since AE's ExtendScript engine can't run a
background process without blocking the whole application.

Usage:
    python depth_runner.py --input IN_PATH --output OUT_PATH --model MODEL_KEY

MODEL_KEY is one of the keys in MODEL_REGISTRY below. It's the same string
the Settings tab's model dropdown stores (see client/js/lib/depth-config.js)
and passes straight through as this --model argument.

To add a new model: add one line to MODEL_REGISTRY (any model transformers'
AutoModelForDepthEstimation supports will work, since Depth Anything and
MiDaS/DPT all go through the exact same pipeline() call below) and a
matching entry in depth-config.js's MODELS array so it shows up in the
dropdown. No other code needs to change.

One-time setup:
    pip install -r requirements.txt
The first run for a given model downloads its weights from Hugging Face and
caches them under ~/.cache/huggingface; later runs reuse that cache.
"""

import argparse
import sys

# key -> Hugging Face model id. Depth Anything V1/V2 and MiDaS (as
# Intel/dpt-hybrid-midas) are all DPT-family checkpoints supported by
# transformers' AutoModelForDepthEstimation, so they share one inference
# path below - swapping models is just swapping this id.
#
# "Small" is used for the Depth Anything entries rather than Base/Large:
# it's noticeably faster for an interactive AE panel, and - for V2
# specifically - is the one Apache-2.0 checkpoint (Base/Large/Giant are
# CC-BY-NC-4.0). Point at a Base/Large id instead if you want more accuracy
# and don't mind the slower, non-commercial-licensed trade-off.
MODEL_REGISTRY = {
    "depth-anything-v2": "depth-anything/Depth-Anything-V2-Small-hf",
    "depth-anything-v1": "LiheYoung/depth-anything-small-hf",
    "midas": "Intel/dpt-hybrid-midas",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Generate a depth map for one still image.")
    parser.add_argument("--input", required=True, help="Source image path")
    parser.add_argument("--output", required=True, help="Where to write the depth map (e.g. a .png path)")
    parser.add_argument("--model", default="depth-anything-v2", help="Key into MODEL_REGISTRY")
    return parser.parse_args()


def pick_device():
    """Best available torch device, as the `device` value pipeline() expects.
    Falls back to CPU (-1) if torch/CUDA/MPS aren't available - inference
    still works, just slower."""
    try:
        import torch
        if torch.cuda.is_available():
            return 0
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return "mps"
    except Exception:
        pass
    return -1


def main():
    args = parse_args()

    hf_model_id = MODEL_REGISTRY.get(args.model)
    if hf_model_id is None:
        print(f"Unknown model key '{args.model}'. Known keys: {', '.join(MODEL_REGISTRY)}", file=sys.stderr)
        sys.exit(1)

    try:
        from transformers import pipeline
        from PIL import Image
    except ImportError as err:
        print(f"Missing dependency ({err}). Run: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)

    try:
        image = Image.open(args.input).convert("RGB")
    except Exception as err:
        print(f"Could not open input image '{args.input}': {err}", file=sys.stderr)
        sys.exit(1)

    device = pick_device()
    print(f"Loading {hf_model_id} (device={device})...", flush=True)
    try:
        estimate_depth = pipeline(task="depth-estimation", model=hf_model_id, device=device)
        depth_map = estimate_depth(image)["depth"]
    except Exception as err:
        print(f"Depth inference failed: {err}", file=sys.stderr)
        sys.exit(1)

    try:
        depth_map.save(args.output)
    except Exception as err:
        print(f"Could not write output '{args.output}': {err}", file=sys.stderr)
        sys.exit(1)

    print(f"Saved depth map to {args.output}")


if __name__ == "__main__":
    main()
