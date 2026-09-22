# Personal RSS Reader design

## Product boundary

The plugin is a vault-local reader for feeds the user explicitly adds, imports or chooses from the offline Explore directory. There is no project service, account, aggregated channel, note integration or vault Markdown source.

## Reader

The primary view is a two-pane list and article reader. The channel picker contains only My Subscriptions, subscription groups and individual feeds. Search, unread state, favorites, list width, focus mode and typography remain local and persist across sessions.

RSS / Atom HTML is sanitized before display. Images are optional, validated and rendered from the local image cache. Feed refreshes have a 20-second UI timeout, at most three workers and preserve old entries on failure.

## Translation

AI translation is optional and manual. The user supplies one OpenAI-compatible Base URL, plaintext local API key, model and target language.

The implementation is split into four boundaries:

- `translation/segments.ts`: stable visible-block IDs, normalized text, content hashing, long-block splitting and batch construction.
- `translation/service.ts`: endpoint validation, minimal chat-completion requests, strict JSON-array parsing, timeout and actionable error categories.
- `translation/store.ts`: article artifacts, configuration identity, global translation memory and bounded LRU cleanup.
- `translation/controller.ts`: viewport-first ordering, source deduplication, two-worker scheduling, finite retry, incremental persistence and stale-response rejection.

The view always starts from sanitized original HTML. Translations are inserted with `textContent`, never interpreted as HTML. Original, bilingual and translated modes read the same artifact and never trigger requests merely by switching display mode. Images, code, tables and untranslated content remain visible; source blocks containing links remain present in translated mode so navigation is not lost.

## Validation

Run `npm run check`. UI validation should cover desktop and narrow/mobile panes, subscription/discovery flows, cached/offline reading, all three translation modes, partial failure/retry, article switches during translation and persistence after reload.
