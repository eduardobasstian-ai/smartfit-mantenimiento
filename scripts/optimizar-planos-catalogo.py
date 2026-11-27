"""Create smaller lossless plan derivatives; retain originals and verify decoded pixels."""
import io
import json
import re
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'catalogo'
sources = [root / 'catalogo-assets/mtm3839-datos.js', *sorted((root / 'catalogo-assets').rglob('datos.js'))]
report = []
for data in sources:
    source = data.read_text(encoding='utf-8')
    def replace(match):
        relative = match[2]
        original = (root / relative).resolve()
        if not original.is_relative_to(root.resolve()) or not original.is_file():
            return match[0]
        with Image.open(original) as image:
            # Color-space PNG chunks without a WebP equivalent must remain untouched.
            if getattr(image, 'n_frames', 1) != 1 or set(image.info) - {'icc_profile', 'exif', 'dpi'}:
                return match[0]
            buffer = io.BytesIO()
            metadata = {key: image.info[key] for key in ('icc_profile','exif') if image.info.get(key)}
            image.save(buffer, format='WEBP', lossless=True, exact=True, method=6, **metadata)
            candidate = buffer.getvalue()
            if len(candidate) >= original.stat().st_size:
                return match[0]
            with Image.open(io.BytesIO(candidate)) as decoded:
                if decoded.size != image.size or decoded.convert('RGBA').tobytes() != image.convert('RGBA').tobytes():
                    raise ValueError('Cambió la imagen: ' + relative)
                if any(decoded.info.get(key) != value for key, value in metadata.items()):
                    raise ValueError('Cambió el perfil: ' + relative)
            target = original.with_suffix('.webp')
            target.write_bytes(candidate)
            report.append({'path':relative, 'before':original.stat().st_size,'after':len(candidate),'width':image.width,'height':image.height})
            return match[1] + relative[:-4] + '.webp' + match[3]
    updated = re.sub(r'("image"\s*:\s*")(catalogo-assets/[^"\n]+\.png)(")', replace, source)
    if updated != source:
        data.write_text(updated, encoding='utf-8')
print(json.dumps({'plans':report,'bytes_before':sum(r['before'] for r in report),'bytes_after':sum(r['after'] for r in report)},ensure_ascii=False))
