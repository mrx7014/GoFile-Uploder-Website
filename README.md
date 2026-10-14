# GoFile Uploader Website — Direct Link Transfer

An English-language, terminal-inspired web app that streams a direct HTTP(S) file URL from its source to GoFile. The browser sends the URL and optional filename to the app; the server streams the file onward without downloading it to the user's device or buffering the complete file in memory.

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The development server listens on `http://localhost:3000` by default and honors `PORT`.

Useful project commands:

```bash
pnpm check
pnpm test
pnpm build
pnpm start
```

No GoFile API key is required for basic guest uploads. The app uses the current upload endpoint at `https://upload.gofile.io/uploadfile` and displays GoFile's returned download page. Automated tests use a local mock server and do not upload files to GoFile.

## Upload history

The Terminal offers a **History** view with the latest 100 successful uploads saved in this browser profile using `localStorage`. It stores only the returned GoFile link, filename, completion time, reported size, and available GoFile metadata; it does not retain the source URL, its query string, or file contents. You can copy or open a saved GoFile link and clear the local history with confirmation. Browser-local history is not shared with other browsers or devices. Cross-device, per-user history would need sign-in and authenticated server-side storage; this first version deliberately avoids exposing a global upload history to anonymous visitors.

## Transfer behavior and security

The API is `POST /api/upload-from-url`. It returns newline-delimited JSON events for validation, connection, transfer progress, and the final GoFile response. Canceling the browser request aborts both outbound connections.

The server accepts HTTP(S) URLs on default ports only. It resolves and pins public IP addresses, blocks private/reserved destinations, rechecks redirects, and does not forward source credentials. It accepts direct file URLs rather than pages that only contain a download button. The browser and server do not log the complete source URL.

## Hosting limits

The app does not set a fixed file-size cap and streams bytes rather than buffering whole files. This is not “unlimited”: source hosts can time out, GoFile enforces account quotas and rate limits, and hosting providers have their own network, time, memory, and request limits. GoFile currently documents a 10,000-item cap for free accounts.

Vercel supports Express applications. The root `app.ts` exports the Express app, `vercel.json` runs the build command, and the build helper copies the Vite output to root `public/` for Vercel's static asset CDN. On Vercel, Express runs as a Function and inherits the provider's execution limits; only the small URL request body is sent to the function, not the file bytes. Vercel Functions document a 4.5 MB payload limit and, on Hobby with Fluid Compute, a 300-second maximum duration. For large files or transfers that may take longer, use a long-running Node/container host. Neither hosting choice overrides GoFile limits.

Before enabling an anonymous deployment for broad public use, add and configure an abuse-control policy appropriate to the operator's bandwidth and GoFile account. The private source repository and this preview do not by themselves make a deployed site private.

## Attribution

The upload flow is based on GoFile's public API documentation. This is an independent project and is not affiliated with or endorsed by GoFile.
