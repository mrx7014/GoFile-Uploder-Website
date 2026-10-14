import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicIp, parseSourceUrl, resolvePublicTarget, sanitizeFileName } from "./source";
import { testing, type TransferProgress } from "./transfer";

const servers: Array<ReturnType<typeof createServer>> = [];

async function listen(server: ReturnType<typeof createServer>): Promise<URL> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  return new URL(`http://127.0.0.1:${address.port}/upload`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("source URL safety", () => {
  it("accepts only credential-free HTTP(S) URLs on their default ports", () => {
    expect(parseSourceUrl("https://files.example/archive.zip").hostname).toBe("files.example");
    expect(() => parseSourceUrl("ftp://files.example/archive.zip")).toThrow("Only HTTP and HTTPS");
    expect(() => parseSourceUrl("https://user:pass@files.example/file.zip")).toThrow("credentials");
    expect(() => parseSourceUrl("https://files.example:8443/file.zip")).toThrow("default HTTP or HTTPS port");
  });

  it("blocks private, loopback, link-local, reserved, and mapped-private IP addresses", () => {
    for (const address of [
      "0.0.0.0", "10.10.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
      "172.20.0.1", "192.168.1.5", "198.18.0.1", "224.0.0.1", "::", "::1",
      "fc00::2", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::1",
    ]) {
      expect(isPublicIp(address), address).toBe(false);
    }
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
  });

  it("rejects loopback destinations before opening an outbound request", async () => {
    await expect(resolvePublicTarget(parseSourceUrl("http://127.0.0.1/secret")))
      .rejects.toThrow("non-public network address");
    await expect(resolvePublicTarget(parseSourceUrl("http://[::1]/secret")))
      .rejects.toThrow("non-public network address");
  });

  it("sanitizes remote filenames before using them in multipart headers", () => {
    expect(sanitizeFileName('../../private\r\nfile.zip')).toBe(".._.._private__file.zip");
  });
});

describe("streaming multipart upload", () => {
  it("sends a chunked multipart body and parses GoFile's success response", async () => {
    let capturedBody = Buffer.alloc(0);
    let wasChunked = false;
    const localGoFile = createServer((request, response) => {
      wasChunked = request.headers["transfer-encoding"] === "chunked";
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        capturedBody = Buffer.concat(chunks);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          status: "ok",
          data: { id: "local-test-id", name: "sample.txt", size: 12, md5: "abc", mimetype: "text/plain", downloadPage: "https://gofile.io/d/localtest" },
        }));
      });
    });
    const endpoint = await listen(localGoFile);
    const input = Buffer.from("hello world!", "utf8");
    const source = Readable.from([input]) as unknown as IncomingMessage;
    const controller = new AbortController();
    const progress: TransferProgress[] = [];

    const result = await testing.uploadWithEndpoint(
      source,
      "sample.txt",
      input.length,
      "text/plain",
      controller.signal,
      (value) => progress.push(value),
      endpoint,
    );

    expect(wasChunked).toBe(true);
    expect(capturedBody.toString("utf8")).toContain('name="file"; filename="sample.txt"');
    expect(capturedBody.includes(input)).toBe(true);
    expect(capturedBody.toString("utf8")).toContain("\r\n------gofileterm");
    expect(result.downloadPage).toBe("https://gofile.io/d/localtest");
    expect(result.size).toBe(12);
    expect(progress.at(-1)?.bytesTransferred).toBe(input.length);
  });
});
