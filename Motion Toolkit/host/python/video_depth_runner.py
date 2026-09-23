#!/usr/bin/env python3
"""
Runs a monocular depth model over a VIDEO FILE or an IMAGE SEQUENCE, writing
one depth frame per source frame into an output image sequence.

Spawned from client/js/modules/depth.js via child_process.spawn (same
out-of-process pattern as depth_runner.py - AE's ExtendScript engine can't
wait on a background process without freezing the UI).

Usage:
    python video_depth_runner.py --input IN_PATH [--frame-pattern GLOB |
                                 --first-frame N --last-frame M] \
                                 --output-dir DIR --model MODEL_KEY \
                                [--scale 1080] [--prefix NAME] [--ext png] \
                                [--start-number 0]

* A video file is decoded with OpenCV and downscaled so its HEIGHT equals
  --scale (default 1080 = 1080p) before inference - full-res video depth is
  very slow, and depth maps are typically used at working resolution anyway.
  Width is scaled proportionally to the nearest even number.
* An image sequence is passed through as-is: frames are read straight from
  disk in sorted order (the panel globs the sequence folder for us), so no
  decoding/downscaling step is involved. Frames are already whatever size
  they were authored at.
* Alpha: models only see RGB. If a source frame has alpha, the depth map is
  masked to that alpha (fully transparent pixels become black in the depth
  map) so the generated sequence lines up with the original's matte.

Progress: one line per processed frame on stdout, "PROGRESS <index>/<total>",
so the panel can show a live counter while the job runs.

One-time setup:
    pip install -r requirements.txt
The first run for a given model downloads its weights from Hugging Face and
caches them under ~/.cache/huggingface; later runs reuse that cache.
"""

import argparse
import os
import re
import sys
import traceback


def parse_args():
    parser = argparse.ArgumentParser(description="Generate a depth-map image sequence for a video or image sequence.")
    parser.add_argument("--input", required=True, help="Source video file path, or the first frame of an image sequence")
    parser.add_argument("--frame-pattern", default=None, help="Glob matching every frame of an image sequence (used instead of decoding --input as video)")
    parser.add_argument("--output-dir", required=True, help="Folder the depth frames are written into")
    parser.add_argument("--model", default="depth-anything-v2", help="Key into MODEL_REGISTRY (see depth_runner.py)")
    parser.add_argument("--scale", type=int, default=1080, help="Target height in px for video sources (default 1080 = 1080p). Ignored for image sequences.")
    parser.add_argument("--prefix", default="depth", help="Filename prefix for the output frames")
    parser.add_argument("--ext", default="png", help="Output frame extension (png keeps 8-bit lossless; exr needs extra deps)")
    parser.add_argument("--start-number", type=int, default=0, help="Frame number the output sequence starts at")
    return parser.parse_args()


def natural_key(path):
    """Sort helper so frame_2.png comes before frame_10.png."""
    parts = re.split(r"(\d+)", os.path.basename(path))
    return [int(p) if p.isdigit() else p.lower() for p in parts]


def collect_sequence_frames(pattern):
    import glob
    matches = glob.glob(pattern)
    return sorted(matches, key=natural_key)


def pick_device():
    """NVIDIA-CUDA-only (RTX 3060 target). Fails fast without a GPU;
    MOTION_TOOLKIT_ALLOW_CPU=1 forces CPU as an escape hatch."""
    import os
    try:
        import torch
        if torch.cuda.is_available():
            return 0
    except Exception:
        pass
    if os.environ.get("MOTION_TOOLKIT_ALLOW_CPU") == "1":
        print("WARNING: CUDA unavailable - running on CPU (slow).",
              file=sys.stderr, flush=True)
        return -1
    print("ERROR: No NVIDIA CUDA GPU detected. Install the NVIDIA driver and "
          "the cu121 wheels from requirements.txt "
          "(pip install -r requirements.txt), or set MOTION_TOOLKIT_ALLOW_CPU=1 "
          "to force CPU.", file=sys.stderr, flush=True)
    sys.exit(2)


def load_model(model_key):
    # Import inside functions so a missing heavy dependency produces the
    # readable stderr message below rather than a raw ImportError traceback.
    try:
        from transformers import pipeline
    except ImportError as err:
        print(f"Missing dependency ({err}). Run: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)

    # Lazy import to avoid a circular-dependency/order problem if this file
    # is ever moved: MODEL_REGISTRY lives in depth_runner.py beside it.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from depth_runner import MODEL_REGISTRY

    hf_model_id = MODEL_REGISTRY.get(model_key)
    if hf_model_id is None:
        print(f"Unknown model key '{model_key}'. Known keys: {', '.join(MODEL_REGISTRY)}", file=sys.stderr)
        sys.exit(1)

    device = pick_device()
    print(f"Loading {hf_model_id} (device={device})...", flush=True)
    estimate_depth = pipeline(task="depth-estimation", model=hf_model_id, device=device)
    return estimate_depth


def depth_to_pil(depth_map, rgb_array):
    """Normalize a transformers depth output to 0..255 uint8, keep the source
    frame's size, and mask by the source alpha when there is one."""
    import numpy as np
    from PIL import Image

    depth = np.asarray(depth_map, dtype=np.float32)
    finite = np.isfinite(depth)
    lo = float(depth[finite].min()) if finite.any() else 0.0
    hi = float(depth[finite].max()) if finite.any() else 1.0
    span = hi - lo
    if span <= 0:
        span = 1.0
    gray = np.clip((depth - lo) / span * 255.0, 0, 255).astype(np.uint8)
    img = Image.fromarray(gray, mode="L")

    if rgb_array is not None and rgb_array.shape[2] == 4:
        alpha = rgb_array[:, :, 3]
        # Depth values survive where the source is visible, transparent
        # pixels stay transparent in the depth map too.
        img = Image.merge("RGBA", (img, img, img, Image.fromarray(alpha, mode="L")))
    return img


def normalize_frame(arr):
    """BGR(A) ndarray -> (PIL RGB image for the model, original array kept for
    its alpha channel, or None)."""
    import numpy as np
    from PIL import Image

    if arr.shape[2] == 4:
        rgb = arr[:, :, :3][:, :, ::-1]  # BGRA -> RGB
        return Image.fromarray(np.ascontiguousarray(rgb), "RGB"), arr
    rgb = arr[:, :, :3][:, :, ::-1]
    return Image.fromarray(np.ascontiguousarray(rgb), "RGB"), None


def downscale_for_video(arr, target_height):
    import cv2

    h, w = arr.shape[:2]
    if target_height <= 0 or h <= target_height:
        return arr
    scale = target_height / float(h)
    new_w = max(2, int(round(w * scale / 2.0)) * 2)  # even width: friendlier to encoders
    return cv2.resize(arr, (new_w, target_height), interpolation=cv2.INTER_AREA)


def run_video(args, estimate_depth):
    import cv2

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        print(f"Could not open video '{args.input}' with OpenCV.", file=sys.stderr)
        sys.exit(1)

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or -1
    index = 0
    ok_count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame = downscale_for_video(frame, args.scale)
        pil, orig = normalize_frame(frame)
        depth_map = estimate_depth(pil)["depth"]
        out = depth_to_pil(depth_map, orig)
        out_path = os.path.join(args.output_dir, f"{args.prefix}_{index + args.start_number:04d}.{args.ext}")
        out.save(out_path)
        ok_count += 1
        index += 1
        print(f"PROGRESS {index}/{total if total > 0 else '?'}", flush=True)
    cap.release()
    print(f"Wrote {ok_count} depth frames to {args.output_dir}")


def run_sequence(args, estimate_depth):
    from PIL import Image

    frames = collect_sequence_frames(args.frame_pattern)
    if not frames:
        print(f"No sequence frames matched pattern '{args.frame_pattern}'.", file=sys.stderr)
        sys.exit(1)

    total = len(frames)
    for index, frame_path in enumerate(frames):
        img = Image.open(frame_path)
        has_alpha = img.mode in ("RGBA", "LA", "PA")
        rgba = img.convert("RGBA") if has_alpha else None
        rgb = (rgba or img).convert("RGB")
        depth_map = estimate_depth(rgb)["depth"]

        out = depth_to_pil_from_pil(depth_map, rgba)
        out_path = os.path.join(args.output_dir, f"{args.prefix}_{index + args.start_number:04d}.{args.ext}")
        out.save(out_path)
        print(f"PROGRESS {index + 1}/{total}", flush=True)

    print(f"Wrote {total} depth frames to {args.output_dir}")


def depth_to_pil_from_pil(depth_map, rgba_image):
    """Same normalization as depth_to_pil but taking the alpha straight from
    an already-loaded PIL RGBA frame (image-sequence path)."""
    import numpy as np
    from PIL import Image

    depth = np.asarray(depth_map, dtype=np.float32)
    finite = np.isfinite(depth)
    lo = float(depth[finite].min()) if finite.any() else 0.0
    hi = float(depth[finite].max()) if finite.any() else 1.0
    span = hi - lo
    if span <= 0:
        span = 1.0
    gray = np.clip((depth - lo) / span * 255.0, 0, 255).astype(np.uint8)
    img = Image.fromarray(gray, mode="L")

    if rgba_image is not None and rgba_image.mode == "RGBA":
        alpha = rgba_image.split()[3].resize(img.size)
        img = Image.merge("RGBA", (img, img, img, alpha))
    return img


def main():
    args = parse_args()
    try:
        os.makedirs(args.output_dir, exist_ok=True)
    except Exception as err:
        print(f"Could not create output dir '{args.output_dir}': {err}", file=sys.stderr)
        sys.exit(1)

    estimate_depth = load_model(args.model)

    try:
        if args.frame_pattern:
            run_sequence(args, estimate_depth)
        else:
            run_video(args, estimate_depth)
    except SystemExit:
        raise
    except Exception:
        print("Depth generation failed:\n" + traceback.format_exc(), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
