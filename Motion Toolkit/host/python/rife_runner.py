#!/usr/bin/env python3
"""
Frame-interpolates a VIDEO FILE or an IMAGE SEQUENCE with RIFE, writing an
output image sequence. Alpha is preserved end-to-end: frames are split into
RGB + A, only RGB goes through the network, and the nearest source frame's
alpha channel is re-attached to every output frame (RIFE itself has no
transparency support in any released version - NVIDIA's "NVIDIA/Practical-RIFE"
v4.x lineage is what --model defaults to here).

Spawned from client/js/modules/playback.js via child_process.spawn when the
footer PLAY button is used - same out-of-process pattern as depth_runner.py,
so After Effects' UI thread never waits on the GPU.

Usage:
    python rife_runner.py --input IN_PATH [--frame-pattern GLOB] \
                          --output-dir DIR --multiplier 2 \
                         [--model rife-nvidia-4.0] [--scale 1080] \
                         [--prefix NAME] [--ext png] [--start-number 0]

Model resolution for --model (keys live in client/js/lib/depth-config.js's
RIFE_MODELS list, mirroring the depth MODEL_REGISTRY pattern):
  1. If RIFE_MODELS_DIR (defaults to <extension>/rife-models) contains a
     folder named after the key, load the pruned-RIFE .pth inside it using
     the official Practical-RIFE code (train_log/IFNet_HDv3.py's RIFE class)
     found next to the weights or vendored under this script's directory.
     The weights are intentionally NOT committed (they're hundreds of MB);
     download e.g. https://github.com/megvii-research/Practical-RIFE
     release "4.25" (the public successor of the NVIDIA v4.0 line) and drop
     its `train_log` contents into rife-models/rife-nvidia-4.0/.
  2. Otherwise try loading the value as a Hugging Face repo id through
     diffusers (optional dependency; not in requirements.txt).
If neither works, the job fails loudly with instructions - there is NO
silent blending fallback, since a fake "interpolation" result is worse than
an error telling you to install the model.

--scale caps the HEIGHT of the frames fed to / produced by RIFE (default
1080 = 1080p), matching video_depth_runner.py's convention.

Progress: "PROGRESS <index>/<total>" lines on stdout per produced frame.
"""

import argparse
import os
import shutil
import sys
import tempfile
import traceback


def parse_args():
    parser = argparse.ArgumentParser(description="RIFE frame interpolation for video / image sequences.")
    parser.add_argument("--input", required=True, help="Source video file path, or first frame of an image sequence")
    parser.add_argument("--frame-pattern", default=None, help="Glob matching every frame of an image sequence")
    parser.add_argument("--output-dir", required=True, help="Folder the interpolated frames are written into")
    parser.add_argument("--multiplier", type=int, default=2, help="Interpolation factor: 2, 4, 8, 16 (applied repeatedly)")
    parser.add_argument("--model", default="rife-nvidia-4.0", help="Key resolved under rife-models/, or a Hugging Face repo id")
    parser.add_argument("--scale", type=int, default=1080, help="Max height in px fed to RIFE (default 1080)")
    parser.add_argument("--prefix", default="interp", help="Filename prefix for output frames")
    parser.add_argument("--ext", default="png", help="Output frame extension")
    parser.add_argument("--start-number", type=int, default=0, help="First output frame number")
    return parser.parse_args()


def here():
    return os.path.dirname(os.path.abspath(__file__))


def models_dir():
    env = os.environ.get("RIFE_MODELS_DIR")
    if env:
        return env
    # .../Motion Toolkit/host/python -> .../Motion Toolkit/rife-models
    return os.path.normpath(os.path.join(here(), "..", "..", "rife-models"))


def natural_key(path):
    import re
    parts = re.split(r"(\d+)", os.path.basename(path))
    return [int(p) if p.isdigit() else p.lower() for p in parts]


def collect_inputs(args):
    """Return (list_of_frame_paths_or_None, video_path_or_None)."""
    if args.frame_pattern:
        import glob
        frames = sorted(glob.glob(args.frame_pattern), key=natural_key)
        if not frames:
            print(f"No sequence frames matched pattern '{args.frame_pattern}'.", file=sys.stderr)
            sys.exit(1)
        return frames, None
    return None, args.input


def downscale_pil(img, target_height):
    w, h = img.size
    if target_height <= 0 or h <= target_height:
        return img
    scale = target_height / float(h)
    new_w = max(2, int(round(w * scale / 2.0)) * 2)
    return img.resize((new_w, target_height), Image_LANCZOS())


def Image_LANCZOS():
    from PIL import Image
    return Image.LANCZOS


def dump_frames_to_dir(args, work_dir):
    """Normalize both input types into one flat directory of numbered PNGs
    (RGBA when the source had alpha). Returns (names_in_order, had_alpha)."""
    import cv2
    import numpy as np
    from PIL import Image

    frame_paths, video_path = collect_inputs(args)
    names = []
    had_alpha = False

    if frame_paths is not None:
        for index, src in enumerate(frame_paths):
            img = Image.open(src)
            if img.mode in ("RGBA", "LA", "PA"):
                had_alpha = True
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            img = downscale_pil(img, args.scale)
            name = f"in_{index:06d}.png"
            img.save(os.path.join(work_dir, name))
            names.append(name)
        return names, had_alpha

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Could not open video '{video_path}' with OpenCV.", file=sys.stderr)
        sys.exit(1)
    index = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame.shape[2] == 4:
            had_alpha = True
            arr = cv2.cvtColor(frame, cv2.COLOR_BGRA2RGBA)
        else:
            arr = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(np.ascontiguousarray(arr))
        img = downscale_pil(img, args.scale)
        name = f"in_{index:06d}.png"
        img.save(os.path.join(work_dir, name))
        names.append(name)
        index += 1
    cap.release()
    if not names:
        print(f"Video '{video_path}' decoded to zero frames.", file=sys.stderr)
        sys.exit(1)
    return names, had_alpha


def load_rife(model_key):
    """Returns (model, device_str) or raises SystemExit with instructions."""
    root = os.path.join(models_dir(), model_key)
    weight_file = None
    if os.path.isdir(root):
        candidates = []
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                if fn.endswith(".pth"):
                    candidates.append(os.path.join(dirpath, fn))
        if candidates:
            candidates.sort(key=lambda p: (0 if "flownet" in os.path.basename(p).lower() else 1, p))
            weight_file = candidates[0]

    if weight_file is not None:
        try:
            import torch
            from train_code.IFNet_HDv3 import RIFE  # vendored copy beside this file
        except ImportError:
            try:
                sys.path.insert(0, os.path.dirname(weight_file))
                sys.path.insert(0, root)
                from IFNet_HDv3 import RIFE  # official Practical-RIFE layout
                import torch
            except ImportError as err:
                print(
                    f"Found weights at {weight_file} but could not import the RIFE network code ({err}).\n"
                    "Copy IFNet_HDv3.py from https://github.com/megvii-research/Practical-RIFE "
                    f"next to the .pth file (or into {here()}/train_code/).",
                    file=sys.stderr,
                )
                sys.exit(1)

        sd = torch.load(weight_file, map_location="cpu")
        if isinstance(sd, dict) and "state_dict" in sd:
            sd = {k.replace("module.", ""): v for k, v in sd["state_dict"].items()}
        model = RIFE()
        model.load_state_dict(sd, strict=False)
        model.eval()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model.to(device)
        print(f"Loaded local RIFE weights: {weight_file} (device={device})", flush=True)
        return model, device

    # No local weights - try Hugging Face via diffusers (optional dependency).
    try:
        from diffusers.pipelines import DiffusionPipeline
    except ImportError:
        print(
            "RIFE model not found.\n"
            f"Option 1 (recommended): download Practical-RIFE v4.x weights and place them under\n"
            f"           {root}\n"
            "           (set RIFE_MODELS_DIR to override that location)\n"
            "Option 2: pip install diffusers, then pass --model <huggingface-repo-id>.",
            file=sys.stderr,
        )
        sys.exit(1)

    pipe = DiffusionPipeline.from_pretrained(model_key)
    device = "cuda" if getattr(pipe, "_execution_device", "cpu").startswith("cuda") else "cpu"
    print(f"Loaded RIFE from Hugging Face: {model_key} (device={device})", flush=True)
    return pipe, device


def to_tensor(path, device, half):
    import numpy as np
    import torch
    from PIL import Image

    arr = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    t = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(device)
    if half:
        t = t.half()
    return t


def interpolate_pair(model, a_path, b_path, device, half):
    import torch

    a = to_tensor(a_path, device, half)
    b = to_tensor(b_path, device, half)
    with torch.no_grad():
        out = model(a, b, 0.5)
    if isinstance(out, (tuple, list)):
        out = out[0]
    return out.squeeze(0).float().permute(1, 2, 0).clamp_(0, 1).mul_(255).byte().cpu().numpy()


def main():
    args = parse_args()
    if args.multiplier & (args.multiplier - 1) or args.multiplier < 2:
        print(f"--multiplier must be a power of two >= 2 (got {args.multiplier}).", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)
    work_dir = tempfile.mkdtemp(prefix="rife_work_")
    try:
        names, had_alpha = dump_frames_to_dir(args, work_dir)

        passes = 0
        m = args.multiplier
        while m > 1:
            m //= 2
            passes += 1

        model, device = load_rife(args.model)
        half = device == "cuda"

        current = [os.path.join(work_dir, n) for n in names]
        total_mids = (len(names) - 1) * args.multiplier
        done = 0

        for p in range(passes):
            merged = []
            for i in range(len(current) - 1):
                merged.append(current[i])
                mid_np = interpolate_pair(model, current[i], current[i + 1], device, half)
                from PIL import Image

                mid_path = os.path.join(work_dir, f"pass{p}_mid_{i:06d}.png")
                Image.fromarray(mid_np).save(mid_path)
                merged.append(mid_path)
                done += 1
                print(f"PROGRESS {done}/{total_mids}", flush=True)
            merged.append(current[-1])
            current = merged

        # Re-attach alpha from the nearest source frame (models/RIFE see RGB only).
        from PIL import Image

        for index, src_path in enumerate(current):
            src = Image.open(src_path)
            if had_alpha:
                alpha_img = Image.open(os.path.join(work_dir, names[min(index, len(names) - 1)]))
                if alpha_img.mode == "RGBA":
                    src = src.convert("RGB")
                    src = Image.merge("RGBA", (*src.split(), alpha_img.split()[3]))
            out_path = os.path.join(args.output_dir, f"{args.prefix}_{index + args.start_number:04d}.{args.ext}")
            src.save(out_path)

        print(f"Wrote {len(current)} interpolated frames to {args.output_dir}")
    except SystemExit:
        raise
    except Exception:
        print("RIFE interpolation failed:\n" + traceback.format_exc(), file=sys.stderr)
        sys.exit(1)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
