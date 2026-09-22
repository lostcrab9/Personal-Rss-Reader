import createDOMPurify from 'dompurify';
import { safeUrl, type Bundle } from './model';

const tags = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 's', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'div', 'span', 'sup', 'sub'];

export function articleFragment(bundle: Bundle, doc: Document, images: boolean): DocumentFragment | null {
  const html = bundle.entry.content?.trim() || ''; if (!html) return null;
  const win = doc.defaultView; if (!win) throw new Error('阅读窗口不可用。');
  const fragment = createDOMPurify(win).sanitize(html, {
    RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: images ? tags : tags.filter(tag => tag !== 'img'),
    ALLOWED_ATTR: ['href', 'src', 'alt'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  for (const element of fragment.querySelectorAll('a, img')) {
    const attr = element.tagName === 'A' ? 'href' : 'src'; const raw = element.getAttribute(attr);
    const url = raw ? safeUrl(raw, bundle.entry.link || undefined) : null;
    if (url) element.setAttribute(attr, url); else element.removeAttribute(attr);
    if (element.tagName === 'A') { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); }
    else { element.setAttribute('loading', 'lazy'); element.setAttribute('referrerpolicy', 'no-referrer'); }
  }
  return fragment;
}
