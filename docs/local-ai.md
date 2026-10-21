# 可选本地 AI

**先使用不需要模型的浏览器工作流。** 裁帧、平移对齐、画笔、色键抠图、色彩统一、普通场景预览和导出都不需要下面的安装。

## CPU 抠图

当前已验证环境为 Windows、Python 3.12。Python 使用范围仍需在更多新环境验证。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

macOS/Linux 的虚拟环境 Python 路径是 `.venv/bin/python`。服务器会自动寻找对应路径；也可在本机 `.env` 中设置 `FRAME_PYTHON` 为你自己的解释器路径。

重启服务后，在“修图”或“通用工具”中主动调用 AI 抠图。rembg 首次推理可能从上游下载 `u2netp`，模型缓存保存在 `.models/`。图片通过本机 API 处理；每帧最长边限制为 1024 px，单批最多 16 帧，较多帧在前端分批。复杂边缘、遮挡和跨帧一致性需要人工检查。

## 高清与 RIFE 补帧：Windows 实验性适配

仓库**不附带** `.tools/`、平台可执行文件、权重或本机验证标记。仅克隆项目不会显示这些模型“已就绪”。

当前适配器预期以下目录布局，其他操作系统的可执行文件路径尚未适配：

```text
.tools/
  esrgan/realesrgan-ncnn-vulkan-v0.2.0-windows/
    realesrgan-ncnn-vulkan.exe
    models/realesr-animevideov3-x2.bin (+ .param)
    models/realesr-animevideov3-x4.bin (+ .param)
  rife/rife-ncnn-vulkan-20221029-windows/
    rife-ncnn-vulkan.exe
    rife-v4.6/flownet.bin (+ .param)
  verified.json
```

模型和便携包应从 [Real-ESRGAN 上游发行页](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases) 和 [RIFE 上游发行页](https://github.com/nihui/rife-ncnn-vulkan/releases) 获取并保留原许可证。还需要本机 Vulkan 驱动。

`server/local-images.py` 是现有适配器：通过标准输入读取 `operation`、PNG data URL 的 `images` 数组，以及 `options`；标准输出返回 PNG data URL。高清支持 2×/4×；补帧要求两张同尺寸图片，一次新增 1–12 帧。RGB 与透明蒙版分别处理，输出 alpha 与动作衔接仍需人工检查。

`verified.json` 的 `upscale` / `interpolate` 标记只应在这台电脑完成真实推理、核对尺寸、数量及透明通道之后生成。**不要仅为启用按钮而把标记写成 true。** 当前尚未提供一键安装/验证工具，属于公开预览版的已知限制；缺少准备条件时继续使用确定性算法即可。

本项目不安装大型扩散/语言模型，不需要 PyTorch 或 CUDA。模型按需运行、逐帧串行处理；显卡支持和处理耗时依本机环境而定。外部模型有独立许可证，详见 [来源记录](../THIRD_PARTY_NOTICES.md)。
