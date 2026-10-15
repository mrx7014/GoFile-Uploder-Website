import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { parseSourceUrl, pinnedLookup, resolvePublicTarget } from "./source.js";

type Provider = "direct" | "mediafire" | "google-drive" | "sourceforge" | "pixeldrain";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

type TextResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string; url: URL };

function requestText(target: Awaited<ReturnType<typeof resolvePublicTarget>>, signal: AbortSignal): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Transfer cancelled."));
    const client = target.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = client(target.url, {
      method: "GET",
      headers: { "User-Agent": "GoFile-Terminal/1.0", Accept: "text/html,application/json,*/*", "Accept-Encoding": "identity" },
      lookup: pinnedLookup(target.address, target.family),
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes <= MAX_PAGE_BYTES) chunks.push(buffer);
        else request.destroy(new Error("The provider page was larger than expected."));
      });
      response.once("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      response.once("error", reject);
    });
    const abort = () => request.destroy(new Error("Transfer cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    request.setTimeout(30_000, () => request.destroy(new Error("The provider connection timed out.")));
    request.once("error", error => { signal.removeEventListener("abort", abort); reject(error); });
    request.end();
  });
}

async function readPublicText(input: URL, signal: AbortSignal): Promise<TextResponse> {
  let current = input;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const target = await resolvePublicTarget(current);
    const response = await requestText(target, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location || redirects === MAX_REDIRECTS) throw new Error("The provider redirected too many times.");
      current = parseSourceUrl(new URL(Array.isArray(location) ? location[0] : location, current).href);
      continue;
    }
    return { ...response, url: current };
  }
  throw new Error("The provider redirected too many times.");
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function googleDriveId(url: URL): string | null {
  const fromQuery = url.searchParams.get("id");
  const fromPath = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1];
  const id = fromQuery ?? fromPath;
  return id && /^[A-Za-z0-9_-]{10,200}$/.test(id) ? id : null;
}

function pixeldrainId(url: URL): string | null {
  const match = url.pathname.match(/\/(?:u|v|f|io|d)\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

function mediafireCandidate(body: string): string | null {
  const matches = body.match(/https:\/\/download[^"'\s<>]+/gi) ?? [];
  for (const candidate of matches) {
    try { return parseSourceUrl(candidate.replaceAll("&amp;", "&")).href; } catch { /* ignore malformed HTML matches */ }
  }
  return null;
}

export type ResolvedSource = { url: string; provider: Provider; originalUrl: string };

export async function resolveProviderSource(input: string, signal: AbortSignal): Promise<ResolvedSource> {
  const original = parseSourceUrl(input);
  const host = hostOf(original);
  if (host === "mediafire.com" || host.endsWith(".mediafire.com")) {
    const page = await readPublicText(original, signal);
    const candidate = mediafireCandidate(page.body);
    if (!candidate) throw new Error("Could not find a direct MediaFire download link. The page may require browser interaction.");
    return { url: candidate, provider: "mediafire", originalUrl: original.href };
  }
  if (host === "drive.google.com" || host === "docs.google.com" || host === "drive.usercontent.google.com") {
    const id = googleDriveId(original);
    if (!id) throw new Error("Could not read a public Google Drive file ID from that URL.");
    return { url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, provider: "google-drive", originalUrl: original.href };
  }
  if (host === "pixeldrain.com" || host === "pixeldrain.net") {
    const id = pixeldrainId(original);
    if (!id) throw new Error("Could not read a Pixeldrain file ID from that URL.");
    return { url: `https://pixeldrain.com/api/file/download/${encodeURIComponent(id)}`, provider: "pixeldrain", originalUrl: original.href };
  }
  if (host === "sourceforge.net" || host === "downloads.sourceforge.net") {
    return { url: original.href, provider: "sourceforge", originalUrl: original.href };
  }
  return { url: original.href, provider: "direct", originalUrl: original.href };
}
