import { z } from 'zod';

export const modeSchema = z.enum(['original', 'bilingual', 'translated']);
export type Mode = z.infer<typeof modeSchema>;
export const modeLabels: Record<Mode, string> = { original: '原文', bilingual: '双语', translated: '仅译文' };

export const readingFontSchema = z.enum(['serif', 'sans', 'sourceHanSerif', 'sourceHanSans', 'wenkai', 'zhenkai', 'fangsong', 'custom']);
export type ReadingFont = z.infer<typeof readingFontSchema>;
const optionalText = z.string().nullish();

export const entrySchema = z.object({
  id: z.string().min(1), sourceId: z.string(), origin: z.literal('local').default('local'), sourceName: optionalText,
  title: z.string(), link: optionalText, author: optionalText, published: optionalText, publishedTs: z.number().nullish(),
  summary: optionalText, content: optionalText, image: optionalText, contentSource: z.enum(['feed', 'web']).optional(),
});
export type Entry = z.infer<typeof entrySchema>;

export const bundleSchema = z.object({ entry: entrySchema, fetchedAt: z.number() });
export type Bundle = z.infer<typeof bundleSchema>;

export const subscriptionSchema = z.object({
  id: z.string(), url: z.string(), name: z.string(), group: z.string().default(''),
  entries: z.array(entrySchema).default([]), updatedAt: z.number().default(0), error: z.string().default(''),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const translationConfigSchema = z.object({
  enabled: z.boolean().default(false), baseUrl: z.string().default(''), apiKey: z.string().default(''), model: z.string().default(''),
  targetLanguage: z.string().min(1).max(100).default('简体中文'), defaultMode: modeSchema.default('bilingual'),
}).default({ enabled: false, baseUrl: '', apiKey: '', model: '', targetLanguage: '简体中文', defaultMode: 'bilingual' });
export type TranslationConfig = z.infer<typeof translationConfigSchema>;

export const translationSegmentSchema = z.object({
  id: z.string(), source: z.string(), translation: z.string(), status: z.enum(['complete', 'failed']),
});
export const translationArtifactSchema = z.object({
  articleId: z.string(), contentHash: z.string(), targetLanguage: z.string(), providerId: z.string(), model: z.string(),
  configFingerprint: z.string(), promptVersion: z.number().int(), segments: z.array(translationSegmentSchema),
  completed: z.boolean(), updatedAt: z.number(),
});
export type TranslationArtifact = z.infer<typeof translationArtifactSchema>;

export const translationMemoryItemSchema = z.object({ translation: z.string(), updatedAt: z.number(), lastUsedAt: z.number() });
export type TranslationMemoryItem = z.infer<typeof translationMemoryItemSchema>;

export const channelStateSchema = z.object({
  entries: z.array(entrySchema), bundle: bundleSchema.nullable(), mode: modeSchema,
  filter: z.enum(['all', 'unread', 'favorites']), query: z.string(), unread: z.array(z.string()),
  listTop: z.number().nonnegative(), readerTop: z.number().nonnegative(), articlePending: z.boolean(),
});
export type ChannelState = z.infer<typeof channelStateSchema>;

const settingsSchema = z.object({
  folder: z.string().default('Personal RSS Reader'), remoteImages: z.boolean().default(true), webFullText: z.boolean().default(false),
  listWidth: z.number().min(220).max(520).default(300), fontSize: z.number().int().min(14).max(32).default(19),
  customFont: z.string().max(200).catch('').default(''), fontFamily: readingFontSchema.default('fangsong'),
  lineHeight: z.number().min(1.5).max(2.4).default(1.9), lineWidth: z.union([z.literal(28), z.literal(36), z.literal(44)]).default(36),
  lastSource: z.string().max(300).default('@local'), translationConfig: translationConfigSchema,
});

export const stateSchema = z.object({
  settings: settingsSchema.default({ folder: 'Personal RSS Reader', remoteImages: true, webFullText: false, listWidth: 300, fontSize: 19,
    fontFamily: 'fangsong', customFont: '', lineHeight: 1.9, lineWidth: 36, lastSource: '@local',
    translationConfig: { enabled: false, baseUrl: '', apiKey: '', model: '', targetLanguage: '简体中文', defaultMode: 'bilingual' } }),
  readIds: z.array(z.string()).default([]), favorites: z.record(z.string(), bundleSchema).catch({}).default({}),
  subscriptions: z.array(subscriptionSchema).catch([]).default([]), channelStates: z.record(z.string(), channelStateSchema).catch({}).default({}),
  cache: z.record(z.string(), bundleSchema).catch({}).default({}), translationArtifacts: z.record(z.string(), translationArtifactSchema).catch({}).default({}),
  translationMemory: z.record(z.string(), translationMemoryItemSchema).catch({}).default({}), translationDataVersion: z.literal(1).catch(1).default(1),
});
export type State = z.infer<typeof stateSchema>;

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function localBundles(value: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object(value)).filter(([, raw]) => {
    const entry = object(object(raw).entry), id = typeof entry.id === 'string' ? entry.id : '';
    return entry.origin === 'local' || (!entry.origin && id.startsWith('local-'));
  }));
}

/** Load current data and deliberately discard removed remote, note, vault-source and legacy translation state. */
export function initialState(data: unknown): State {
  const raw = object(data), rawSettings = object(raw.settings);
  const parsedSubscriptions = Array.isArray(raw.subscriptions) ? raw.subscriptions.flatMap(value => {
    const parsed = subscriptionSchema.safeParse(value); return parsed.success ? [parsed.data] : [];
  }) : [];
  const validSources = new Set(['@local', ...parsedSubscriptions.map(feed => feed.id),
    ...parsedSubscriptions.filter(feed => feed.group).map(feed => `@group:${feed.group}`)]);
  const savedSource = typeof rawSettings.lastSource === 'string' ? rawSettings.lastSource : '';
  const lastSource = validSources.has(savedSource) ? savedSource : '@local';
  const translationConfig = object(rawSettings.translationConfig);
  const channelStates = Object.fromEntries(Object.entries(object(raw.channelStates)).flatMap(([key, value]) => {
    const candidate = object(value), entries = Array.isArray(candidate.entries) ? candidate.entries.filter(item => object(item).origin === 'local') : [];
    const bundle = object(candidate.bundle); const entry = object(bundle.entry);
    const normalized = { ...candidate, entries, bundle: entry.origin === 'local' ? candidate.bundle : null,
      mode: ['original', 'bilingual', 'translated'].includes(String(candidate.mode)) ? candidate.mode : 'original' };
    const parsed = channelStateSchema.safeParse(normalized); return parsed.success ? [[key, parsed.data]] : [];
  }));
  return stateSchema.parse({
    settings: { ...rawSettings, lastSource, translationConfig }, subscriptions: parsedSubscriptions,
    readIds: Array.isArray(raw.readIds) ? raw.readIds.filter(id => typeof id === 'string' && id.startsWith('local-')) : [],
    favorites: localBundles(raw.favorites), cache: localBundles(raw.cache), channelStates,
    translationArtifacts: raw.translationDataVersion === 1 ? raw.translationArtifacts : {},
    translationMemory: raw.translationDataVersion === 1 ? raw.translationMemory : {}, translationDataVersion: 1,
  });
}

export function titleOf(entry: Entry): string { return entry.title; }
export function safeUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function folderPath(value: string): string {
  const segments = value.trim().replace(/\\/g, '/').split('/');
  if (!segments.length || segments.some(s => !s || s.startsWith('.') || /[:*?"<>|]/.test(s) || [...s].some(c => c.charCodeAt(0) < 32))) {
    throw new Error('请输入库内文件夹名称，不包含隐藏目录、空段或特殊字符。');
  }
  return segments.join('/');
}
