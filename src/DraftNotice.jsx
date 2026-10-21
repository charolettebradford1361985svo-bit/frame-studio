import { useEffect, useState } from 'react';
import { sameDraft, protectDraft } from './lib/draft-guard.mjs';

export function useDraftGuard(value) {
  const [saved, markSaved] = useState(() => value);
  const dirty = !sameDraft(value, saved);
  useEffect(() => protectDraft(window, dirty), [dirty]);
  return { dirty, markSaved };
}
export function DraftNotice({ guard, saveLabel, prerequisite, className }) {
  return guard.dirty ? <p className={className} role="status" aria-label="保存状态">未保存 · {prerequisite || `刷新或关闭前，请点「${saveLabel}」。`}手机端请主动保存。</p> : null;
}
