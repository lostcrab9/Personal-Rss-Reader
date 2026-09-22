export interface TranslationSegment { id: string; source: string; element?: HTMLElement }

const selector = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption';
export function normalizeSource(value: string): string { return value.replace(/\s+/g, ' ').trim(); }

/** Marks stable, visible leaf blocks in already-sanitized article DOM. */
export function extractSegments(root: ParentNode, title = ''): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  if (normalizeSource(title)) segments.push({ id: 'title', source: normalizeSource(title) });
  const counts = new Map<string, number>();
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (element.closest('pre,code,table') || element.querySelector(selector)) continue;
    const source = normalizeSource(element.textContent || ''); if (!source) continue;
    const tag = element.tagName.toLocaleLowerCase(); const index = counts.get(tag) || 0; counts.set(tag, index + 1);
    const id = `${tag}${index}`; element.dataset.qrsSegment = id; segments.push({ id, source, element });
  }
  return segments;
}

export async function contentHash(segments: Pick<TranslationSegment, 'id' | 'source'>[]): Promise<string> {
  const input = segments.map(segment => `${segment.id}\u0000${segment.source}`).join('\u0001');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function splitLongSegment(value: string, limit = 1200): string[] {
  if (value.length <= limit) return [value];
  const parts: string[] = []; let rest = value;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1); const candidates = [window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf(' ')];
    const cut = Math.max(...candidates.filter(index => index >= Math.floor(limit * 0.5)));
    const end = cut >= 0 ? cut + (window[cut] === '。' ? 1 : 0) : limit;
    parts.push(rest.slice(0, end).trim()); rest = rest.slice(end).trim();
  }
  if (rest) parts.push(rest); return parts;
}

export interface TranslationBatchItem { key: string; text: string; segmentId: string; part: number; totalParts: number }
export function buildBatches(segments: Pick<TranslationSegment, 'id' | 'source'>[], maxItems = 4, maxChars = 1200): TranslationBatchItem[][] {
  const items = segments.flatMap(segment => {
    const parts = splitLongSegment(segment.source, maxChars);
    return parts.map((text, part) => ({ key: `${segment.id}:${part}`, text, segmentId: segment.id, part, totalParts: parts.length }));
  });
  const batches: TranslationBatchItem[][] = []; let batch: TranslationBatchItem[] = []; let chars = 0;
  for (const item of items) {
    if (batch.length && (batch.length === maxItems || chars + item.text.length > maxChars)) { batches.push(batch); batch = []; chars = 0; }
    batch.push(item); chars += item.text.length;
  }
  if (batch.length) batches.push(batch); return batches;
}
