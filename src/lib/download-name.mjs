export function projectBackupFilename(name, id) {
  let stem = (typeof name === 'string' ? name : '').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, '-')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/-+/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(\.|$)/i.test(stem)) stem = `素材-${stem}`;
  // Limit UTF-16 length, preserving complete emoji when Segmenter is available.
  const pieces = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem), part => part.segment)
    : Array.from(stem);
  stem = '';
  for (const piece of pieces) {
    if (piece.length === 1 && /[\ud800-\udfff]/.test(piece)) continue;
    if (stem.length + piece.length > 72) break;
    stem += piece;
  }
  stem = stem.replace(/[.\s-]+$/g, '') || '未命名素材';
  const shortId = (typeof id === 'string' ? id : '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `${stem}-项目备份${shortId ? `-${shortId}` : ''}.zip`;
}
