# GoFile Uploader Website — Implementation Plan

## Goal and scope

Build an English-language website where a user enters a direct file URL, the server streams the file from its source to GoFile, and the interface displays truthful transfer progress and the resulting GoFile link. The user reviews the working preview before any GitHub repository is created or code is pushed. When the user later authorizes repository publishing, the repository must be private.

The terminal also keeps a local browser history of recent successful transfers. To avoid exposing one visitor's file links to other anonymous visitors, the first version stores history only in that browser profile and does not save source URLs, credentials, or file contents. Cross-device history would require authenticated accounts and per-user server-side persistence, and can be added separately.

The app will not claim unlimited transfers. It will avoid an arbitrary application-level file-size cap and stream bytes without loading the entire file into memory. Source servers, GoFile quotas/rate limits, and hosting runtime limits still apply. Vercel Functions document a 4.5 MB request/response payload ceiling and finite execution duration (Hobby maximum 300 seconds); posting only the URL avoids sending file bytes in that request body, but does not remove function-duration or provider limits. GoFile documents a 10,000-item cap on free accounts plus per-endpoint rate limits. A long-running Node/container host is a better match for large or long transfers, though it is still bounded by its provider and GoFile. Sources: [1]–[5].

## Design system

- **Design Movement:** A modern developer terminal and industrial control panel, with restrained neo-brutalist borders and an original product identity. The visual inspiration is GoFile's blue/yellow balance, not its logo or an implication of affiliation.
- **Core Principles:** (1) Make operation status and progress immediately legible. (2) Treat source URLs and remote content as untrusted. (3) Keep the interface clear and usable at desktop and mobile sizes. (4) Show only confirmed outcomes and explain real limits.
- **Color Philosophy:** Deep navy creates a focused work surface; slate-blue separates panels without visual clutter. Electric cyan identifies active network paths, links, and progress. Warm yellow highlights the primary action and relevant cautions. Green is reserved for success and red for errors/cancellation.
- **Layout Paradigm:** An instrument-panel composition rather than a generic centered card grid: compact top bar, source controls on one side, and a large terminal activity surface and result on the other. At narrow widths these become a straightforward vertical flow.
- **Signature Elements:** A thin cyan terminal frame; a cyan/yellow four-step transfer rail; small hardware-style status indicators.
- **Interaction Philosophy:** Paste a direct link, review the destination/filename, and explicitly start. The server emits real states; the UI never invents percentage progress. Cancellation closes both outbound connections. Retry is manual and warns that an interrupted response can leave an uncertain prior GoFile result.
- **Animation:** Restrained 120–220 ms focus and status transitions. Animate only the active indicator during transfer. Honor `prefers-reduced-motion`; status is never communicated by motion alone.
- **Typography System:** IBM Plex Sans for English UI and IBM Plex Mono for command output, URLs, filenames, numbers, and metadata. Use a clear hierarchy from page heading to section labels, helper text, and form controls.
- **Brand Essence:** “GoFile Uploader Website — a transparent terminal for moving a direct file link to GoFile.” Personality: **direct, careful, dependable**.
- **Brand Voice:** Calm, concise, and factual; never promise provider behavior the app cannot control. Examples: “Paste a direct file URL. We’ll validate it before opening a transfer.” and “Transfer complete. Review the GoFile link before copying it.”
- **Wordmark & Logo:** An original small mark of three short data paths entering one port and leaving as a link arrow, paired with the “GoFile Uploader Website” wordmark. Do not use GoFile's logo.
- **Signature Brand Color:** Electric cyan `#38C8F4`, balanced by a warm yellow action color `#F6C945`.

## Frontend and interaction

Use the existing React/Vite app and replace its template page with an English terminal-style transfer console. The form accepts one HTTP(S) direct-file URL and an optional output filename. It sends only this small metadata request to the backend; the browser does not download or upload the file bytes. Show validation, source connection, streaming, finalization, success/error/cancellation states. Display a percentage only when the source provides a trustworthy `Content-Length`; otherwise show an indeterminate active state. On success, display GoFile's download URL, filename and response metadata when available, plus a copy action. Keep the log LTR, keyboard-accessible, mobile-friendly, and readable with reduced motion. Provide an explicit cancel button and a manual retry action.

The visible interface explains that the app itself does not impose a fixed file-size cap, but GoFile and hosting/source providers impose their own limits. It names Vercel Functions as finite-duration serverless functions, not a promise of unlimited processing.

Add a “History” view inside the terminal console. Save only server-confirmed successful transfers to `localStorage`: filename, GoFile download URL, completed timestamp, reported byte size, and available response metadata. Show the latest 100 entries in reverse chronological order with open/copy actions; allow the user to clear local history after an explicit confirmation. Validate persisted entries and GoFile URLs on read, tolerate malformed/unavailable storage, and never store the source URL, secret query strings, or file bytes. Explain that this browser-local history is not synced across devices.

## Server and transfer flow

Use the existing Express server, with a dedicated `POST /api/upload-from-url` NDJSON streaming route. The request contains only the URL and optional filename. The server validates the URL, resolves and pins public DNS addresses, rejects private/reserved/local destinations, and follows only a small number of redirects while revalidating every destination. Permit HTTP(S) on default ports only, never forward source credentials, and avoid logging full URLs or query tokens.

Fetch the remote file with Node HTTP(S) streams and backpressure, then forward bytes directly as a chunked `multipart/form-data` stream to the current official GoFile upload endpoint `https://upload.gofile.io/uploadfile`. Do not store the file or buffer it in memory. Obtain the filename from safe response metadata or the URL path, sanitize it, and treat source `Content-Length` as optional metadata rather than a security boundary. Report byte counts and a percentage only when a reliable total is known. Handle GoFile JSON statuses, rate limits, free-account quota errors, source failures, redirect failures, timeouts, and cancellation. Cancellation tears down source and GoFile requests; retries are explicit and never automatic after an uncertain upload result. Guest uploads need no client-side token; no GoFile token is exposed to the browser.

The root `app.ts` exports the Express app for Vercel's zero-configuration Express integration. A build helper copies Vite's production output to root `public/` so Vercel can serve the SPA and hashed assets via its static CDN; the runtime handles API routes. The existing `server/_core/index.ts` remains the local and container entrypoint and configures Vite or local static serving. The `vercel.json` build command invokes the same pinned `pnpm build` script. This makes the project Vercel-deployable, but a Vercel Express app is one Vercel Function and inherits the function payload and execution-time limits. Large or long transfers should use a long-running Node/container host.

## Project structure

- `app.ts`: Express app factory and Vercel-compatible default export.
- `client/src/pages/Home.tsx`: English transfer console and form/result states.
- `client/src/lib/uploadHistory.ts`: validated, browser-local successful-transfer history.
- `client/src/index.css`: responsive terminal layout, palette, and reduced-motion rules.
- `client/public/manus-routes.json`: route declaration for the home page.
- `server/_core/index.ts`: local/container Express entrypoint; configures development Vite or production static serving.
- `server/gofile/source.ts`: URL validation, public-address checks, DNS pinning, filename and redirect helpers.
- `server/gofile/transfer.ts`: source download and streamed multipart relay to GoFile.
- `server/gofile/route.ts`: NDJSON API events and response-disconnect cancellation.
- `server/gofile/transfer.test.ts`: local unit/integration tests using fake local HTTP servers; no GoFile quota is consumed in tests.
- `scripts/prepare-vercel-assets.mjs`: prepare the root `public/` directory for Vercel's static asset delivery.
- `package.json`, `pnpm-lock.yaml`, `vercel.json`: pinned build workflow and Vercel configuration.
- Database remains disabled; no persistence is needed for a transient transfer in the initial version.

## Hosting and scope boundaries

Use the managed Node/Express project runtime for preview. Vercel supports Express and can serve static files from root `public/`, but the Express process runs as a Function with a finite maximum duration; it cannot fulfill a promise of unlimited processing. For larger transfers, deploy the same Express app to a long-running Node/container host with streaming support. Neither option removes GoFile's own account or rate limits. The preview comes first; do not publish the website or repository until the user has reviewed it and authorized the next step. A public deployment should add an abuse-control policy before opening an anonymous remote-fetch relay to the internet.

## References

[1]: https://gofile.io/api "GoFile API Documentation"
[2]: https://vercel.com/docs/functions/limitations "Vercel Functions Limitations"
[3]: https://vercel.com/docs/functions/configuring-functions/duration "Vercel Function Duration"
[4]: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-of-serverless-functions "Vercel Guide to the 4.5 MB Function Payload Limit"
[5]: https://vercel.com/docs/frameworks/backend/express "Express on Vercel"

Requested GitHub repository name: `GoFile-Uploder-Website` (the user-provided spelling).
