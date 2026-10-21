"""Batch rembg inference; one session shared by all selected frames."""
import base64
import importlib.util
import io
import json
import os
import sys
from pathlib import Path

if '--probe' in sys.argv:
    print(json.dumps({
        'available': importlib.util.find_spec('rembg') is not None and importlib.util.find_spec('onnxruntime') is not None,
        'modelCached': any(Path(os.environ.get('U2NET_HOME', '.models')).rglob('u2netp.onnx')),
    }))
    sys.exit(0)

from PIL import Image
from rembg import remove, new_session

payload = json.load(sys.stdin)
session = new_session('u2netp', providers=['CPUExecutionProvider'])
images = []
for uri in payload['images']:
    raw = base64.b64decode(uri.split(',', 1)[1], validate=True)
    image = Image.open(io.BytesIO(raw))
    if image.width > 1024 or image.height > 1024:
        raise ValueError('Input image exceeds 1024 pixels')
    rgba = remove(image, session=session).convert('RGBA')
    output = io.BytesIO()
    rgba.save(output, format='PNG')
    images.append('data:image/png;base64,' + base64.b64encode(output.getvalue()).decode('ascii'))
print(json.dumps({'images': images}))
