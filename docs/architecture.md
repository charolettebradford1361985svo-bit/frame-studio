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
