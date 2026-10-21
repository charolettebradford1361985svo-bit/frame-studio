import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RunwayML from '@runwayml/sdk';
import { localModelStatus, validateLocalImages, deepSeekAssistant } from './local-services.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.FRAME_PYTHON || (existsSync(localPython) ? localPython : 'python');
const limit = 40 * 1024 * 1024;
export function validateGeneration(body) {
  if (![5, 10].includes(body.duration)) throw new Error('视频时长必须为 5 或 10 秒');
  if (!['1280:720', '720:1280', '960:960'].includes(body.ratio)) throw new Error('不支持的画面比例');
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 1000) throw new Error('请填写 1–1000 字的动作描述');
  if (typeof body.image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) throw new Error('图片格式无效');
  if (body.image.length > 7 * 1024 * 1024) throw new Error('图片超过 5 MB，请缩小图片');
  return { model: 'gen4_turbo', promptImage: body.image, promptText: body.prompt.trim(), duration: body.duration, ratio: body.ratio };
}
function worker(input, signal, probe = false, script = 'background.py') {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, 'server', script), ...(probe ? ['--probe'] : [])], {
      cwd: root, env: { ...process.env, U2NET_HOME: path.join(root, '.models'), OMP_NUM_THREADS: '2', PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = ''; let stderr = ''; let finished = false;
    const stop = () => { if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else child.kill(); };
    const timer = setTimeout(() => { stop(); finish(new Error('本地图片处理超时，请减少帧数或分辨率')); }, 300000);
    const abort = () => { stop(); finish(new Error('处理已取消')); };
    function finish(error, data) {
      if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(data);
    }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > limit * 2) { child.kill(); finish(new Error('结果太大，请降低分辨率')); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    child.on('error', () => finish(new Error('无法启动抠图服务，请检查 Python 安装')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code !== 0) return finish(new Error(stderr.includes('ModuleNotFoundError') ? '本地处理依赖尚未安装，请查看 README' : stderr.includes('1024') ? '轻量模型处理要求每帧最长边不超过 1024 px' : '本地图片处理失败，请检查模型文件或重试'));
      try { finish(null, JSON.parse(stdout)); } catch { finish(new Error('抠图服务返回了无效结果')); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
export function createApi({ client = process.env.RUNWAYML_API_SECRET ? new RunwayML({ apiKey: process.env.RUNWAYML_API_SECRET, maxRetries: 0 }) : null } = {}) {
  const tasks = new Map(); let removing = false, processing = false;
  return http.createServer(async (req, res) => {
    const send = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } };
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const url = new URL(req.url, 'http://localhost');
    // 本地工具只接受本机页面调用，不允许外部网站触发付费任务。
    if (req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { return send(403, { error: '无效来源' }); }
      if (!['localhost', '127.0.0.1', 'terminal.local'].includes(origin.hostname)) return send(403, { error: '仅允许本地工作台调用' });
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const bg = await worker({}, undefined, true).catch(() => ({ available: false }));
        return send(200, { videoConfigured: Boolean(client), backgroundAvailable: bg.available, modelCached: bg.modelCached ?? false, ...localModelStatus(), deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY) });
      }
      if (req.method === 'POST') {
        let chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > limit) { send(413, { error: '文件太大，请降低图片分辨率' }); return; } chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(400, { error: '请求格式无效' }); }
        if (url.pathname === '/api/assistant') return send(200, await deepSeekAssistant(body, controller.signal));
        if (url.pathname === '/api/process-images') {
          validateLocalImages(body);
          const status = localModelStatus();
          if (!(body.operation === 'upscale' ? status.enhancementAvailable : status.interpolationAvailable)) return send(503, { error: '本地轻量模型尚未通过运行验证，请检查安装状态' });
          if (processing) return send(409, { error: '本地模型正在处理另一组素材，请稍后重试' });
          processing = true;
          try { return send(200, await worker(body, controller.signal, false, 'local-images.py')); } finally { processing = false; }
        }
        if (url.pathname === '/api/generate') {
          const params = validateGeneration(body);
          if (!client) return send(503, { error: '尚未配置 Runway API 密钥，请在项目 .env 中设置 RUNWAYML_API_SECRET' });
          const task = await client.imageToVideo.create(params, { signal: controller.signal });
          if (tasks.size >= 100) tasks.delete(tasks.keys().next().value);
          tasks.set(task.id, { videoUrl: null, created: Date.now() });
          return send(202, { id: task.id });
        }
        if (url.pathname === '/api/remove-background') {
          if (!Array.isArray(body.images) || !body.images.length || body.images.length > 16 || body.images.some(x => typeof x !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(x))) return send(400, { error: '请提交 1–16 张 PNG 图片' });
          if (removing) return send(409, { error: '正在处理另一组图片，请稍后重试' });
          removing = true;
          try { return send(200, await worker(body, controller.signal)); } finally { removing = false; }
        }
      }
      const match = url.pathname.match(/^\/api\/(tasks|video)\/([A-Za-z0-9-]+)$/);
      if (match) {
        const [, kind, id] = match; const entry = tasks.get(id);
        if (!entry || !client) return send(404, { error: '任务不存在或服务已重启' });
        if (req.method === 'DELETE' && kind === 'tasks') {
          const status = await client.tasks.retrieve(id);
          if (['PENDING', 'RUNNING', 'THROTTLED'].includes(status.status)) await client.tasks.delete(id);
          tasks.delete(id); return send(200, { cancelled: true });
        }
        if (req.method === 'GET' && kind === 'tasks') {
          const task = await client.tasks.retrieve(id, { signal: controller.signal });
          if (task.status === 'SUCCEEDED' && task.output?.[0]) entry.videoUrl = task.output[0];
          return send(200, { status: task.status, progress: task.progress, error: task.failure,
            video: entry.videoUrl ? `/api/video/${id}` : null });
        }
        if (req.method === 'GET' && kind === 'video' && entry.videoUrl) {
          const video = await fetch(entry.videoUrl, { signal: controller.signal });
          if (!video.ok) return send(502, { error: '生成视频下载失败' });
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=3600' });
          for await (const chunk of video.body) { if (res.destroyed) break; res.write(chunk); }
          return res.end();
        }
      }
      send(404, { error: '接口不存在' });
    } catch (error) {
      const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 400;
      send(status, { error: error.status ? `视频服务返回 ${status}，请检查密钥、余额或稍后重试` : error.message });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApi().listen(4174, '127.0.0.1', () => console.log('Frame Studio API: http://127.0.0.1:4174'));
}
