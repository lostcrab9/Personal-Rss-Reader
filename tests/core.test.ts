// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { articleFragment } from '../src/content';
import { folderPath, initialState, safeUrl, type Bundle } from '../src/model';

const bundle: Bundle = { entry: { id: 'local-one', sourceId: 'local:feed', origin: 'local', title: 'Title', link: 'https://example.com/news', content: '<h2>Original</h2><p>Full text</p>' }, fetchedAt: 1 };

describe('untrusted feed content', () => {
  it('removes executable elements, handlers, CSS, embeds and unsafe URLs', () => {
    const value = structuredClone(bundle);
    value.entry.content = '<script>window.pwned=1</script><iframe src="https://evil.com"></iframe><style>body{display:none}</style><p id="app" style="color:red" onclick="evil()">safe</p><a href="javascript:evil()">bad</a><img src="https://example.com/tracker" onerror="evil()">';
    const fragment = articleFragment(value, document, false)!;
    expect(fragment.querySelector('script,iframe,style,img,[id],[style],[onclick]')).toBeNull();
    expect(fragment.querySelector('a')?.hasAttribute('href')).toBe(false); expect(fragment.textContent).toContain('safe');
  });
  it('normalizes relative links and protects images and links', () => {
    const value = structuredClone(bundle); value.entry.content = '<a href="/link">link</a><img src="/image.png"><img src="data:image/svg+xml,bad">';
    const fragment = articleFragment(value, document, true)!;
    expect(fragment.querySelector('a')?.getAttribute('href')).toBe('https://example.com/link');
    expect(fragment.querySelector('a')?.getAttribute('rel')).toContain('noopener');
    expect(fragment.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(fragment.querySelectorAll('img')[1].hasAttribute('src')).toBe(false);
  });
});

describe('personal state migration', () => {
  it('uses personal subscriptions as the only default source', () => {
    expect(initialState(null).settings.lastSource).toBe('@local');
    expect(initialState({ settings: { lastSource: '' } }).settings.lastSource).toBe('@local');
  });
  it('keeps local data and strips removed remote and saved-article state', () => {
    const local = bundle, remote = { ...bundle, entry: { ...bundle.entry, id: 'remote', origin: 'qiaomu' } };
    const state = initialState({ readIds: ['local-one', 'remote'], favorites: { 'local-one': local, remote }, cache: { remote },
      entries: [remote.entry], sources: [{ id: 'news' }], savedArticles: { remote }, settings: { baseUrl: 'https://rss.example', defaultMode: 'rewrite' } });
    expect(state.readIds).toEqual(['local-one']); expect(Object.keys(state.favorites)).toEqual(['local-one']);
    expect(state.cache).toEqual({}); expect(state).not.toHaveProperty('entries'); expect(state).not.toHaveProperty('sources'); expect(state).not.toHaveProperty('savedArticles');
    expect(state.settings).not.toHaveProperty('baseUrl'); expect(state.settings).not.toHaveProperty('defaultMode');
  });
  it('validates safe web URLs and OPML export folders', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('javascript:evil()')).toBeNull(); expect(() => folderPath('../private')).toThrow();
  });
});
