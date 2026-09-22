# Network contracts

Personal RSS Reader has no project-operated API. Runtime requests have two independent paths.

## RSS / Atom feeds

HTTP(S) GET requests use Obsidian `requestUrl` and are sent directly to URLs added manually, imported from OPML or selected in Explore. The parser accepts RSS 2.x, RSS 1.0/RDF and Atom 1.0.

Limits and safeguards:

- 20-second UI timeout and at most three concurrent feed refreshes;
- 5 MB input XML, with DTD and entity declarations rejected;
- inspect at most 200 items and retain at most 50 / about 1 MB per feed;
- at most 100,000 source characters per article body;
- sanitize HTML and resolve only safe HTTP(S) links and images;
- stable SHA-256 IDs based on feed URL and item identity;
- refresh failure preserves cached articles;
- OPML import is additive and performs no feed requests.

## OpenAI-compatible translation

Translation uses a non-streaming `POST {baseUrl}/chat/completions` only after a manual user action. HTTPS is required except for explicit `localhost`, `127.0.0.1` and `::1` HTTP endpoints.

The JSON request contains the configured model, temperature 0 and two chat messages: a minimal translation instruction containing the target language, and a JSON string array containing the current batch's plain-text blocks. The API key is sent only in the Bearer authorization header.

The response is accepted only when `choices[0].message.content` is a JSON string array with exactly the same number of string elements as the request. Invalid JSON, non-string items, missing items and extra items reject the entire batch.

401/403 errors are reported as authentication failures and are not retried. 429, timeout/network and 5xx errors are temporary and receive at most two retries with backoff. Each batch contains at most four blocks and about 1,200 characters; at most two batches run concurrently.
