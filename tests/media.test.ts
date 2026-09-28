// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { audioUrl } from '../src/media';
import { initialState, type Entry } from '../src/model';
import { needsWebArticle } from '../src/web-articles';

const episode: Entry = { id: 'episode', sourceId: 'podcast', origin: 'local', title: 'Episode', link: 'https://example.com/episode', audio: { url: 'https://media.example/episode.mp3', type: 'audio/mpeg', durationSeconds: 120 } };

describe('podcast media', () => {
  it('accepts safe HTTP(S) audio URLs with audio MIME types only', () => {
    expect(audioUrl(episode)).toBe('https://media.example/episode.mp3');
    expect(audioUrl({ ...episode, audio: { url: 'http://media.example/episode.mp3', type: null } })).toBe('http://media.example/episode.mp3');
    expect(audioUrl({ ...episode, audio: { url: 'javascript:alert(1)', type: 'audio/mpeg' } })).toBeNull();
    expect(audioUrl({ ...episode, audio: { url: 'https://example.com/page', type: 'text/html' } })).toBeNull();
  });
  it('does not fetch webpage full text for podcast episodes', () => {
    expect(needsWebArticle(episode, document)).toBe(false);
  });
  it('persists bounded playback settings through state parsing', () => {
    const state = initialState({ settings: { playbackRate: 1.5 }, playbackProgress: { episode: { position: 42, updatedAt: 10 } } });
    expect(state.settings.playbackRate).toBe(1.5); expect(state.playbackProgress.episode.position).toBe(42);
    expect(initialState({ settings: { playbackRate: 9 } }).settings.playbackRate).toBe(1);
  });
});
