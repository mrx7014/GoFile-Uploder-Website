# GoFile Uploader Website

A terminal-style web app that resolves public download links and streams the file to GoFile without downloading it to the visitor's device or buffering the whole file in memory.

> Independent and unofficial. It is not affiliated with GoFile. Only transfer files you have the right to share.

## What it supports

- Direct HTTP(S) file URLs.
- Public MediaFire page URLs (static direct-link extraction).
- Public Google Drive links using the file ID.
- SourceForge links through safe redirect handling.
- Public Pixeldrain links through its download endpoint.
- Live NDJSON status events and truthful progress when `Content-Length` is available.
- Cancellation of source and GoFile connections.
- Browser-local history of the latest 100 confirmed GoFile links.
- SSRF protections: public-address validation, DNS pinning, credential-free URLs, safe redirects, timeouts and sanitized filenames.
- Optional Cloudflare Turnstile verification and in-memory per-IP rate limiting for anonymous abuse control.

The browser sends the URL and optional filename. The server streams bytes directly:

```text
Browser → Express resolver/checks → source stream → GoFile upload API
```

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`.

## Production configuration

Copy `.env.example` to `.env` and set the following before opening the service to the public:

| Variable | Purpose |
|---|---|
| `TURNSTILE_SITE_KEY` | Public Cloudflare Turnstile site key sent to the browser. |
| `TURNSTILE_SECRET_KEY` | Server-only Turnstile verification secret. Required in production. |
| `RATE_LIMIT_WINDOW_MS` | Optional rate-limit window; defaults to 60 seconds. |
| `RATE_LIMIT_MAX_REQUESTS` | Optional attempts per IP/window; defaults to 5. |
| `TRANSFER_SOCKET_IDLE_TIMEOUT_MS` | Optional idle socket timeout; defaults to 30 seconds. |

When `TURNSTILE_SECRET_KEY` is missing, local development remains usable. In production, requests are rejected until Turnstile is configured. Never expose the secret key to the browser.

## Large files

The transfer path is stream-based and does not impose an application-level file-size cap or store the complete file in memory. Real limits still come from the source, GoFile and the hosting provider.

For very large or long-running transfers, use the included Docker image or a long-running Node/VPS/container host:

```bash
docker build -t gofile-uploader .
docker run --env-file .env -p 3000:3000 gofile-uploader
```

Vercel can deploy the Express app, but its serverless execution duration and runtime limits make it unsuitable for guaranteeing very large transfers. Posting only a URL avoids sending file bytes in the request body; it does not remove the function duration limit.

## API

### `POST /api/upload-from-url`

Request body:

```json
{
  "url": "https://example.com/file.zip",
  "fileName": "optional-name.zip",
  "turnstileToken": "optional-in-development"
}
```

The response is newline-delimited JSON (`application/x-ndjson`) with `stage`, `progress`, `result`, `error` or `cancelled` events.

### `GET /api/health`

Returns `{ "status": "ok" }`.

## Development checks

```bash
pnpm check
pnpm test
pnpm build
```

## Security and abuse controls

The server blocks private and reserved network destinations, validates every redirect, pins DNS results for outbound requests, does not forward source credentials, and does not log full source URLs. Turnstile and rate limiting should be enabled before public deployment. For a high-traffic public relay, replace the in-memory limiter with a shared store and add authentication, quotas or a queue.

## License

MIT — see [`LICENSE`](LICENSE).
