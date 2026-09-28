import { setIcon } from 'obsidian';
import { safeUrl, titleOf, type Entry } from './model';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export function audioUrl(entry: Entry): string | null {
  if (!entry.audio) return null;
  const url = safeUrl(entry.audio.url);
  const type = entry.audio.type?.toLocaleLowerCase();
  return url && (!type || type.startsWith('audio/')) ? url : null;
}

export interface AudioDockStore {
  position: (entryId: string) => number;
  rate: () => number;
  savePosition: (entryId: string, position: number) => void;
  saveRate: (rate: number) => void;
}

/** A single player outside the article, so playback survives list and channel navigation. */
export class AudioDock {
  private entry: Entry | null = null;
  private el: HTMLElement;
  private audio: HTMLAudioElement;
  private title: HTMLButtonElement;
  private rate: HTMLSelectElement;
  private error: HTMLElement;
  private lastSaved = 0;
  constructor(parent: HTMLElement, private openEntry: (entry: Entry) => void, private store: AudioDockStore) {
    this.el = parent.createDiv({ cls: 'qrs-audio-dock is-hidden' });
    const inner = this.el.createDiv('qrs-audio-inner');
    const heading = inner.createDiv('qrs-audio-heading');
    const close = heading.createEl('button', { cls: 'qrs-icon qrs-audio-close' });
    setIcon(close, 'x'); close.createSpan({ cls: 'qrs-visually-hidden', text: '停止并关闭播放器' });
    close.onclick = () => this.stop();
    this.title = heading.createEl('button', { cls: 'qrs-audio-title' });
    this.title.onclick = () => { if (this.entry) this.openEntry(this.entry); };
    const rateId = `qrs-audio-rate-${crypto.randomUUID()}`;
    heading.createEl('label', { cls: 'qrs-visually-hidden', text: '播放速度', attr: { for: rateId } });
    this.rate = heading.createEl('select', { cls: 'qrs-audio-rate', attr: { id: rateId, 'aria-label': '播放速度' } });
    for (const value of PLAYBACK_RATES) this.rate.createEl('option', { value: String(value), text: `${value}×` });
    this.rate.value = String(this.normalizedRate(this.store.rate()));
    this.rate.onchange = () => {
      const value = this.normalizedRate(Number(this.rate.value));
      this.audio.playbackRate = value; this.store.saveRate(value);
    };
    const controls = inner.createDiv('qrs-audio-controls');
    this.audio = controls.createEl('audio', { attr: { controls: '', preload: 'none' } });
    this.error = controls.createEl('p', { cls: 'qrs-media-error is-hidden', text: '音频暂时无法播放，可以打开原文收听。' });
    this.audio.addEventListener('error', () => { if (this.audio.getAttribute('src')) this.error.removeClass('is-hidden'); });
    this.audio.addEventListener('loadedmetadata', () => {
      if (!this.entry) return;
      this.audio.playbackRate = this.normalizedRate(this.store.rate());
      const position = this.store.position(this.entry.id);
      if (position > 0 && (!Number.isFinite(this.audio.duration) || position < this.audio.duration - 2)) this.audio.currentTime = position;
    });
    this.audio.addEventListener('timeupdate', () => {
      if (Math.abs(this.audio.currentTime - this.lastSaved) >= 5) this.saveCurrent();
    });
    this.audio.addEventListener('pause', () => this.saveCurrent());
    this.audio.addEventListener('ended', () => { if (this.entry) this.store.savePosition(this.entry.id, 0); this.lastSaved = 0; });
    this.audio.addEventListener('play', () => {
      if (!this.entry || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
      navigator.mediaSession.metadata = new MediaMetadata({ title: titleOf(this.entry), artist: this.entry.sourceName || '' });
    });
  }
  open(entry: Entry): void {
    if (this.entry?.id === entry.id) return;
    this.stop();
    const url = audioUrl(entry); if (!url) return;
    this.entry = entry; this.lastSaved = this.store.position(entry.id);
    this.title.setText(titleOf(entry)); this.rate.value = String(this.normalizedRate(this.store.rate()));
    this.audio.playbackRate = Number(this.rate.value); this.audio.src = url;
    this.error.addClass('is-hidden'); this.el.removeClass('is-hidden');
  }
  started(): boolean { return !!this.entry && (!this.audio.paused || this.audio.currentTime > 0); }
  stop(): void {
    if (this.entry) { this.saveCurrent(); this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
    this.entry = null; this.error.addClass('is-hidden'); this.el.addClass('is-hidden');
  }
  private normalizedRate(value: number): number {
    return PLAYBACK_RATES.includes(value as typeof PLAYBACK_RATES[number]) ? value : 1;
  }
  private saveCurrent() {
    if (!this.entry || !Number.isFinite(this.audio.currentTime)) return;
    this.lastSaved = this.audio.currentTime; this.store.savePosition(this.entry.id, this.audio.currentTime);
  }
}
