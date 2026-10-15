import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Copy,
  FileUp,
  History as HistoryIcon,
  Link2,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import {
  createUploadHistoryEntry,
  isSafeGoFileDownloadPage,
  MAX_UPLOAD_HISTORY_ENTRIES,
  normalizeUploadHistory,
  UPLOAD_HISTORY_STORAGE_KEY,
  type UploadHistoryEntry,
} from "../lib/uploadHistory";

type Phase = "idle" | "running" | "complete" | "error" | "cancelled";
type Stage = "checking" | "connecting" | "transferring" | "finishing";
type LogTone = "command" | "muted" | "success" | "error" | "active";
type LogEntry = { id: number; time: string; text: string; tone: LogTone };
type TransferResult = {
  id?: string;
  name: string;
  size: number | null;
  md5?: string;
  mimetype?: string;
  downloadPage: string;
};

const STAGE_COPY: Record<Stage, { label: string; command: string }> = {
  checking: { label: "Validating source", command: "$ source-check --public-address" },
  connecting: { label: "Connecting to source", command: "$ connect --source --redirect-check" },
  transferring: { label: "Streaming to GoFile", command: "$ stream --pipe source → upload.gofile.io" },
  finishing: { label: "Waiting for GoFile", command: "$ await --gofile-response" },
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function clockTime(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname || "unknown-host";
  } catch {
    return "unparsed-link";
  }
}

function safeErrorText(value: unknown): string {
  return value instanceof Error && value.message ? value.message : "The transfer could not be completed. Check the direct file link and try again.";
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState<Stage | null>(null);
  const [bytesTransferred, setBytesTransferred] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [terminalView, setTerminalView] = useState<"console" | "history">("console");
  const [history, setHistory] = useState<UploadHistoryEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(UPLOAD_HISTORY_STORAGE_KEY);
      return stored ? normalizeUploadHistory(JSON.parse(stored)) : [];
    } catch {
      return [];
    }
  });
  const [historyAvailable, setHistoryAvailable] = useState(true);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, time: clockTime(), text: "GoFile Uploader Website relay interface initialized", tone: "muted" },
    { id: 2, time: clockTime(), text: "Awaiting a direct file URL…", tone: "active" },
  ]);
  const controllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetRef = useRef<string | null>(null);
  const nextLogId = useRef(3);

  const appendLog = useCallback((text: string, tone: LogTone = "muted") => {
    const id = nextLogId.current++;
    setLogs((current) => [...current.slice(-80), { id, time: clockTime(), text, tone }]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("health check failed");
        return response.json();
      })
      .then(() => setServerOnline(true))
      .catch(() => setServerOnline(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(UPLOAD_HISTORY_STORAGE_KEY, JSON.stringify(history));
      setHistoryAvailable(true);
    } catch {
      setHistoryAvailable(false);
    }
  }, [history]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const siteKey = window.__MANUS_CONFIG__?.turnstileSiteKey;
    if (!siteKey || !turnstileRef.current) return;
    const render = () => {
      if (!window.turnstile || !turnstileRef.current || turnstileWidgetRef.current) return;
      turnstileWidgetRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    };
    if (window.turnstile) render();
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render);
      document.head.appendChild(script);
      return () => script.removeEventListener("load", render);
    }
  }, []);

  const consumeEvent = useCallback((event: Record<string, unknown>) => {
    if (event.type === "stage" && typeof event.stage === "string" && event.stage in STAGE_COPY) {
      const nextStage = event.stage as Stage;
      setStage(nextStage);
      setPhase("running");
      appendLog(STAGE_COPY[nextStage].command, nextStage === "finishing" ? "active" : "command");
      return;
    }

    if (event.type === "progress") {
      const transferred = typeof event.bytesTransferred === "number" ? event.bytesTransferred : 0;
      const total = typeof event.totalBytes === "number" && event.totalBytes > 0 ? event.totalBytes : null;
      setBytesTransferred(transferred);
      setTotalBytes(total);
      return;
    }

    if (event.type === "result" && typeof event.result === "object" && event.result !== null) {
      const transferResult = event.result as TransferResult;
      setResult(transferResult);
      const historyEntry = createUploadHistoryEntry(transferResult);
      if (historyEntry) setHistory((current) => normalizeUploadHistory([historyEntry, ...current]));
      setPhase("complete");
      setStage(null);
      appendLog(`GoFile accepted ${transferResult.name || "the file"}`, "success");
      appendLog(`downloadPage → ${transferResult.downloadPage}`, "success");
      return;
    }

    if (event.type === "error" || event.type === "cancelled") {
      const message = typeof event.message === "string" ? event.message : "The transfer could not be completed.";
      setErrorMessage(message);
      setPhase(event.type === "cancelled" ? "cancelled" : "error");
      setStage(null);
      appendLog(message, event.type === "cancelled" ? "muted" : "error");
    }
  }, [appendLog]);

  const startTransfer = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setErrorMessage("Paste a public HTTP or HTTPS file or download-page URL first.");
      setPhase("error");
      return;
    }

    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only HTTP and HTTPS links are supported.");
    } catch {
      setErrorMessage("Enter a complete, valid HTTP or HTTPS URL.");
      setPhase("error");
      return;
    }

    setPhase("running");
    setStage("checking");
    setBytesTransferred(0);
    setTotalBytes(null);
    setResult(null);
    setErrorMessage("");
    setCopied(false);
    if (window.__MANUS_CONFIG__?.turnstileSiteKey && !turnstileToken) {
      setErrorMessage("Complete the anti-abuse check before starting a transfer.");
      setPhase("error");
      return;
    }
    cancelRequestedRef.current = false;
    appendLog(`$ enqueue --source ${sourceHost(trimmedUrl)}`, "command");
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const response = await fetch("/api/upload-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ url: trimmedUrl, fileName: fileName.trim() || undefined, turnstileToken: turnstileToken || undefined }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = "The transfer could not be started.";
        try {
          const payload = await response.json() as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // Keep the generic message if the error body is not JSON.
        }
        throw new Error(message);
      }
      if (!response.body) throw new Error("The server did not open a transfer stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resultReceived = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.type === "result") resultReceived = true;
          consumeEvent(parsed);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        const parsed = JSON.parse(buffer) as Record<string, unknown>;
        if (parsed.type === "result") resultReceived = true;
        consumeEvent(parsed);
      }
      if (!resultReceived && !cancelRequestedRef.current) {
        throw new Error("The transfer stream ended before GoFile confirmed the upload.");
      }
    } catch (error) {
      if (cancelRequestedRef.current || (error instanceof DOMException && error.name === "AbortError")) {
        setPhase("cancelled");
        setStage(null);
        setErrorMessage("Transfer cancelled.");
        appendLog("$ transfer --cancelled", "muted");
      } else {
        const message = safeErrorText(error);
        setPhase("error");
        setStage(null);
        setErrorMessage(message);
        appendLog(message, "error");
      }
    } finally {
      controllerRef.current = null;
    }
  }, [appendLog, consumeEvent, fileName, turnstileToken, url]);

  const cancelTransfer = () => {
    cancelRequestedRef.current = true;
    appendLog("$ transfer --abort source + upload", "command");
    controllerRef.current?.abort();
  };

  const copyLink = async () => {
    if (!result?.downloadPage) return;
    try {
      await navigator.clipboard.writeText(result.downloadPage);
      setCopied(true);
      appendLog("GoFile link copied to clipboard", "success");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setErrorMessage("Clipboard access was blocked. Select and copy the link manually.");
    }
  };

  const copyHistoryLink = async (downloadPage: string) => {
    if (!isSafeGoFileDownloadPage(downloadPage)) return;
    try {
      await navigator.clipboard.writeText(downloadPage);
      appendLog("Saved GoFile link copied from local history", "success");
    } catch {
      appendLog("Clipboard access was blocked. Open the saved link to copy it manually.", "error");
    }
  };

  const clearHistory = () => {
    if (!history.length) return;
    const confirmed = window.confirm(
      "Clear saved upload history from this browser? This does not delete any files or links from GoFile.",
    );
    if (!confirmed) return;
    setHistory([]);
    appendLog("$ history --clear-local", "command");
  };

  const retryTransfer = () => {
    setPhase("idle");
    setStage(null);
    setErrorMessage("");
    void startTransfer();
  };

  const progressPercent = totalBytes && totalBytes > 0
    ? Math.min(100, Math.round((bytesTransferred / totalBytes) * 100))
    : null;
  const isRunning = phase === "running";
  const steps: Stage[] = ["checking", "connecting", "transferring", "finishing"];
  const activeStepIndex = stage ? steps.indexOf(stage) : phase === "complete" ? steps.length : -1;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="GoFile Uploader Website home">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-mark-line" />
            <span className="brand-mark-line" />
            <span className="brand-mark-line" />
            <ArrowUpRight size={16} strokeWidth={2.2} />
          </span>
          <span className="brand-name">GoFile <span>Uploader Website</span></span>
        </a>
        <div className="topbar-meta">
          <span className={`server-status ${serverOnline === false ? "is-offline" : ""}`}>
            <span className="status-dot" />
            {serverOnline === null ? "CHECKING RELAY" : serverOnline ? "RELAY ONLINE" : "RELAY OFFLINE"}
          </span>
          <span className="version-tag">STREAM / 01</span>
        </div>
      </header>

      <main className="workspace">
        <section className="intro-row">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> DIRECT LINK TRANSFER</p>
            <h1>Move a file.<br /><span>Keep it simple.</span></h1>
            <p className="intro-copy">Send a direct file URL through a secure server-side stream, straight to GoFile.</p>
          </div>
          <div className="intro-note">
            <div className="intro-note-icon"><ArrowDownToLine size={17} /></div>
            <p><strong>No local download.</strong><br />The file moves between servers. Your browser sends only the link.</p>
          </div>
        </section>

        <section className="transfer-layout" aria-label="File transfer workspace">
          <div className="source-panel panel">
            <div className="panel-heading">
              <div className="panel-heading-icon"><Link2 size={17} /></div>
              <div>
                <p className="panel-kicker">01 / SOURCE</p>
                <h2>Source details</h2>
              </div>
              <span className="panel-index">INPUT</span>
            </div>

            <form onSubmit={startTransfer} className="transfer-form">
              <label htmlFor="source-url">File or download-page URL</label>
              <div className="url-input-wrap">
                <Link2 size={16} aria-hidden="true" />
                <input
                  id="source-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://files.example.com/archive.zip"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  disabled={isRunning}
                  required
                />
              </div>
              <p className="field-hint">Direct links and public MediaFire, Google Drive, SourceForge or Pixeldrain pages are supported.</p>
              {window.__MANUS_CONFIG__?.turnstileSiteKey && <div ref={turnstileRef} className="turnstile-box" aria-label="Anti-abuse verification" />}

              <label htmlFor="output-name" className="optional-label">Output filename <span>OPTIONAL</span></label>
              <div className="name-input-wrap">
                <FileUp size={16} aria-hidden="true" />
                <input
                  id="output-name"
                  type="text"
                  maxLength={220}
                  placeholder="Keep filename from source"
                  value={fileName}
                  onChange={(event) => setFileName(event.target.value)}
                  disabled={isRunning}
                />
              </div>

              {errorMessage && phase === "error" && (
                <div className="inline-error" role="alert"><CircleAlert size={16} /><span>{errorMessage}</span></div>
              )}

              <div className="form-actions">
                {isRunning ? (
                  <button className="primary-button cancel-button" type="button" onClick={cancelTransfer}>
                    <X size={17} /> Cancel transfer
                  </button>
                ) : (
                  <button className="primary-button" type="submit" disabled={serverOnline === false}>
                    {phase === "complete" ? <RotateCcw size={17} /> : <FileUp size={17} />}
                    {phase === "complete" ? "Transfer another file" : phase === "error" || phase === "cancelled" ? "Try again" : "Start transfer"}
                    <ChevronRight size={17} className="button-arrow" />
                  </button>
                )}
                <span className="secure-caption"><LockKeyhole size={13} /> Link is checked on the server</span>
              </div>
            </form>

            <div className="flow-rail" aria-label="Transfer stages">
              {steps.map((step, index) => {
                const label = step === "checking" ? "Check" : step === "connecting" ? "Connect" : step === "transferring" ? "Stream" : "Finish";
                const reached = activeStepIndex >= index;
                const active = stage === step;
                return (
                  <div className={`flow-step ${reached ? "is-reached" : ""} ${active ? "is-active" : ""}`} key={step}>
                    <span className="flow-step-dot">{phase === "complete" && index === 3 ? <Check size={11} /> : `0${index + 1}`}</span>
                    <span>{label}</span>
                    {index < steps.length - 1 && <span className="flow-connector" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>

            <div className="safety-note">
              <ShieldCheck size={17} />
              <p><strong>Server-side URL checks</strong><span>Private network destinations and unsafe redirects are blocked.</span></p>
            </div>
          </div>

          <div className="terminal-panel panel">
            <div className="terminal-topbar">
              <div className="terminal-lights" aria-hidden="true"><i /><i /><i /></div>
              <div className="terminal-title">{terminalView === "console" ? <TerminalSquare size={15} /> : <HistoryIcon size={15} />} {terminalView === "console" ? "TRANSFER CONSOLE" : "UPLOAD HISTORY"}</div>
              <span className={`terminal-state ${isRunning ? "is-active" : phase === "complete" ? "is-success" : ""}`}>
                <span />{isRunning ? "RUNNING" : phase === "complete" ? "COMPLETE" : phase === "error" ? "ERROR" : "IDLE"}
              </span>
            </div>

            <div className="terminal-tabs" role="tablist" aria-label="Terminal views">
              <button type="button" role="tab" aria-selected={terminalView === "console"} className={`terminal-tab ${terminalView === "console" ? "is-selected" : ""}`} onClick={() => setTerminalView("console")}>
                <TerminalSquare size={13} /> Console
              </button>
              <button type="button" role="tab" aria-selected={terminalView === "history"} className={`terminal-tab ${terminalView === "history" ? "is-selected" : ""}`} onClick={() => setTerminalView("history")}>
                <HistoryIcon size={13} /> History <span className="history-count">{history.length}</span>
              </button>
              {terminalView === "history" && history.length > 0 && (
                <button type="button" className="history-clear-button" onClick={clearHistory}>
                  <Trash2 size={12} /> Clear local history
                </button>
              )}
            </div>

            <div className="terminal-body" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Transfer event log" hidden={terminalView === "history"}>
              <div className="terminal-session-line"><span>gofile-uploader</span><span className="terminal-at">@</span><span>relay</span><span className="terminal-path">:~$</span><span className="terminal-cursor" /></div>
              <div className="terminal-log-list">
                {logs.map((entry) => (
                  <div className={`terminal-log-row tone-${entry.tone}`} key={entry.id}>
                    <time>{entry.time}</time>
                    <span className="terminal-log-text" dir="ltr">{entry.text}</span>
                  </div>
                ))}
                {isRunning && <div className="terminal-log-row tone-active"><time>{clockTime()}</time><span className="terminal-log-text pulse-line">processing stream<span>_</span></span></div>}
                <div ref={logEndRef} />
              </div>
              <div className="terminal-prompt"><span>›</span><span>{isRunning ? "transfer in progress" : "ready for next command"}</span><i /></div>
            </div>

            <div className="history-body" role="tabpanel" aria-label="Previously uploaded files" hidden={terminalView !== "history"}>
              <div className="terminal-session-line"><span>gofile-uploader</span><span className="terminal-at">@</span><span>relay</span><span className="terminal-path">:~$</span><span> history --recent {history.length}</span></div>
              {history.length === 0 ? (
                <div className="history-empty">
                  <HistoryIcon size={22} />
                  <strong>No completed uploads yet</strong>
                  <span>Confirmed GoFile links will appear here after a successful transfer.</span>
                  <button type="button" className="history-empty-action" onClick={() => setTerminalView("console")}>Back to console <ChevronRight size={13} /></button>
                </div>
              ) : (
                <div className="history-list">
                  {history.map((entry, index) => (
                    <article className="history-record" key={entry.id}>
                      <div className="history-record-heading">
                        <span className="history-record-index">[{String(index + 1).padStart(3, "0")}]</span>
                        <time dateTime={entry.completedAt}>{formatHistoryTime(entry.completedAt)}</time>
                        <span className="history-record-size">{formatBytes(entry.size)}</span>
                      </div>
                      <div className="history-file-name"><FileUp size={13} /><span title={entry.name}>{entry.name}</span></div>
                      <div className="history-link-row">
                        <a href={entry.downloadPage} target="_blank" rel="noreferrer" dir="ltr">{entry.downloadPage}<ArrowUpRight size={13} /></a>
                        <button type="button" className="history-copy-button" onClick={() => void copyHistoryLink(entry.downloadPage)} aria-label={`Copy link for ${entry.name}`}><Copy size={13} /><span>Copy</span></button>
                      </div>
                      {(entry.mimetype || entry.md5) && <div className="history-extra-meta">{entry.mimetype && <span>TYPE {entry.mimetype}</span>}{entry.md5 && <span>MD5 {entry.md5}</span>}</div>}
                    </article>
                  ))}
                </div>
              )}
              <div className="history-footnote">
                {historyAvailable ? `Showing ${history.length} of the latest ${MAX_UPLOAD_HISTORY_ENTRIES} saved uploads · This browser only` : "Browser storage is unavailable. History may not persist after this page closes."}
              </div>
            </div>

            <div className="transfer-meter" hidden={terminalView === "history"}>
              <div className="meter-heading">
                <span>{isRunning ? stage === "finishing" ? "GOFILE ACKNOWLEDGEMENT" : "LIVE STREAM" : phase === "complete" ? "TRANSFER COMPLETE" : "TRANSFER STATUS"}</span>
                <span className="meter-amount">{progressPercent !== null && isRunning ? `${progressPercent}%` : isRunning ? "STREAMING" : phase === "complete" ? "100%" : "—"}</span>
              </div>
              <div className={`meter-track ${isRunning && progressPercent === null ? "is-indeterminate" : ""}`}>
                <div className="meter-fill" style={{ width: `${phase === "complete" ? 100 : progressPercent ?? 0}%` }} />
              </div>
              <div className="meter-foot">
                <span>{formatBytes(bytesTransferred)}{totalBytes ? ` / ${formatBytes(totalBytes)}` : " transferred"}</span>
                <span>{stage ? STAGE_COPY[stage].label.toUpperCase() : phase === "complete" ? "DONE" : "WAITING"}</span>
              </div>
            </div>

            {terminalView === "console" && result && phase === "complete" && (
              <div className="result-panel" aria-live="polite">
                <div className="result-heading"><CircleCheck size={17} /><span>GoFile link ready</span><span className="result-size">{formatBytes(result.size)}</span></div>
                <div className="result-link-row">
                  <a className="result-link" href={result.downloadPage} target="_blank" rel="noreferrer" dir="ltr">{result.downloadPage}<ArrowUpRight size={14} /></a>
                  <button type="button" className="copy-button" onClick={copyLink} aria-label="Copy GoFile link">
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <div className="result-meta">
                  <span><b>FILE</b>{result.name}</span>
                  {result.mimetype && <span><b>TYPE</b>{result.mimetype}</span>}
                  {result.md5 && <span><b>MD5</b>{result.md5}</span>}
                </div>
              </div>
            )}

            {terminalView === "console" && phase === "cancelled" && <div className="terminal-note"><X size={15} /> Transfer cancelled. Outbound requests were closed.</div>}
            {terminalView === "console" && phase === "error" && <div className="terminal-note is-error"><CircleAlert size={15} /> {errorMessage}</div>}
          </div>
        </section>

        <section className="limits-strip" aria-label="Transfer limits">
          <div className="limits-icon"><Clipboard size={17} /></div>
          <div className="limits-copy">
            <strong>Streaming avoids an app-level file-size cap — it does not mean unlimited.</strong>
            <span>Free GoFile accounts cap at 10,000 stored items and API rate limits apply. Vercel Functions have a 4.5 MB request/response payload limit and a finite runtime; posting only the URL avoids sending file bytes through that body limit. For long transfers, use a long-running Node/container host.</span>
          </div>
          <a href="https://gofile.io/api" target="_blank" rel="noreferrer" className="limits-link">GoFile API <ArrowUpRight size={14} /></a>
        </section>

        <footer className="page-footer">
          <span><span className="footer-mark" /> SOURCE → GOFILE</span>
          <span>Only transfer files you have permission to share.</span>
          <a href="https://gofile.io" target="_blank" rel="noreferrer">gofile.io <ArrowUpRight size={13} /></a>
        </footer>
      </main>
        </div>
      );
    }
