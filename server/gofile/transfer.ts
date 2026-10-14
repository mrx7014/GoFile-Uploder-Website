import { request as httpRequest } from "node:http";
import type { IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  filenameFromHeaders,
  parseSourceUrl,
  pinnedLookup,
  resolvePublicTarget,
  sanitizeFileName,
  type SafeTarget,
} from "./source";

const GOFILE_UPLOAD_URL = new URL("https://upload.gofile.io/uploadfile");
const MAX_REDIRECTS = 5;
const SOCKET_IDLE_TIMEOUT_MS = 30_000;

export type TransferProgress = {
  bytesTransferred: number;
  totalBytes: number | null;
};

export type GoFileResult = {
  id?: string;
  name: string;
  size: number | null;
  md5?: string;
  mimetype?: string;
  downloadPage: string;
};

export type TransferHooks = {
  onStage: (stage: "checking" | "connecting" | "transferring" | "finishing") => void;
  onProgress: (progress: TransferProgress) => void;
};

function makeAbortError(): Error {
  const error = new Error("Transfer cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw makeAbortError();
}

function parseLength(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function requestForTarget(target: SafeTarget, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const secure = target.url.protocol === "https:";
    const options = {
      method: "GET",
      headers: {
        "User-Agent": "GoFile-Terminal/1.0",
        Accept: "*/*",
        "Accept-Encoding": "identity",
      },
      lookup: pinnedLookup(target.address, target.family),
    } as RequestOptions & HttpsRequestOptions;
    const request = secure
      ? httpsRequest(target.url, options, (response) => {
          signal.removeEventListener("abort", abort);
          resolve(response);
        })
      : httpRequest(target.url, options, (response) => {
          signal.removeEventListener("abort", abort);
          resolve(response);
        });
    const abort = () => request.destroy(makeAbortError());
    signal.addEventListener("abort", abort, { once: true });
    request.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => request.destroy(new Error("The source connection timed out.")));
    request.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    request.end();
  });
}

async function openSource(input: string, signal: AbortSignal): Promise<{ response: IncomingMessage; url: URL }> {
  let current = parseSourceUrl(input);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    throwIfAborted(signal);
    const target = await resolvePublicTarget(current);
    const response = await requestForTarget(target, signal);

    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location;
      const drained = once(response, "end");
      response.resume();
      await drained;
      if (!location || redirects === MAX_REDIRECTS) {
        throw new Error("Stopped because the source URL redirected too many times or omitted a destination.");
      }
      current = parseSourceUrl(new URL(location, current).href);
      continue;
    }

    if (response.statusCode !== 200) {
      const status = response.statusCode;
      response.resume();
      throw new Error(status === 404
        ? "The source file was not found."
        : `The source rejected the request (HTTP ${status ?? "unknown"}).`);
    }

    const contentType = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (contentType === "text/html" || contentType === "application/xhtml+xml") {
      response.resume();
      throw new Error("The source returned a web page, not a direct file. Use a direct download link.");
    }

    return { response, url: current };
  }

  throw new Error("Could not access the source file.");
}

function multipartPrefix(boundary: string, fileName: string, contentType: string): string {
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    `Content-Type: ${contentType}`,
    "",
    "",
  ].join("\r\n");
}

function uploadWithEndpoint(
  source: IncomingMessage,
  fileName: string,
  totalBytes: number | null,
  contentType: string,
  signal: AbortSignal,
  onProgress: (progress: TransferProgress) => void,
  endpoint: URL,
): Promise<GoFileResult> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const boundary = `----gofileterm${randomUUID().replaceAll("-", "")}`;
    const prefix = multipartPrefix(boundary, fileName, contentType);
    const suffix = `\r\n--${boundary}--\r\n`;
    const client = endpoint.protocol === "https:" ? httpsRequest : httpRequest;
    const request = client(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Transfer-Encoding": "chunked",
        Accept: "application/json",
        "User-Agent": "GoFile-Terminal/1.0",
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let totalResponse = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalResponse += buffer.length;
        if (totalResponse > 1024 * 1024) {
          reject(new Error("GoFile response was larger than expected."));
          return;
        }
        chunks.push(buffer);
      });
      response.once("error", reject);
      response.once("end", () => {
        let body: { status?: string; data?: Record<string, unknown> };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof body;
        } catch {
          reject(new Error("GoFile did not return a valid response. Try again later."));
          return;
        }
        if (body.status !== "ok" || !body.data || typeof body.data.downloadPage !== "string") {
          const status = body.status;
          if (status === "error-rateLimit") reject(new Error("GoFile reached its request-rate limit. Wait a little and try again."));
          else if (status === "error-limits") reject(new Error("The free GoFile account reached its item quota."));
          else reject(new Error(`GoFile could not complete the upload (${status ?? "incomplete response"}).`));
          return;
        }
        const data = body.data;
        resolve({
          id: typeof data.id === "string" ? data.id : undefined,
          name: typeof data.name === "string" ? data.name : fileName,
          size: typeof data.size === "number" ? data.size : totalBytes,
          md5: typeof data.md5 === "string" ? data.md5 : undefined,
          mimetype: typeof data.mimetype === "string" ? data.mimetype : undefined,
          downloadPage: String(data.downloadPage),
        });
      });
    });

    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const abort = () => {
      source.destroy(makeAbortError());
      request.destroy(makeAbortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    request.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => request.destroy(new Error("The GoFile connection timed out.")));
    request.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      source.destroy(error);
      finishReject(error);
    });
    source.once("error", (error) => {
      request.destroy(error);
      finishReject(error);
    });

    let transferred = 0;
    let lastReportedAt = Date.now();
    let lastReportedBytes = 0;
    source.on("data", (chunk: Buffer | string) => {
      transferred += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      const now = Date.now();
      if (transferred - lastReportedBytes >= 512 * 1024 || now - lastReportedAt >= 700) {
        onProgress({ bytesTransferred: transferred, totalBytes });
        lastReportedAt = now;
        lastReportedBytes = transferred;
      }
    });
    source.once("end", () => {
      onProgress({ bytesTransferred: transferred, totalBytes });
      request.end(suffix);
    });

    request.write(prefix);
    source.pipe(request, { end: false });
  });
}

export async function transferUrlToGoFile(
  inputUrl: string,
  requestedName: unknown,
  signal: AbortSignal,
  hooks: TransferHooks,
): Promise<GoFileResult> {
  hooks.onStage("checking");
  const parsed = parseSourceUrl(inputUrl);
  hooks.onStage("connecting");
  const { response: source, url } = await openSource(parsed.href, signal);
  const fileName = typeof requestedName === "string" && requestedName.trim()
    ? sanitizeFileName(requestedName.trim())
    : filenameFromHeaders(source.headers["content-disposition"], url);
  const totalBytes = parseLength(source.headers["content-length"]);
  const responseContentType = source.headers["content-type"]?.split(";")[0]?.trim() ?? "application/octet-stream";
  const contentType = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(responseContentType)
    ? responseContentType
    : "application/octet-stream";

  hooks.onStage("transferring");
  const result = await uploadWithEndpoint(
    source,
    fileName,
    totalBytes,
    contentType,
    signal,
    hooks.onProgress,
    GOFILE_UPLOAD_URL,
  );
  hooks.onStage("finishing");
  return result;
}

export const testing = { multipartPrefix, uploadWithEndpoint };
