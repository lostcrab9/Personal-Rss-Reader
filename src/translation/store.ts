import type { State, TranslationArtifact, TranslationConfig } from '../model';
import { PROMPT_VERSION, translationEndpoint } from './service';
import { normalizeSource } from './segments';

const MAX_ARTIFACTS = 30;
const MAX_MEMORY = 2_000;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_MEMORY_BYTES = 2 * 1024 * 1024;
function withinBytes<T>(values: T[], limit: number): T[] {
  const kept: T[] = []; let bytes = 0;
  for (const value of values) { const size = new TextEncoder().encode(JSON.stringify(value)).byteLength; if (bytes + size > limit) continue; kept.push(value); bytes += size; }
  return kept;
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function configIdentity(config: TranslationConfig) {
  const { providerId } = translationEndpoint(config.baseUrl);
  return { providerId, fingerprint: await digest(JSON.stringify({ providerId, model: config.model.trim(), targetLanguage: config.targetLanguage.trim(), promptVersion: PROMPT_VERSION })) };
}
export class TranslationStore {
  constructor(private state: () => State, private persist: () => Promise<void>) {}
  async artifact(articleId: string, contentHash: string, config: TranslationConfig): Promise<TranslationArtifact> {
    const { providerId, fingerprint } = await configIdentity(config); const existing = this.state().translationArtifacts[articleId];
    if (existing && existing.contentHash === contentHash && existing.targetLanguage === config.targetLanguage && existing.model === config.model.trim()
      && existing.configFingerprint === fingerprint && existing.promptVersion === PROMPT_VERSION) return existing;
    return { articleId, contentHash, targetLanguage: config.targetLanguage, providerId, model: config.model.trim(), configFingerprint: fingerprint,
      promptVersion: PROMPT_VERSION, segments: [], completed: false, updatedAt: Date.now() };
  }
  async memoryKey(source: string, artifact: TranslationArtifact): Promise<string> {
    return digest(JSON.stringify([normalizeSource(source), artifact.targetLanguage, artifact.providerId, artifact.model, artifact.configFingerprint, artifact.promptVersion]));
  }
  async recall(source: string, artifact: TranslationArtifact): Promise<string | undefined> {
    const key = await this.memoryKey(source, artifact), item = this.state().translationMemory[key];
    if (item) item.lastUsedAt = Date.now(); return item?.translation;
  }
  async remember(source: string, translation: string, artifact: TranslationArtifact) {
    const now = Date.now(), key = await this.memoryKey(source, artifact);
    this.state().translationMemory[key] = { translation, updatedAt: now, lastUsedAt: now };
  }
  async save(artifact: TranslationArtifact) {
    artifact.updatedAt = Date.now(); this.state().translationArtifacts[artifact.articleId] = artifact;
    const artifacts = withinBytes(Object.values(this.state().translationArtifacts).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ARTIFACTS), MAX_ARTIFACT_BYTES);
    this.state().translationArtifacts = Object.fromEntries(artifacts.map(item => [item.articleId, item]));
    const memory = withinBytes(Object.entries(this.state().translationMemory).sort(([, a], [, b]) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_MEMORY), MAX_MEMORY_BYTES);
    this.state().translationMemory = Object.fromEntries(memory); await this.persist();
  }
  async clearArticle(articleId: string) { delete this.state().translationArtifacts[articleId]; await this.persist(); }
  async clearAll() { this.state().translationArtifacts = {}; this.state().translationMemory = {}; await this.persist(); }
}
