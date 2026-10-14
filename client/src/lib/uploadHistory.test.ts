import { describe, expect, it } from "vitest";
import {
  createUploadHistoryEntry,
  isSafeGoFileDownloadPage,
  MAX_UPLOAD_HISTORY_ENTRIES,
  normalizeUploadHistory,
} from "./uploadHistory";

const fixedTime = new Date("2026-10-12T12:00:00.000Z");

describe("browser-local upload history", () => {
  it("creates a successful-upload record without source URL or file contents", () => {
    const entry = createUploadHistoryEntry({
      id: "gofile-item-1",
      name: "archive.zip",
      downloadPage: "https://gofile.io/d/test_file-1",
      size: 4096,
      md5: "0123456789abcdef",
      mimetype: "application/zip",
    }, fixedTime);

    expect(entry).toEqual({
      id: "gofile-item-1",
      name: "archive.zip",
      downloadPage: "https://gofile.io/d/test_file-1",
      completedAt: fixedTime.toISOString(),
      size: 4096,
      md5: "0123456789abcdef",
      mimetype: "application/zip",
    });
    expect("sourceUrl" in (entry ?? {})).toBe(false);
    expect("fileContents" in (entry ?? {})).toBe(false);
  });

  it("accepts only https GoFile share pages", () => {
    expect(isSafeGoFileDownloadPage("https://gofile.io/d/abc_123")).toBe(true);
    expect(isSafeGoFileDownloadPage("http://gofile.io/d/abc")).toBe(false);
    expect(isSafeGoFileDownloadPage("https://gofile.io.evil.test/d/abc")).toBe(false);
    expect(isSafeGoFileDownloadPage("javascript:alert(1)")).toBe(false);
    expect(isSafeGoFileDownloadPage("https://gofile.io/" + "x".repeat(2048))).toBe(false);
  });

  it("drops malformed entries, normalizes text, sorts newest first and deduplicates IDs", () => {
    const history = normalizeUploadHistory([
      { id: "old", name: "old.zip", downloadPage: "https://gofile.io/d/old", completedAt: "2026-10-01T00:00:00Z", size: 100 },
      { id: "new", name: "<new>.zip\n", downloadPage: "https://gofile.io/d/new", completedAt: "2026-10-12T11:00:00Z", size: 200 },
      { id: "new", name: "duplicate.zip", downloadPage: "https://gofile.io/d/duplicate", completedAt: "2026-10-12T10:00:00Z", size: 20 },
      { id: "bad", name: "bad", downloadPage: "https://attacker.test/d/no", completedAt: "2026-10-12T12:00:00Z", size: 0 },
      null,
    ]);

    expect(history).toHaveLength(2);
    expect(history[0].name).toBe("<new>.zip");
    expect(history[0].id).toBe("new");
    expect(history[1].id).toBe("old");
  });

  it("retains only the newest 100 valid uploads", () => {
    const items = Array.from({ length: MAX_UPLOAD_HISTORY_ENTRIES + 5 }, (_, index) => ({
      id: `id-${index}`,
      name: `file-${index}.zip`,
      downloadPage: `https://gofile.io/d/file-${index}`,
      completedAt: new Date(fixedTime.getTime() + index * 1000).toISOString(),
      size: index,
    }));
    const history = normalizeUploadHistory(items);

    expect(history).toHaveLength(MAX_UPLOAD_HISTORY_ENTRIES);
    expect(history[0].id).toBe("id-104");
    expect(history.at(-1)?.id).toBe("id-5");
  });
});
