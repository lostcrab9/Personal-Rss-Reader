import type { TranslationArtifact, TranslationConfig } from '../model';
import type { TranslationService } from './service';
import { TranslationError } from './service';
import { buildBatches, type TranslationSegment } from './segments';
import type { TranslationStore } from './store';

export interface TranslationRun {
  articleId: string; contentHash: string; segments: TranslationSegment[]; priorityIds?: string[]; config: TranslationConfig;
  isCurrent: () => boolean; onProgress: (artifact: TranslationArtifact) => void; bypassMemory?: boolean;
}
const delay = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

export class TranslationController {
  constructor(private service: TranslationService, private store: TranslationStore) {}
  async translate(run: TranslationRun): Promise<TranslationArtifact> {
    const artifact = await this.store.artifact(run.articleId, run.contentHash, run.config);
    const existing = new Map(artifact.segments.map(segment => [segment.id, segment]));
    const priority = new Set(run.priorityIds || []), ordered = [...run.segments].sort((a, b) => Number(priority.has(b.id)) - Number(priority.has(a.id)));
    const unique = new Map<string, TranslationSegment>();
    for (const segment of ordered) if (existing.get(segment.id)?.status !== 'complete' && !unique.has(segment.source)) unique.set(segment.source, segment);
    let recalled = false;
    for (const [source] of [...unique]) {
      if (run.bypassMemory) continue;
      const cached = await this.store.recall(source, artifact); if (!cached) continue;
      for (const match of run.segments.filter(item => item.source === source)) existing.set(match.id, { id: match.id, source, translation: cached, status: 'complete' });
      unique.delete(source); recalled = true;
    }
    artifact.segments = [...existing.values()]; artifact.completed = run.segments.every(segment => existing.get(segment.id)?.status === 'complete');
    if (recalled && run.isCurrent()) await this.store.save(artifact);
    run.onProgress(artifact);
    const batches = buildBatches([...unique.values()]); let cursor = 0;
    const parts = new Map<string, string[]>(), failures = new Set<string>();
    const worker = async () => {
      while (cursor < batches.length && run.isCurrent()) {
        const batch = batches[cursor++]; let translated: string[] | undefined; let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try { translated = await this.service.translate(batch.map(item => item.text), run.config); break; }
          catch (error) { lastError = error; if (!(error instanceof TranslationError) || !error.retryable || attempt === 2) break; await delay(300 * 2 ** attempt); }
        }
        if (!run.isCurrent()) return;
        if (!translated) for (const item of batch) failures.add(item.segmentId);
        else for (let index = 0; index < batch.length; index++) {
          const item = batch[index], values = parts.get(item.segmentId) || Array<string>(item.totalParts); values[item.part] = translated[index]; parts.set(item.segmentId, values);
        }
        for (const segment of unique.values()) {
          const values = parts.get(segment.id);
          if (values?.length && values.every(value => typeof value === 'string')) {
            const translation = values.join(' ');
            for (const match of run.segments.filter(item => item.source === segment.source)) existing.set(match.id, { id: match.id, source: match.source, translation, status: 'complete' });
            await this.store.remember(segment.source, translation, artifact);
          } else if (failures.has(segment.id)) existing.set(segment.id, { id: segment.id, source: segment.source, translation: '', status: 'failed' });
        }
        artifact.segments = [...existing.values()]; artifact.completed = run.segments.every(segment => existing.get(segment.id)?.status === 'complete');
        await this.store.save(artifact); run.onProgress(artifact);
        if (!translated && lastError instanceof TranslationError && !lastError.retryable) throw lastError;
      }
    };
    await Promise.all([worker(), worker()]); return artifact;
  }
}
