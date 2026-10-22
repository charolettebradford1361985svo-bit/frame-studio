# Architecture / 项目结构

```text
src/App.jsx                 首页、路由、素材库及工作台间传递
src/SheetStudio.jsx         动画裁帧、校准、修图和时间轴
src/ScenePreview.jsx        只读场景试放
src/RigStudio.jsx           角色部件与关节
src/SceneStudio.jsx         场景、逐帧框与事件
src/TerrainStudio.jsx       地形与平铺检查
src/Library.jsx             IndexedDB 素材库与完整项目 ZIP
src/SharedTools.jsx         共用图片处理入口
src/lib/                    图像、动画、历史、校验与打包算法
server/index.mjs            本机 HTTP API，绑定 127.0.0.1:4174
server/background.py        可选 rembg CPU 抠图
server/local-images.py      可选 ncnn 高清 / RIFE 子进程适配
tests/                      Node 内置测试运行器、纯算法与测试替身
worker/ + .openai/          保留的静态托管适配
```

浏览器通过 Vite 的 `/api` 代理访问本机 Node 服务。Node 在需要时启动 Python/便携模型，云端 Runway 与 DeepSeek 仅在用户主动调用时访问。无账号系统、无云端素材同步。

素材库按浏览器 origin 隔离。完整项目 ZIP 使用 `frame-studio-project` v1；PNG 图集/JSON 资源包是输出格式，不能当作完整项目备份恢复。

裁剪、修图与设置修改使用有界撤销历史。播放、场景试放和画布预览缩放不修改原始像素。导出时重新按共享画布和位移渲染，不输出参考线或洋葱皮。

单元测试包含 API 替身；通过单元测试不代表已经验收真实付费服务、可选模型或所有浏览器。静态托管仅包含前端，不会自动部署本机 Node/Python 后端。

## 视频抽帧与资源所有权

`core.mjs` 将选定时间段均分为 N 段，在每段中点取样，避开恰好命中视频结束位置；这保证采样点数量和顺序，不保证快速运动不会漏掉动作。`media.mjs` 逐次等待视频 `seeked`，绘入 Canvas 后编码 PNG。最长边只缩小，不自动放大；无效视频尺寸在申请 Canvas 前拒绝。

视频抽帧和色键处理成功后，输出 Object URL 交给调用方，调用方使用 `disposeFrames` 释放。失败或取消则回收本次已生成的 URL；视频资源在抽帧 finally 中释放。色键与合图绘制使用的 ImageBitmap 在 finally 中关闭，包括绘制失败的路径。异步 PNG 编码完成后和返回结果前再次检查取消，避免最后一帧取消仍被报告为成功。

这条路径使用浏览器原生视频和 Canvas，不捆绑 FFmpeg；工作流借鉴仍见 [第三方说明](../THIRD_PARTY_NOTICES.md)。不同浏览器的实际 seek 精度和颜色转换未由 Node 替身测试证明。

## 验证层与性能边界

| 证据 | 验证范围 | 不代表什么 |
| --- | --- | --- |
| `tests/core.test.mjs`、`sprite-editor.test.mjs` | 合成 RGBA、采样时序、边界及共享画布计算 | 真实素材所有造型都能自动裁准 |
| `tests/media-lifecycle.test.mjs` | 替身的取消、资源关闭、归档字节与绘制坐标契约 | 真实 PNG 编码、视频解码或 GPU 验收 |
| `tests/project-import.test.mjs` | 实际小型 PNG 字节、透明 RGBA、ZIP 往返和异常导入；隔离 IndexedDB | 所有浏览器的存储持久性或商用引擎兼容 |
| `scripts/benchmark-pixels.mjs` | 固定输入的串行 CPU 变换，重复时间与内存端点 | 编辑器全流程响应时间、内存峰值或速度领先 |

[基线结果及复现方式](pixel-performance-baseline.md) 与 [维护记录](maintenance-2026-10-22.md) 分开记录，不把单次测量或测试数量当作整体性能结论。
