"""Optimize catalog images without changing dimensions, pixels, or metadata."""

import argparse
import ctypes as c
import io
import os
from pathlib import Path
import struct
import zlib

from PIL import Image


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def optimize_png(source):
    chunks = []
    payloads = []
    offset = len(PNG_SIGNATURE)
    while offset < len(source):
        size, kind = struct.unpack_from(">I4s", source, offset)
        end = offset + 12 + size
        chunks.append((kind, source[offset:end]))
        if kind == b"IDAT":
            payloads.append(source[offset + 8:end - 4])
        offset = end
    if not payloads or offset != len(source) or chunks[-1][0] != b"IEND":
        return source
    pixels = zlib.decompress(b"".join(payloads))
    data = zlib.compress(pixels, level=9)
    chunk = struct.pack(">I", len(data)) + b"IDAT" + data
    chunk += struct.pack(">I", zlib.crc32(chunk[4:]))
    result = []
    for kind, raw in chunks:
        if kind != b"IDAT":
            result.append(raw)
        elif chunk:
            result.append(chunk)
            chunk = b""
    return PNG_SIGNATURE + b"".join(result)


class Transform(c.Structure):
    _fields_ = [("region", c.c_int * 4), ("op", c.c_int), ("options", c.c_int),
                ("data", c.c_void_p), ("filter", c.c_void_p)]


def jpeg_optimizer(library):
    turbo = c.CDLL(str(library))
    turbo.tjInitTransform.restype = c.c_void_p
    turbo.tjTransform.argtypes = [
        c.c_void_p, c.c_char_p, c.c_ulong, c.c_int, c.POINTER(c.c_void_p),
        c.POINTER(c.c_ulong), c.POINTER(Transform), c.c_int,
    ]
    turbo.tjFree.argtypes = [c.c_void_p]
    turbo.tjDestroy.argtypes = [c.c_void_p]

    def optimize(source):
        handle = turbo.tjInitTransform()
        if not handle:
            return source
        try:
            results = [source]
            for options in (1 << 8, 1 << 5):  # Optimized Huffman, then progressive.
                output, length = c.c_void_p(), c.c_ulong()
                transform = Transform(options=options)
                try:
                    status = turbo.tjTransform(handle, source, len(source), 1,
                                               c.byref(output), c.byref(length), c.byref(transform), 0)
                    if status == 0 and output.value:
                        results.append(c.string_at(output, length.value))
                finally:
                    if output.value:
                        turbo.tjFree(output)
            return min(results, key=len)
        finally:
            turbo.tjDestroy(handle)

    return optimize


def equivalent(original, candidate):
    with Image.open(io.BytesIO(original)) as before, Image.open(io.BytesIO(candidate)) as after:
        frames = getattr(before, "n_frames", 1)
        if (before.mode, before.size, frames) != (after.mode, after.size, getattr(after, "n_frames", 1)):
            return False
        if before.format == "JPEG" and sorted(before.applist) != sorted(after.applist):
            return False
        for frame in range(frames):
            before.seek(frame)
            after.seek(frame)
            if before.convert("RGBA").tobytes() != after.convert("RGBA").tobytes():
                return False
        return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Image or directory to optimize")
    parser.add_argument("--turbojpeg", type=Path, help="Path to libturbojpeg for JPEG optimization")
    args = parser.parse_args()
    jpeg = jpeg_optimizer(args.turbojpeg.resolve()) if args.turbojpeg else None
    files = args.path.rglob("*") if args.path.is_dir() else [args.path]
    examined = changed = savings = total = 0
    for file in files:
        if not file.is_file() or file.is_symlink() or file.suffix.lower() not in {".png", ".jpg", ".jpeg", ".avif", ".ico", ".webp"}:
            continue
        original = file.read_bytes()
        examined += 1
        total += len(original)
        if original.startswith(PNG_SIGNATURE):
            optimized = optimize_png(original)
        elif original.startswith(b"\xff\xd8") and jpeg:
            optimized = jpeg(original)
        else:
            continue
        if len(optimized) >= len(original) or not equivalent(original, optimized):
            continue
        temporary = file.with_name(file.name + ".opt-tmp")
        with temporary.open("xb") as output:
            output.write(optimized)
        os.replace(temporary, file)
        changed += 1
        savings += len(original) - len(optimized)
    print(f"{examined} revisadas, {changed} optimizadas. {total} -> {total - savings} bytes.")


if __name__ == "__main__":
    main()
