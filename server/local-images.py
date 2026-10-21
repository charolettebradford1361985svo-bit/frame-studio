"""Small ncnn models, one frame at a time. No torch/CUDA installation."""
import base64
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ESR = ROOT / '.tools/esrgan/realesrgan-ncnn-vulkan-v0.2.0-windows'
RIFE = ROOT / '.tools/rife/rife-ncnn-vulkan-20221029-windows'

def decode(uri):
    image = Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1], validate=True)))
    if image.width > 1024 or image.height > 1024:
        raise ValueError('本地轻量处理限制每帧最长边 1024 px')
    image.load()
    return image.convert('RGBA')

def run(args, cwd):
    result = subprocess.run([str(item) for item in args], cwd=cwd, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode != 0:
        raise RuntimeError('本地模型运行失败，请检查 Vulkan 显卡驱动和模型文件')

def encode(image):
    output = io.BytesIO()
    image.save(output, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode('ascii')

payload = json.load(sys.stdin)
operation, options = payload['operation'], payload.get('options', {})
images = [decode(uri) for uri in payload['images']]
results = []
# Files are private per job and automatically removed by TemporaryDirectory.
with tempfile.TemporaryDirectory(prefix='frame-studio-') as folder:
    tmp = Path(folder)
    if operation == 'upscale':
        scale = options.get('scale', 2)
        if scale not in (2, 4):
            raise ValueError('高清只支持 2× 或 4×')
        for image in images:
            image.convert('RGB').save(tmp / 'input.png')
            run([ESR / 'realesrgan-ncnn-vulkan.exe', '-i', tmp / 'input.png', '-o', tmp / 'output.png',
                 '-m', ESR / 'models', '-n', 'realesr-animevideov3', '-s', scale, '-t', 64, '-j', '1:1:1'], ESR)
            with Image.open(tmp / 'output.png') as output:
                rgba = output.convert('RGBA')
            if rgba.size != (image.width * scale, image.height * scale):
                raise RuntimeError('高清输出尺寸异常')
            rgba.putalpha(image.getchannel('A').resize(rgba.size, Image.Resampling.LANCZOS))
            results.append(encode(rgba))
    elif operation == 'interpolate':
        if len(images) != 2 or images[0].size != images[1].size:
            raise ValueError('补帧需要两张相同尺寸的图片')
        count = options.get('count', 3)
        if not isinstance(count, int) or count < 1 or count > 12:
            raise ValueError('一次补 1–12 帧')
        for i, image in enumerate(images):
            image.convert('RGB').save(tmp / f'rgb{i}.png')
            image.getchannel('A').convert('RGB').save(tmp / f'alpha{i}.png')
        for i in range(count):
            ratio = (i + 1) / (count + 1)
            for channel in ('rgb', 'alpha'):
                run([RIFE / 'rife-ncnn-vulkan.exe', '-0', tmp / f'{channel}0.png', '-1', tmp / f'{channel}1.png',
                     '-o', tmp / f'{channel}.png', '-m', RIFE / 'rife-v4.6', '-s', ratio, '-j', '1:1:1'], RIFE)
            with Image.open(tmp / 'rgb.png') as output:
                rgba = output.convert('RGBA')
            with Image.open(tmp / 'alpha.png') as alpha:
                rgba.putalpha(alpha.convert('L'))
            if rgba.size != images[0].size:
                raise RuntimeError('补帧输出尺寸异常')
            results.append(encode(rgba))
    else:
        raise ValueError('不支持的图片处理类型')
print(json.dumps({'images': results}))
