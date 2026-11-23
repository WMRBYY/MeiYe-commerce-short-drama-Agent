"""SAM 2.1 foreground masks for explicitly selected subjects; no model downloads."""
import argparse
from contextlib import contextmanager
import gc
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


@contextmanager
def device_lock(path, timeout=1200):
    """Serialize inference across worker processes sharing the same GPU lock path."""
    with open(path, "a+b") as lock:
        lock.seek(0, os.SEEK_END)
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        deadline = time.monotonic() + timeout
        while True:
            try:
                lock.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    raise TimeoutError("GPU inference slot is busy; retry later")
                time.sleep(0.25)
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == "nt":
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def parse_box(value):
    box = json.loads(value)
    if (not isinstance(box, list) or len(box) != 4
            or any(not isinstance(v, (int, float)) or not math.isfinite(v)
                   or v < 0 or v > 1 for v in box)
            or box[2] <= 0 or box[3] <= 0
            or box[0] + box[2] > 1 or box[1] + box[3] > 1):
        raise ValueError("invalid normalized subject box")
    return box


def runtime(args):
    checkpoint = Path(args.checkpoint)
    if not checkpoint.is_file() or checkpoint.stat().st_size < 1024:
        raise RuntimeError("SAM 2 checkpoint is missing")
    import torch
    from sam2.build_sam import build_sam2_video_predictor
    from hydra import compose
    # Resolve config without instantiating the model or downloading weights.
    compose(config_name=args.config)
    if not torch.cuda.is_available():
        raise RuntimeError("SAM 2 worker requires an available CUDA GPU")
    return torch, build_sam2_video_predictor


def render(args):
    torch, build_predictor = runtime(args)
    import numpy as np
    from PIL import Image
    box = parse_box(args.box)
    source, output = Path(args.input).resolve(), Path(args.output).resolve()
    if not source.is_file() or source == output:
        raise ValueError("invalid input/output paths")
    partial = output.with_name(output.stem + ".partial.mkv")
    encoder = None
    try:
        with tempfile.TemporaryDirectory(prefix="sam2-", dir=output.parent) as temporary:
            work = Path(temporary)
            frames = work / "frames"
            frames.mkdir()
            # Input was normalized by Go: 30 fps, square pixels, same dimensions as output.
            subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                            "-i", str(source), "-map", "0:v:0", "-q:v", "3",
                            "-start_number", "0", str(frames / "%06d.jpg")],
                           check=True, timeout=600)
            images = sorted(frames.glob("*.jpg"))
            if not images or len(images) > 9001:
                raise ValueError("video must contain 1 to 9001 frames")
            with Image.open(images[0]) as first:
                width, height = first.size
            predictor = build_predictor(args.config, str(Path(args.checkpoint).resolve()),
                                        device="cuda", apply_postprocessing=True)
            encoder = subprocess.Popen([
                args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-f", "rawvideo", "-pixel_format", "gray", "-video_size", f"{width}x{height}",
                "-framerate", "30", "-i", "pipe:0", "-an", "-c:v", "ffv1",
                "-pix_fmt", "gray", str(partial)], stdin=subprocess.PIPE)
            previous = None
            written = 0
            start = 0
            precision = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            with torch.inference_mode(), torch.autocast("cuda", dtype=precision):
                while start < len(images):
                    end = min(start + 120, len(images))
                    chunk = work / "chunk"
                    chunk.mkdir()
                    for i, image in enumerate(images[start:end]):
                        os.link(image, chunk / f"{i:06d}.jpg")
                    state = predictor.init_state(video_path=str(chunk),
                                                 offload_video_to_cpu=True,
                                                 offload_state_to_cpu=True)
                    if previous is None:
                        x, y, w, h = box
                        prompt = np.array([x * width, y * height,
                                           (x + w) * width, (y + h) * height], dtype=np.float32)
                        predictor.add_new_points_or_box(state, frame_idx=0, obj_id=1, box=prompt)
                    else:
                        # The first frame overlaps the preceding chunk exactly. Carry its mask
                        # across the boundary, so CPU frame tensors stay bounded to 120 frames.
                        predictor.add_new_mask(state, frame_idx=0, obj_id=1, mask=previous)
                    count = 0
                    for frame_index, object_ids, logits in predictor.propagate_in_video(state):
                        if frame_index != count or len(object_ids) != 1:
                            raise RuntimeError("SAM 2 returned discontinuous mask frames")
                        mask = (logits[0, 0] > 0).cpu().numpy()
                        if mask.shape != (height, width):
                            raise RuntimeError("SAM 2 mask resolution mismatch")
                        if written == 0 and not (0.001 < float(mask.mean()) < 0.98):
                            raise RuntimeError("subject selection did not produce a usable foreground")
                        if start == 0 or frame_index > 0:
                            encoder.stdin.write((mask.astype(np.uint8) * 255).tobytes())
                            written += 1
                        previous = mask
                        count += 1
                    if count != end - start:
                        raise RuntimeError("SAM 2 did not finish every frame")
                    predictor.reset_state(state)
                    del state
                    gc.collect()
                    torch.cuda.empty_cache()
                    shutil.rmtree(chunk)
                    if end == len(images):
                        break
                    start = end - 1
            encoder.stdin.close()
            if encoder.wait(timeout=120) != 0 or written != len(images):
                raise RuntimeError("mask encoding failed or produced an incomplete video")
            encoder = None
            os.replace(partial, output)
            print(json.dumps({"frames": written, "width": width, "height": height}))
    finally:
        if encoder is not None:
            if encoder.stdin and not encoder.stdin.closed:
                try:
                    encoder.stdin.close()
                except BrokenPipeError:
                    pass
            encoder.kill()
            encoder.wait()
        partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--config", default="configs/sam2.1/sam2.1_hiera_s.yaml")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--box")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--lock-file", default=os.environ.get(
        "CANVAS_SHOP_CLIP_GPU_LOCK", str(Path(tempfile.gettempdir()) / "yingce-sam2-gpu.lock")))
    args = parser.parse_args()
    if args.check:
        torch, _ = runtime(args)
        checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
        if not isinstance(checkpoint, dict) or not checkpoint.get("model"):
            raise RuntimeError("SAM 2 checkpoint contains no model state")
        print('{"ready": true}')
    else:
        if not all([args.input, args.output, args.box]):
            parser.error("--input, --output and --box are required")
        with device_lock(args.lock_file):
            render(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"mask worker failed: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
