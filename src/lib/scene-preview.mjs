export const PREVIEW_STAGE = { width: 1280, height: 800, ground: 624 };

export function initialPlacement(size) {
  return { x: 640, y: PREVIEW_STAGE.ground, scale: Math.min(1, 280 / size.height, 480 / size.width) };
}

// Keep the complete shared frame canvas on stage; every pose uses the same anchor.
export function fitPlacement(position, size) {
  const limit = Math.min(4, PREVIEW_STAGE.width / size.width, PREVIEW_STAGE.height / size.height);
  const scale = Math.max(Math.min(.01, limit), Math.min(limit, Number(position.scale) || .01));
  const width = size.width * scale, height = size.height * scale;
  return { scale, x: Math.max(width / 2, Math.min(PREVIEW_STAGE.width - width / 2, position.x)),
    y: Math.max(height, Math.min(PREVIEW_STAGE.height, position.y)) };
}

export function previewSpriteRect(position, size) {
  const p = fitPlacement(position, size);
  return { left: p.x - size.width * p.scale / 2, top: p.y - size.height * p.scale,
    width: size.width * p.scale, height: size.height * p.scale, scale: p.scale };
}

export function containImageRect(width, height) {
  const scale = Math.min(PREVIEW_STAGE.width / width, PREVIEW_STAGE.height / height);
  return { x: (PREVIEW_STAGE.width - width * scale) / 2, y: (PREVIEW_STAGE.height - height * scale) / 2,
    width: width * scale, height: height * scale };
}
