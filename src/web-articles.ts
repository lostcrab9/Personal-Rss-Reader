import { requestUrl } from 'obsidian';
import createDOMPurify from 'dompurify';
import { contentWithBase } from './feeds';
import { safeUrl, type Entry } from './model';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLE_CHARS = 100_000;
const WEAK_FEED_CHARS = 200;
const MIN_WEB_CHARS = 150;
const selectors = ['.post-content-inner.article', 'article[itemprop="articleBody"]', 'article', 'main', '[itemprop="articleBody"]', '.entry-content', '.post-content'];
const noise = 'script,style,noscript,template,nav,aside,footer,form,button,.comments,.comment-list,.related-posts,.post-navigation,.share-buttons';

export interface WebResponse { status: number; text: string; headers: Record<string, string> }
export type WebTransport = (url: string) => Promise<WebResponse>;

function readableText(html: string, doc: Document): string {
  const fragment = createDOMPurify(doc.defaultView!).sanitize(html, { RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: [] });
  return (fragment.textContent || '').replace(/\s+/g, ' ').trim();
}

export function needsWebArticle(entry: Entry, doc: Document): boolean {
  return entry.contentSource !== 'web' && readableText(entry.content || '', doc).length < WEAK_FEED_CHARS && !!safePublicUrl(entry.link || '');
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

export function safePublicUrl(value: string): string | null {
  const href = safeUrl(value); if (!href) return null;
  const url = new URL(href); const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || isPrivateIPv4(host)) return null;
  if (host.startsWith('[')) return null; // Conservative: do not fetch IPv6 literals.
  return href;
}

export function extractWebArticle(html: string, baseUrl: string, doc: Document): { content: string; image?: string } | null {
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) return null;
  const parser = doc.defaultView?.DOMParser; if (!parser) return null;
  const page = new parser().parseFromString(html, 'text/html');
  for (const node of page.querySelectorAll(noise)) node.remove();
  const candidates = selectors.map(selector => Array.from(page.querySelectorAll(selector))).find(matches => matches.some(candidate => (candidate.textContent || '').trim().length >= MIN_WEB_CHARS)) || [];
  let best: Element | undefined; let length = 0;
  for (const candidate of candidates) {
    const size = (candidate.textContent || '').replace(/\s+/g, ' ').trim().length;
    if (size > length) { best = candidate; length = size; }
  }
  if (!best || length < MIN_WEB_CHARS) return null;
  const result = contentWithBase(best.innerHTML.slice(0, MAX_ARTICLE_CHARS), baseUrl, doc);
  if (readableText(result.html, doc).length < MIN_WEB_CHARS) return null;
  return { content: result.html, image: result.image };
}

export class WebArticles {
  constructor(private transport: WebTransport = url => requestUrl({ url, method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml' }, throw: false })) {}

  async fetch(entry: Entry, doc: Document): Promise<{ content: string; image?: string } | null> {
    const url = safePublicUrl(entry.link || ''); if (!url || !needsWebArticle(entry, doc)) return null;
    let timer: number | undefined;
    try {
      const response = await Promise.race([
        this.transport(url),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('网页请求超时')), 15000); }),
      ]);
      if (response.status < 200 || response.status >= 300) return null;
      const type = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
      if (type && !/html|xhtml/i.test(type)) return null;
      if (new TextEncoder().encode(response.text).byteLength > MAX_HTML_BYTES) return null;
      const extracted = extractWebArticle(response.text, url, doc);
      if (!extracted) return null;
      const feedLength = readableText(entry.content || '', doc).length;
      return readableText(extracted.content, doc).length >= Math.max(MIN_WEB_CHARS, feedLength * 1.5) ? extracted : null;
    } catch { return null; }
    finally { window.clearTimeout(timer); }
  }
}
