import { requestUrl } from 'obsidian';
import type { TranslationConfig } from '../model';

export const PROMPT_VERSION = 1;
export type TranslationErrorKind = 'configuration' | 'authentication' | 'rate-limit' | 'timeout' | 'network' | 'server' | 'invalid-response';
export class TranslationError extends Error { constructor(message: string, readonly kind: TranslationErrorKind, readonly retryable = false) { super(message); } }
export type TranslationTransport = (request: { url: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: string }>;

export function translationEndpoint(value: string): { endpoint: string; providerId: string } {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new TranslationError('请输入有效的 API Base URL。', 'configuration'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
    throw new TranslationError('API 地址必须使用 HTTPS；仅 localhost 和 127.0.0.1 可使用 HTTP。', 'configuration');
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  url.pathname = `${path}/chat/completions`.replace(/\/+/g, '/');
  return { endpoint: url.href, providerId: url.origin + path };
}

export function validateTranslationConfig(config: TranslationConfig, requireEnabled = true) {
  if (requireEnabled && !config.enabled) throw new TranslationError('请先在设置中启用 AI 翻译。', 'configuration');
  if (!config.apiKey.trim()) throw new TranslationError('请填写 API Key。', 'configuration');
  if (!config.model.trim()) throw new TranslationError('请填写模型名称。', 'configuration');
  translationEndpoint(config.baseUrl);
}

export function parseTranslationResponse(text: string, expected: number): string[] {
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new TranslationError('模型返回的内容不是有效 JSON。', 'invalid-response'); }
  const values: unknown[] = Array.isArray(payload) ? payload : [];
  if (!Array.isArray(payload) || values.length !== expected || !values.every(item => typeof item === 'string')) {
    throw new TranslationError('模型返回的译文数量或格式不正确。', 'invalid-response');
  }
  return values as string[];
}

const defaultTransport: TranslationTransport = async request => {
  const response = await requestUrl({ url: request.url, method: 'POST', headers: request.headers, body: request.body, throw: false });
  return { status: response.status, text: response.text };
};

export class TranslationService {
  constructor(private transport: TranslationTransport = defaultTransport, private timeoutMs = 90_000) {}
  async translate(texts: string[], config: TranslationConfig): Promise<string[]> {
    validateTranslationConfig(config); const { endpoint } = translationEndpoint(config.baseUrl);
    const body = JSON.stringify({ model: config.model.trim(), temperature: 0,
      messages: [{ role: 'system', content: `Translate every string into ${config.targetLanguage}. Return only a JSON array of strings with exactly the same length and order. Preserve meaning and plain-text formatting.` },
        { role: 'user', content: JSON.stringify(texts) }] });
    let timer: number | undefined;
    try {
      const response = await Promise.race([this.transport({ url: endpoint, headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body }),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new TranslationError('翻译请求超时，请重试。', 'timeout', true)), this.timeoutMs); })]);
      if ([401, 403].includes(response.status)) throw new TranslationError('API Key 无效或没有访问权限。', 'authentication');
      if (response.status === 429) throw new TranslationError('模型服务正在限流，请稍后重试。', 'rate-limit', true);
      if (response.status >= 500) throw new TranslationError('模型服务暂时不可用，请稍后重试。', 'server', true);
      if (response.status < 200 || response.status >= 300) throw new TranslationError(`模型服务请求失败（HTTP ${response.status}）。`, 'configuration');
      let envelope: unknown;
      try { envelope = JSON.parse(response.text); } catch { throw new TranslationError('模型服务返回了无效响应。', 'invalid-response'); }
      const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new TranslationError('模型响应中没有译文。', 'invalid-response');
      return parseTranslationResponse(content, texts.length);
    } catch (error) {
      if (error instanceof TranslationError) throw error;
      throw new TranslationError('无法连接模型服务，请检查地址和网络。', 'network', true);
    } finally { if (timer !== undefined) window.clearTimeout(timer); }
  }
  async test(config: TranslationConfig): Promise<string> {
    validateTranslationConfig(config, false); const { providerId } = translationEndpoint(config.baseUrl);
    await this.translate(['Hello'], { ...config, enabled: true }); return new URL(providerId).hostname;
  }
}
