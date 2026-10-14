export const UPLOAD_HISTORY_STORAGE_KEY = "gofile-uploader-website.upload-history.v1";
export const MAX_UPLOAD_HISTORY_ENTRIES = 100;

export type UploadHistoryEntry = {
  id: string;
  name: string;
  downloadPage: string;
  completedAt: string;
  size: number | null;
  md5?: string;
  mimetype?: string;
};

export type UploadHistoryInput = {
  id?: unknown;
  name?: unknown;
  downloadPage?: unknown;
  size?: unknown;
  md5?: unknown;
  mimetype?: unknown;
};

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
  return normalized || undefined;
}

export function isSafeGoFileDownloadPage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "gofile.io" && /^\/d\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizeEntry(value: unknown): UploadHistoryEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const id = cleanText(entry.id, 120);
  const name = cleanText(entry.name, 255);
  const completedAt = cleanText(entry.completedAt, 40);
  const downloadPage = entry.downloadPage;
  const parsedTimestamp = completedAt ? Date.parse(completedAt) : Number.NaN;

  if (!id || !name || !completedAt || !Number.isFinite(parsedTimestamp) || !isSafeGoFileDownloadPage(downloadPage)) return null;

  const size = typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0
    ? entry.size
    : null;
  const md5 = cleanText(entry.md5, 128);
  const mimetype = cleanText(entry.mimetype, 255);

  return {
    id,
    name,
    downloadPage,
    completedAt: new Date(parsedTimestamp).toISOString(),
    size,
    ...(md5 ? { md5 } : {}),
    ...(mimetype ? { mimetype } : {}),
  };
}

export function normalizeUploadHistory(value: unknown): UploadHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .map(normalizeEntry)
    .filter((entry): entry is UploadHistoryEntry => entry !== null)
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
  const unique = new Map<string, UploadHistoryEntry>();
  for (const entry of entries) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
  }
  return [...unique.values()].slice(0, MAX_UPLOAD_HISTORY_ENTRIES);
}

export function createUploadHistoryEntry(input: UploadHistoryInput, now = new Date()): UploadHistoryEntry | null {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const name = cleanText(input.name, 255);
  if (!name || !isSafeGoFileDownloadPage(input.downloadPage)) return null;

  const id = cleanText(input.id, 120) ?? `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  const size = typeof input.size === "number" && Number.isFinite(input.size) && input.size >= 0
    ? input.size
    : null;
  const md5 = cleanText(input.md5, 128);
  const mimetype = cleanText(input.mimetype, 255);

  return {
    id,
    name,
    downloadPage: input.downloadPage,
    completedAt: now.toISOString(),
    size,
    ...(md5 ? { md5 } : {}),
    ...(mimetype ? { mimetype } : {}),
  };
}
