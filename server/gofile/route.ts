import type { Request, Response } from "express";
import { parseSourceUrl } from "./source";
import { transferUrlToGoFile } from "./transfer";

type StreamEvent = Record<string, unknown> & { type: string };

function writeEvent(response: Response, event: StreamEvent): void {
  if (response.destroyed || response.writableEnded) return;
  response.write(`${JSON.stringify(event)}\n`);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Transfer cancelled.";
  const message = error instanceof Error ? error.message : "";
  const safePrefixes = [
    "Enter a valid direct file URL.",
    "Could not read that URL.",
    "Only HTTP and HTTPS links are supported.",
    "URLs containing login credentials are not allowed.",
    "Use a URL on the default HTTP or HTTPS port.",
    "The hostname in that URL is invalid.",
    "Could not reach the URL's host.",
    "This URL points to a non-public network address",
    "Could not reach the URL's host.",
    "Stopped because the source URL redirected too many times",
    "The source file was not found.",
    "The source rejected the request",
    "The source returned a web page",
    "The source connection timed out",
    "The GoFile connection timed out",
    "GoFile reached its request-rate limit",
    "The free GoFile account reached its item quota",
    "GoFile did not return a valid response",
    "GoFile could not complete the upload",
    "GoFile response was larger than expected.",
  ];
  if (safePrefixes.some((prefix) => message.startsWith(prefix))) return message;
  return "The transfer could not be completed. Check the direct file link and try again.";
}

export async function uploadFromUrlRoute(request: Request, response: Response): Promise<void> {
  const body = request.body as { url?: unknown; fileName?: unknown } | undefined;
  let sourceUrl: URL;

  try {
    sourceUrl = parseSourceUrl(body?.url);
  } catch (error) {
    response.status(400).json({ error: safeErrorMessage(error) });
    return;
  }

  const requestedFileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 220) : undefined;
  const controller = new AbortController();
  response.status(200);
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, no-transform");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  const onClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  response.once("close", onClose);

  try {
    const result = await transferUrlToGoFile(
      sourceUrl.href,
      requestedFileName,
      controller.signal,
      {
        onStage: (stage) => writeEvent(response, { type: "stage", stage }),
        onProgress: ({ bytesTransferred, totalBytes }) =>
          writeEvent(response, { type: "progress", bytesTransferred, totalBytes }),
      },
    );
    writeEvent(response, { type: "result", result });
  } catch (error) {
    if (!response.destroyed) {
      writeEvent(response, {
        type: error instanceof Error && error.name === "AbortError" ? "cancelled" : "error",
        message: safeErrorMessage(error),
      });
    }
  } finally {
    response.off("close", onClose);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
