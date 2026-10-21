import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function localModelStatus() {
  let verified = {}; try { verified = JSON.parse(readFileSync(path.join(root, '.tools/verified.json'), 'utf8')); } catch {}
  const installed = (folder, files) => files.every(file => existsSync(path.join(root, '.tools', folder, file)));
  const enhancementAvailable = Boolean(verified.upscale && installed('esrgan/realesrgan-ncnn-vulkan-v0.2.0-windows', ['realesrgan-ncnn-vulkan.exe', 'models/realesr-animevideov3-x2.bin', 'models/realesr-animevideov3-x4.bin']));
  const interpolationAvailable = Boolean(verified.interpolate && installed('rife/rife-ncnn-vulkan-20221029-windows', ['rife-ncnn-vulkan.exe', 'rife-v4.6/flownet.bin']));
  return { enhancementAvailable, interpolationAvailable, enhancementModel: 'realesr-animevideov3 · 1.2 MB / 倍率', interpolationModel: 'RIFE v4.6 · 10.1 MB', modelPolicy: '轻量 / 单帧串行 / 按需加载' };
}
export function validateLocalImages(body) {
  if (!['upscale', 'interpolate'].includes(body.operation)) throw new Error('不支持的本地处理类型');
  if (!Array.isArray(body.images) || !body.images.length || body.images.length > 16 || body.images.some(image => typeof image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image))) throw new Error('请提交 1–16 张 PNG 图片');
  const options = body.options ?? {};
  if (body.operation === 'upscale' && ![2, 4].includes(options.scale ?? 2)) throw new Error('高清只支持 2× 或 4×');
  if (body.operation === 'interpolate' && (body.images.length !== 2 || !Number.isInteger(options.count ?? 3) || (options.count ?? 3) < 1 || (options.count ?? 3) > 12)) throw new Error('补帧需要两张图片，数量为 1–12');
  return body;
}
export async function deepSeekAssistant(body, signal, { key = process.env.DEEPSEEK_API_KEY, model = process.env.DEEPSEEK_MODEL || 'deepseek-flash' } = {}) {
  if (typeof body.request !== 'string' || !body.request.trim() || body.request.length > 2000) throw new Error('请填写 1–2000 字的素材需求');
  if (!key) { const error = new Error('尚未配置 DeepSeek 密钥；本地编辑与处理可直接使用'); error.status = 503; throw error; }
  const response = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: '用简短中文帮助制作2D游戏素材：根据需求给出动作帧规划、素材命名或生成提示词。不要声称已生成图片或调用本地工具。' }, { role: 'user', content: body.request }], max_tokens: 700 }) });
  if (!response.ok) { const error = new Error(`DeepSeek 返回 ${response.status}，请检查密钥、模型配置或额度`); error.status = 502; throw error; }
  const result = await response.json();
  const reply = result.choices?.[0]?.message?.content;
  if (!reply) throw new Error('DeepSeek 未返回文本');
  return { reply };
}
