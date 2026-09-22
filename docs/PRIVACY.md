# Privacy policy

Effective: 2026-09-09. Personal RSS Reader is a vault-local RSS / Atom reader. It has no project-operated API, account system, analytics, ads or telemetry.

## Network access

- Adding or refreshing a subscription requests only that feed URL. Its host receives ordinary connection metadata. Refreshes are user-driven or occur when a selected feed cache is older than five minutes; no background polling is registered.
- Optional webpage full-text extraction is off by default. When enabled, opening an article with less than 200 characters of feed body may request its linked webpage once. The destination receives ordinary connection metadata. Successfully extracted content is cached locally. The request API may follow redirects that the plugin cannot validate hop by hop; enable this only for trusted feeds.
- The offline discovery catalog performs no network requests while browsing, searching or filtering. Clicking Subscribe fetches only the selected feed.
- When images are enabled, raster article images and thumbnails are downloaded through Obsidian and kept in the plugin image cache. Their hosts receive the request. SVG and executable payloads are not rendered.
- Opening an article link deliberately uses the system browser and is governed by that site's policy.
- AI translation is disabled by default. Only “Test connection” or a manual “Generate translation” action contacts the user-configured OpenAI-compatible service. The request includes the target language, minimal instructions and the selected article's current batch of plain text. It does not include the article URL, subscriptions, searches, favorites or read state.

The project does not receive or proxy any of these requests.

## Local storage

Settings, feed URLs, cached entries (including optional extracted webpage text), read IDs, favorites, translation artifacts and translation memory are stored through Obsidian in this vault's plugin data. Images are stored in the configured plugin directory's `image-cache` folder. OPML export is the only ordinary vault-file write and occurs only when explicitly requested.

API keys and private feed URLs are stored as local plaintext. They are excluded from translation prompts, error details, cache keys and OPML except that a feed URL itself is necessarily present in an OPML subscription export. If the vault configuration is synchronized, the chosen sync provider may copy plugin data and image cache files.

To remove the data, disable the plugin and delete its `data.json` and `image-cache` from the configured plugin directory. Separately exported OPML files remain under the user's control.
