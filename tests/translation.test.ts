// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { initialState, type TranslationConfig } from '../src/model';
import { TranslationController } from '../src/translation/controller';
import { parseTranslationResponse, TranslationService, translationEndpoint } from '../src/translation/service';
import { buildBatches, contentHash, extractSegments, splitLongSegment } from '../src/translation/segments';
import { TranslationStore } from '../src/translation/store';

beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
const config: TranslationConfig = { enabled: true, baseUrl: 'https://api.example.com/v1', apiKey: 'secret', model: 'model', targetLanguage: '简体中文', defaultMode: 'bilingual' };

describe('translation segments and batching', () => {
  it('extracts stable visible blocks while skipping code and nested containers', async () => {
    const root = document.createElement('div'); root.innerHTML = '<p>Hello <b>world</b></p><blockquote><p>Quote</p></blockquote><pre><code>never</code></pre><ul><li>Item</li></ul>';
    const first = extractSegments(root, 'Title'), second = extractSegments(root.cloneNode(true) as HTMLElement, 'Title');
    expect(first.map(item => [item.id, item.source])).toEqual(second.map(item => [item.id, item.source]));
    expect(first.map(item => item.source)).toEqual(['Title', 'Hello world', 'Quote', 'Item']);
    expect(await contentHash(first)).toBe(await contentHash(second));
  });
  it('splits long segments and keeps batches within four items and 1200 characters', () => {
    expect(splitLongSegment('x'.repeat(2500)).map(item => item.length)).toEqual([1200, 1200, 100]);
    const batches = buildBatches(Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, source: 'x'.repeat(300) })));
    expect(batches.every(batch => batch.length <= 4 && batch.reduce((sum, item) => sum + item.text.length, 0) <= 1200)).toBe(true);
  });
});

describe('translation protocol', () => {
  it('allows HTTPS and explicit local HTTP only', () => {
    expect(translationEndpoint('https://api.example.com/v1').endpoint).toBe('https://api.example.com/v1/chat/completions');
    expect(translationEndpoint('http://localhost:11434/v1').endpoint).toContain('/chat/completions');
    expect(() => translationEndpoint('http://example.com/v1')).toThrow();
  });
  it('strictly rejects malformed, wrong-size and non-string results', () => {
    expect(parseTranslationResponse('["一","二"]', 2)).toEqual(['一', '二']);
    for (const value of ['not json', '["one"]', '["one",2]', '{"value":[]}']) expect(() => parseTranslationResponse(value, 2)).toThrow();
  });
  it('classifies authentication, rate limits and server errors without exposing the key', async () => {
    for (const [status, kind] of [[401, 'authentication'], [429, 'rate-limit'], [503, 'server']] as const) {
      const service = new TranslationService(async request => { expect(request.body).not.toContain('secret'); return { status, text: '' }; });
      await expect(service.translate(['hello'], config)).rejects.toMatchObject({ kind });
    }
  });
  it('sends only batch text and validates the chat completion envelope', async () => {
    const transport = vi.fn(async ({ headers, body }: { headers: Record<string, string>; body: string }) => {
      expect(headers.Authorization).toContain('secret'); expect(body).toContain('hello'); expect(body).not.toContain('https://article.example');
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: '["你好"]' } }] }) };
    });
    expect(await new TranslationService(transport).translate(['hello'], config)).toEqual(['你好']);
  });
});

describe('translation controller and cache', () => {
  it('deduplicates text, persists progress, reuses memory and drops stale results', async () => {
    const state = initialState(null), persist = vi.fn(async () => {});
    const service = { translate: vi.fn(async (texts: string[]) => texts.map(text => `译:${text}`)) } as unknown as TranslationService;
    const store = new TranslationStore(() => state, persist), controller = new TranslationController(service, store);
    const segments = [{ id: 'p0', source: 'same' }, { id: 'p1', source: 'same' }, { id: 'p2', source: 'other' }];
    const hash = await contentHash(segments); const progress = vi.fn();
    const artifact = await controller.translate({ articleId: 'a', contentHash: hash, segments, priorityIds: ['p2'], config, isCurrent: () => true, onProgress: progress });
    expect(artifact.completed).toBe(true); expect(artifact.segments).toHaveLength(3);
    expect(service.translate).toHaveBeenCalledTimes(1); expect(service.translate).toHaveBeenCalledWith(['other', 'same'], config);
    const service2 = { translate: vi.fn() } as unknown as TranslationService;
    await new TranslationController(service2, store).translate({ articleId: 'b', contentHash: hash, segments, config, isCurrent: () => true, onProgress: vi.fn() });
    expect(service2.translate).not.toHaveBeenCalled(); expect(state.translationArtifacts.b.completed).toBe(true); expect(persist).toHaveBeenCalled();
  });
  it('runs no more than two batches and ignores late responses after cancellation', async () => {
    const state = initialState(null), store = new TranslationStore(() => state, async () => {}); let active = 0, maximum = 0;
    const service = { translate: vi.fn(async (texts: string[]) => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => window.setTimeout(resolve, 5)); active--; return texts.map(text => `译:${text}`); }) } as unknown as TranslationService;
    const segments = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, source: `${index}:${'x'.repeat(700)}` }));
    const hash = await contentHash(segments), controller = new TranslationController(service, store);
    await controller.translate({ articleId: 'concurrent', contentHash: hash, segments, priorityIds: ['p7'], config, isCurrent: () => true, onProgress: vi.fn() });
    expect(maximum).toBe(2); expect(service.translate.mock.calls[0][0][0]).toContain('7:');

    let release!: () => void; let current = true;
    const late = { translate: vi.fn(async (texts: string[]) => { await new Promise<void>(resolve => { release = resolve; }); return texts; }) } as unknown as TranslationService;
    const pending = new TranslationController(late, store).translate({ articleId: 'stale', contentHash: hash, segments: [segments[0]], config, bypassMemory: true, isCurrent: () => current, onProgress: vi.fn() });
    await vi.waitFor(() => expect(late.translate).toHaveBeenCalled()); current = false; release(); await pending;
    expect(state.translationArtifacts.stale).toBeUndefined();
  });
});
