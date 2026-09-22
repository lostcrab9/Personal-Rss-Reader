// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { parseFeed } from '../src/feeds';
import { initialState, type Entry } from '../src/model';
import { extractWebArticle, needsWebArticle, safePublicUrl, WebArticles } from '../src/web-articles';

beforeAll(() => { Object.defineProperty(window.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); });

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>DEX 周刊</title><entry><id>one</id><title>#363 Readmate</title><link rel="alternate" href="https://quaily.com/dingyi/p/363"/><updated>2026-09-08T04:47:21Z</updated><summary><![CDATA[  ]]></summary></entry></feed>`;
const page = `<html><body><nav>${'navigation '.repeat(100)}</nav><main><div class="post-content-inner article"><p>这是一篇完整文章，介绍 Readmate 和独立产品的设计。</p><p>${'正文内容与产品讨论。'.repeat(40)}</p><img src="/cover.webp" onerror="bad()"><a href="/more">继续阅读</a><script>bad()</script></div><aside>${'noise '.repeat(100)}</aside></main></body></html>`;

describe('controlled webpage full-text fallback', () => {
  it('treats whitespace-only Atom summaries as missing body and defaults to disabled', async () => {
    const { entries } = await parseFeed(atom, 'https://quaily.com/dingyi/feed/atom', document);
    expect(entries[0].content).toBe('');
    expect(needsWebArticle(entries[0], document)).toBe(true);
    expect(initialState(null).settings.webFullText).toBe(false);
  });
  it('extracts Quaily article body while removing chrome and unsafe markup', async () => {
    const entry = (await parseFeed(atom, 'https://quaily.com/dingyi/feed/atom', document)).entries[0];
    const transport = vi.fn(async () => ({ status: 200, text: page, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const result = await new WebArticles(transport).fetch(entry, document);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result?.content).toContain('Readmate');
    expect(result?.content).toContain('https://quaily.com/cover.webp');
    expect(result?.content).toContain('https://quaily.com/more');
    expect(result?.content).not.toContain('navigation');
    expect(result?.content).not.toContain('onerror');
    expect(result?.content).not.toContain('<script');
  });
  it('does not fetch strong feed content or known private destinations', async () => {
    const transport = vi.fn(async () => ({ status: 200, text: page, headers: {} }));
    const client = new WebArticles(transport);
    const entry: Entry = { id: 'one', sourceId: 'feed', origin: 'local', title: 'Article', link: 'https://example.com/a', content: `<p>${'full text '.repeat(60)}</p>` };
    expect(needsWebArticle(entry, document)).toBe(false);
    expect(await client.fetch(entry, document)).toBeNull();
    for (const url of ['http://localhost/a', 'http://127.0.0.1/a', 'http://192.168.1.1/a', 'http://[::1]/a', 'file:///etc/passwd']) expect(safePublicUrl(url)).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it('keeps feed fallback when webpage is invalid, too large, or not better', async () => {
    const entry: Entry = { id: 'one', sourceId: 'feed', origin: 'local', title: 'Article', link: 'https://example.com/a', content: '<p>Feed summary</p>' };
    expect(extractWebArticle('<html><body>Short</body></html>', entry.link!, document)).toBeNull();
    expect(await new WebArticles(async () => ({ status: 404, text: page, headers: {} })).fetch(entry, document)).toBeNull();
    expect(await new WebArticles(async () => ({ status: 200, text: page, headers: { 'content-type': 'application/json' } })).fetch(entry, document)).toBeNull();
    expect(await new WebArticles(async () => ({ status: 200, text: 'x'.repeat(2 * 1024 * 1024 + 1), headers: {} })).fetch(entry, document)).toBeNull();
    expect(await new WebArticles(async () => { throw new Error('secret-token'); }).fetch(entry, document)).toBeNull();
  });
});
