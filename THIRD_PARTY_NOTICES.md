# Third-party notices / 第三方来源

本仓库自有代码与文档按根目录 [MIT](LICENSE) 许可提供。早期视频抽帧工作流参考 VideoToSprite，具体范围见下方说明。第三方代码、依赖、外部模型和输入素材使用各自的许可证；根目录许可证不覆盖它们。

## npm 与 Python 依赖

| 组件 | 用途 | 来源 |
| --- | --- | --- |
| React / React DOM | 界面 | https://github.com/facebook/react |
| Vite / React plugin | 本地开发与构建 | https://github.com/vitejs/vite / https://github.com/vitejs/vite-plugin-react |
| Phosphor Icons | 图标 | https://github.com/phosphor-icons/react |
| fflate | ZIP 打包与解包 | https://github.com/101arrowz/fflate |
| Runway SDK | 可选视频 API | https://github.com/runwayml/sdk-node |
| fake-indexeddb | 自动化测试 | https://github.com/dumbmatter/fakeIndexedDB |
| rembg | 可选本地抠图 | https://github.com/danielgatis/rembg |
| Pillow | 可选图片处理 | https://github.com/python-pillow/Pillow |

准确版本、传递依赖和依赖许可证请查看 `package-lock.json`、`requirements.txt` 及相应发行包的许可证。依赖由包管理器安装，仓库不包含 `node_modules` 或 Python 虚拟环境。

## 可选模型与可执行文件

- [Real-ESRGAN ncnn Vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan)：高清适配；不捆绑可执行文件或权重。
- [RIFE ncnn Vulkan](https://github.com/nihui/rife-ncnn-vulkan)：补帧适配；不捆绑可执行文件或权重。
- rembg 使用的 `u2netp` 权重由其上游提供；不捆绑模型缓存。

使用或再分发模型前，请分别检查上游代码、发布包和模型权重的说明。模型许可不因本项目采用 MIT 而改变。

## 仓库内媒体

- `public/media/flower.mp4`：来自 [MDN CC0 视频示例](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4)。
- `public/frame-studio-logo.png`：AI 辅助生成的项目图标。`.ico` 是同图标的格式转换。
- `public/scenes/forest.png`、`courtyard.png`：AI 辅助生成的场景预览背景。
- `docs/images/scene-preview.png`：本项目界面截图，使用程序绘制的测试角色和上述场景，不包含用户上传的第三方角色图。
- `tests/fixtures/`：用于验证裁剪、偏移和图像处理的程序测试素材，不是人工绘制的商品素材。

项目自有媒体随仓库提供用于演示；AI 生成来源已明确标注，不声称其为人工原创或具有独占权利。原始生成记录及内部工作说明保留在维护者本机，不随仓库分发。用户自行导入的素材不属于仓库许可范围。

## VideoToSprite：早期工作流参考

早期视频抽帧、背景处理、播放预览和序列帧/精灵图导出的功能流程参考 [VideoToSprite / siloebb/video-to-spritesheet](https://github.com/siloebb/video-to-spritesheet)，感谢上游提供的参考。Frame Studio 不是该项目的官方版本。

本次核对的上游版本为 [`51b0251cb53998ff1c227487bad1a63885902624`](https://github.com/siloebb/video-to-spritesheet/tree/51b0251cb53998ff1c227487bad1a63885902624)，其代码许可证为 [Apache-2.0](https://github.com/siloebb/video-to-spritesheet/blob/51b0251cb53998ff1c227487bad1a63885902624/LICENSE)。上游许可证不因本仓库采用 MIT 而改变。

| 对照项 | 上游 VideoToSprite | 当前 Frame Studio |
| --- | --- | --- |
| 抽帧实现 | Python 的 `core/ffmpeg.py` 调用本机 FFmpeg/FFprobe，按 FPS 提取并写出图片 | `src/lib/media.mjs` 使用浏览器 HTMLVideoElement、seeked 事件与 Canvas；`src/lib/core.mjs` 按选定数量取每个时间区间的中点 |
| 精灵图/导出 | Python、NumPy/Pillow 与文件系统导出 | 浏览器 Canvas 合图，fflate 打包 PNG/JSON |
| 参考范围 | 视频 → 抽帧 → 背景处理 → 预览 → 导出的产品流程 | 承认并保留上述工作流借鉴；另有手动校准、关节、场景和地形工具 |

核对了上述抽帧与导出实现、当前导入及依赖清单，未发现当前抽帧模块导入或捆绑上游 Python 源文件、上游安装包或 FFmpeg。该核对说明具体实现与依赖关系，不应被解读为对全部代码作法律意义的原创性保证。后续如直接复制或改编上游代码，应在相应文件注明来源并保留适用的版权和许可证告知。
