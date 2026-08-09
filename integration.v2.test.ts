import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DIAGNOSTICS_ENV,
  TUI_EVENT_LOG_FILE,
  TUI_RUNTIME_MARKER_V2,
  TUI_TOAST_LOG_FILE,
} from "./protocol.js";

const RUN = process.env.OPENCODE_BTW_V2_INTEGRATION === "1";
const PLUGIN_ROOT = path.resolve(import.meta.dir);
const OPENCODE_BIN = process.env.OPENCODE_BTW_OPENCODE2_BIN ?? "opencode2";
const roots: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bytes(pathname: string) {
  return existsSync(pathname) ? statSync(pathname).size : 0;
}

function readSince(pathname: string, offset: number) {
  if (!existsSync(pathname)) return "";
  return readFileSync(pathname, "utf8").slice(offset);
}

function records(pathname: string, offset: number) {
  return readSince(pathname, offset).split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

async function waitFor<T>(fn: () => T | Promise<T | undefined | false> | undefined | false, timeout = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await Bun.sleep(100);
  }
}

async function typePrompt(proc: ReturnType<typeof Bun.spawn>, value: string, delay = 25) {
  for (const char of value) {
    proc.stdin.write(char);
    proc.stdin.flush?.();
    await Bun.sleep(delay);
  }
}

function shellquote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function makeSandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), "opencode-btw-v2-it-"));
  roots.push(root);
  const result = {
    root,
    home: path.join(root, "home"),
    config: path.join(root, "config"),
    project: path.join(root, "project"),
    data: path.join(root, "data"),
    state: path.join(root, "state"),
    cache: path.join(root, "cache"),
    xdg: path.join(root, "xdg-config"),
  };
  for (const directory of Object.values(result)) mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(result.config, "cli.json"),
    `${JSON.stringify({ plugins: [`file://${path.join(PLUGIN_ROOT, "dist", "tui.js")}`] }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(result.config, "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", autoupdate: false }, null, 2)}\n`,
  );
  return result;
}

function environment(sandbox: ReturnType<typeof makeSandbox>, password: string) {
  const env = { ...process.env };
  for (const key of [
    "OPENCODE_CONFIG",
    "OPENCODE_ROUTE",
    "OPENCODE_STORY",
    "OPENCODE_DRIVE",
    "OPENCODE_SERVER_PASSWORD",
  ])
    delete env[key];
  return {
    ...env,
    HOME: sandbox.home,
    OPENCODE_TEST_HOME: sandbox.home,
    OPENCODE_CONFIG_DIR: sandbox.config,
    XDG_CONFIG_HOME: sandbox.xdg,
    XDG_DATA_HOME: sandbox.data,
    XDG_STATE_HOME: sandbox.state,
    XDG_CACHE_HOME: sandbox.cache,
    OPENCODE_DB: path.join(sandbox.data, "opencode.db"),
    OPENCODE_PASSWORD: password,
    OPENCODE_CONFIG_CONTENT: "{}",
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_FILEWATCHER_DISABLE: "1",
    OPENCODE_DISABLE_FFF: "1",
    OPENCODE_FAST_BOOT: "1",
    OPENCODE_TUI_CHANNEL: `integration-${path.basename(sandbox.root)}`,
    OPENCODE_DISABLE_MOUSE: "1",
    [DIAGNOSTICS_ENV]: "1",
    TERM: process.env.TERM || "xterm-256color",
  };
}

async function line(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let value = "";
  while (true) {
    const next = await Promise.race([
      reader.read(),
      Bun.sleep(10_000).then(() => ({ done: true as const, value: undefined })),
    ]);
    if (next.done) throw new Error(`V2 server did not become ready: ${value}`);
    value += new TextDecoder().decode(next.value);
    const index = value.indexOf("\n");
    if (index >= 0) return { value: value.slice(0, index).trim(), rest: value.slice(index + 1) };
  }
}

async function startServer(sandbox: ReturnType<typeof makeSandbox>, password: string) {
  const proc = Bun.spawn([OPENCODE_BIN, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: sandbox.project,
    env: environment(sandbox, password),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const status = { stopped: false };
  const stop = async () => {
    if (status.stopped) return;
    status.stopped = true;
    proc.stdin.end();
    if (await exited(proc, 5_000)) return;
    proc.kill("SIGTERM");
    if (await exited(proc, 2_000)) return;
    proc.kill("SIGKILL");
    await proc.exited.catch(() => undefined);
  };
  cleanups.push(stop);
  const reader = proc.stdout.getReader();
  const ready = await line(reader);
  const parsed = JSON.parse(ready.value) as { url: string };
  let output = ready.rest;
  void (async () => {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      output += new TextDecoder().decode(next.value);
    }
  })();
  return {
    proc,
    url: parsed.url,
    output: () => output,
    stop,
  };
}

function authorization(password: string) {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

async function api<T>(url: string, password: string, pathname: string, init?: RequestInit) {
  const response = await fetch(new URL(pathname, url), {
    ...init,
    headers: {
      authorization: authorization(password),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return text ? (JSON.parse(text) as T) : undefined;
}

async function createSession(server: Awaited<ReturnType<typeof startServer>>, password: string, directory: string) {
  return (
    await api<{ data: { id: string } }>(server.url, password, "/api/session", {
      method: "POST",
      body: JSON.stringify({ location: { directory } }),
    })
  ).data;
}

function startTui(
  sandbox: ReturnType<typeof makeSandbox>,
  server: Awaited<ReturnType<typeof startServer>>,
  password: string,
  sessionID: string,
) {
  let output = "";
  const command = [OPENCODE_BIN, "--server", server.url, "--session", sessionID, sandbox.project]
    .map(shellquote)
    .join(" ");
  const proc = Bun.spawn(["setsid", "script", "-qefc", `exec ${command}`, "/dev/null"], {
    cwd: sandbox.project,
    env: environment(sandbox, password),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const status = { stopped: false };
  const stop = async () => {
    if (status.stopped) return;
    status.stopped = true;
    proc.stdin.write("\x03");
    proc.stdin.flush?.();
    if (await exited(proc, 3_000)) return;
    terminateGroup(proc.pid, "SIGTERM");
    if (await exited(proc, 2_000)) return;
    terminateGroup(proc.pid, "SIGKILL");
    await proc.exited.catch(() => undefined);
  };
  cleanups.push(stop);
  const collect = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    for await (const chunk of stream) {
      output += new TextDecoder().decode(chunk);
      if (output.length > 30_000) output = output.slice(-30_000);
    }
  };
  void collect(proc.stdout);
  void collect(proc.stderr);
  return {
    proc,
    output: () => output,
    stop,
  };
}

async function exited(proc: ReturnType<typeof Bun.spawn>, timeout: number) {
  return Promise.race([proc.exited.then(() => true), Bun.sleep(timeout).then(() => false)]);
}

function terminateGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The wrapper may have already exited between the timeout and signal.
  }
}

async function ready(tui: ReturnType<typeof startTui>, sessionID: string, eventOffset: number, toastOffset: number) {
  const initialized = await waitFor(() =>
    records(TUI_EVENT_LOG_FILE, eventOffset).some(
      (event) => event.runtimeMarker === TUI_RUNTIME_MARKER_V2 && event.stage === "v2:init",
    ),
  );
  if (!initialized) throw new Error(`V2 plugin did not initialize. Output:\n${tui.output()}`);
  await typePrompt(tui.proc, "/btw-status\r");
  const selected = await waitFor(() =>
    records(TUI_TOAST_LOG_FILE, toastOffset).some(
      (toast) =>
        toast.runtimeMarker === TUI_RUNTIME_MARKER_V2 &&
        toast.sessionID === sessionID &&
        String(toast.message).includes("mode: V2 TUI plugin"),
    ),
  );
  if (!selected) throw new Error(`V2 TUI did not enter ${sessionID}. Output:\n${tui.output()}`);
}

(RUN ? test : test.skip)("V2 loads the package and can open and end an empty /btw session", async () => {
  const sandbox = makeSandbox();
  const password = `btw-${crypto.randomUUID()}`;
  const eventOffset = bytes(TUI_EVENT_LOG_FILE);
  const toastOffset = bytes(TUI_TOAST_LOG_FILE);
  const server = await startServer(sandbox, password);
  const origin = await createSession(server, password, sandbox.project);
  const tui = startTui(sandbox, server, password, origin.id);
  try {
    await ready(tui, origin.id, eventOffset, toastOffset);
    // Argument-bearing slash commands are first completed by autocomplete,
    // then submitted from the prompt on the second Enter.
    await typePrompt(tui.proc, "/btw\r\r");
    const opened = await waitFor(() =>
      records(TUI_EVENT_LOG_FILE, eventOffset).find(
        (event) => event.stage === "v2:enter:ready" && event.originSessionID === origin.id,
      ),
    );
    expect(opened, `Events:\n${readSince(TUI_EVENT_LOG_FILE, eventOffset)}\nOutput:\n${tui.output()}`).toBeTruthy();
    expect(opened?.kind).toBe("empty");
    const temp = String(opened?.tempSessionID);

    await typePrompt(tui.proc, "/btw-end\r");
    const ended = await waitFor(() =>
      records(TUI_EVENT_LOG_FILE, eventOffset).find(
        (event) => event.stage === "v2:end:complete" && event.tempSessionID === temp,
      ),
    );
    expect(ended, `Events:\n${readSince(TUI_EVENT_LOG_FILE, eventOffset)}`).toBeTruthy();
    await expect(api(server.url, password, `/api/session/${temp}`)).rejects.toThrow("404");
  } finally {
    await tui.stop();
    await server.stop();
  }
}, 45_000);

(RUN ? test : test.skip)("V2 /btw arguments are admitted only in the temporary session", async () => {
  const sandbox = makeSandbox();
  const password = `btw-${crypto.randomUUID()}`;
  const eventOffset = bytes(TUI_EVENT_LOG_FILE);
  const toastOffset = bytes(TUI_TOAST_LOG_FILE);
  const server = await startServer(sandbox, password);
  const origin = await createSession(server, password, sandbox.project);
  const tui = startTui(sandbox, server, password, origin.id);
  try {
    await ready(tui, origin.id, eventOffset, toastOffset);
    const prompt = `v2-side-prompt-${Date.now()}`;
    await typePrompt(tui.proc, `/btw ${prompt}\r`);
    const opened = await waitFor(() =>
      records(TUI_EVENT_LOG_FILE, eventOffset).find(
        (event) => event.stage === "v2:enter:ready" && event.originSessionID === origin.id,
      ),
    );
    expect(opened).toBeTruthy();
    const temp = String(opened?.tempSessionID);
    const admitted = await waitFor(async () => {
      const result = await api<{ data: Array<{ data?: { text?: string } }> }>(
        server.url,
        password,
        `/api/session/${temp}/pending`,
      );
      if (result.data.some((item) => item.data?.text === prompt)) return result;
      const projected = await api<{ data: Array<{ type: string; text?: string }> }>(
        server.url,
        password,
        `/api/session/${temp}/message?limit=200&order=asc`,
      );
      return projected.data.some((item) => item.type === "user" && item.text === prompt) ? projected : undefined;
    });
    expect(admitted, `Events:\n${readSince(TUI_EVENT_LOG_FILE, eventOffset)}`).toBeTruthy();
    const originPending = await api<{ data: unknown[] }>(server.url, password, `/api/session/${origin.id}/pending`);
    expect(originPending.data).toEqual([]);
    const originMessages = await api<{ data: Array<{ type: string; text?: string }> }>(
      server.url,
      password,
      `/api/session/${origin.id}/message?limit=200&order=asc`,
    );
    expect(originMessages.data.some((item) => item.type === "user" && item.text === prompt)).toBe(false);
  } finally {
    await tui.stop();
    await server.stop();
  }
}, 45_000);

(RUN ? test : test.skip)("V2 /btw-fast and empty /btw-merge complete without a model", async () => {
  const sandbox = makeSandbox();
  const password = `btw-${crypto.randomUUID()}`;
  const eventOffset = bytes(TUI_EVENT_LOG_FILE);
  const toastOffset = bytes(TUI_TOAST_LOG_FILE);
  const server = await startServer(sandbox, password);
  const origin = await createSession(server, password, sandbox.project);
  const tui = startTui(sandbox, server, password, origin.id);
  try {
    await ready(tui, origin.id, eventOffset, toastOffset);
    await typePrompt(tui.proc, "/btw-fast\r");
    const opened = await waitFor(() =>
      records(TUI_EVENT_LOG_FILE, eventOffset).find(
        (event) => event.stage === "v2:fast:ready" && event.originSessionID === origin.id,
      ),
    );
    expect(opened).toBeTruthy();
    const temp = String(opened?.tempSessionID);
    await typePrompt(tui.proc, "/btw-merge\r");
    const merged = await waitFor(() =>
      records(TUI_EVENT_LOG_FILE, eventOffset).find(
        (event) => event.stage === "v2:merge:complete" && event.tempSessionID === temp,
      ),
    );
    expect(merged).toMatchObject({ merged: false });
    const emptyToast = await waitFor(() =>
      records(TUI_TOAST_LOG_FILE, toastOffset).some((toast) =>
        String(toast.message).includes("No new text to merge"),
      ),
    );
    expect(emptyToast).toBe(true);
  } finally {
    await tui.stop();
    await server.stop();
  }
}, 45_000);
