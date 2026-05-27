import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RUN = process.env.OPENCODE_BTW_INTEGRATION === "1";
const PLUGIN_ROOT = path.resolve(import.meta.dir);
const EVENT_LOG = "/tmp/opencode-bytheway-event.log";
const SERVER_LOG = "/tmp/opencode-bytheway-server.log";
const TOAST_LOG = "/tmp/opencode-bytheway-toast.log";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bytes(pathname: string) {
  return existsSync(pathname) ? statSync(pathname).size : 0;
}

function readSince(pathname: string, offset: number) {
  if (!existsSync(pathname)) return "";
  return readFileSync(pathname, "utf8").slice(offset);
}

function eventsSince(offset: number) {
  return readSince(EVENT_LOG, offset).split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line);
      return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

async function waitFor<T>(fn: () => T | undefined | false, timeout = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = fn();
    if (value) return value;
    await Bun.sleep(100);
  }
  return undefined;
}

function makeSandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), "opencode-btw-it-"));
  roots.push(root);

  const config = path.join(root, "config");
  const project = path.join(root, "project");
  const data = path.join(root, "data");
  const state = path.join(root, "state");
  const cache = path.join(root, "cache");
  mkdirSync(config, { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(data, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(cache, { recursive: true });

  const plugin = `file://${PLUGIN_ROOT}`;
  const json = JSON.stringify({ plugin: [plugin] }, null, 2);
  writeFileSync(path.join(config, "opencode.jsonc"), `${json}\n`);
  writeFileSync(path.join(config, "tui.jsonc"), `${json}\n`);

  return { root, config, project, data, state, cache };
}

async function publishCommand(port: number, project: string, command: string) {
  return publishTuiEvent(port, project, "tui.command.execute", { command });
}

async function publishTuiEvent(port: number, project: string, type: string, properties: Record<string, unknown>) {
  const url = new URL(`http://127.0.0.1:${port}/tui/publish`);
  url.searchParams.set("directory", project);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type,
      properties,
    }),
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text().catch(() => ""),
  };
}

async function createSession(port: number, project: string) {
  const url = new URL(`http://127.0.0.1:${port}/session`);
  url.searchParams.set("directory", project);
  const response = await fetch(url, { method: "POST" });
  const text = await response.text().catch(() => "");
  if (!response.ok) return { ok: false, status: response.status, text };
  try {
    const session = JSON.parse(text);
    return {
      ok: true,
      status: response.status,
      text,
      sessionID: session && typeof session.id === "string" ? session.id as string : undefined,
    };
  } catch {
    return { ok: false, status: response.status, text };
  }
}

async function selectSession(port: number, project: string, sessionID: string) {
  return publishTuiEvent(port, project, "tui.session.select", { sessionID });
}

async function sessionMessages(port: number, project: string, sessionID: string) {
  const url = new URL(`http://127.0.0.1:${port}/session/${sessionID}/message`);
  url.searchParams.set("directory", project);
  const response = await fetch(url);
  const text = await response.text().catch(() => "");
  if (!response.ok) return { ok: false, status: response.status, text };
  try {
    return { ok: true, status: response.status, messages: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: response.status, text };
  }
}

function hasExactUserText(messages: unknown, prompt: string) {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    if (!message || typeof message !== "object") return false;
    const info = "info" in message ? message.info : undefined;
    const parts = "parts" in message ? message.parts : undefined;
    if (!info || typeof info !== "object" || !("role" in info) || info.role !== "user") return false;
    if (!Array.isArray(parts)) return false;
    return parts.some((part) => {
      if (!part || typeof part !== "object") return false;
      return "type" in part && part.type === "text" && "text" in part && part.text === prompt;
    });
  });
}

function startOpencode(sandbox: ReturnType<typeof makeSandbox>, port: number) {
  let output = "";
  const proc = Bun.spawn(["script", "-qfec", `opencode --hostname 127.0.0.1 --port ${port}`, "/dev/null"], {
    cwd: sandbox.project,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: sandbox.config,
      OPENCODE_TUI_CONFIG: path.join(sandbox.config, "tui.jsonc"),
      OPENCODE_TEST_HOME: sandbox.root,
      XDG_CONFIG_HOME: sandbox.config,
      XDG_DATA_HOME: sandbox.data,
      XDG_STATE_HOME: sandbox.state,
      XDG_CACHE_HOME: sandbox.cache,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_SERVER_PASSWORD: "",
      OPENCODE_BYTHEWAY_DIAGNOSTICS: "1",
      TERM: process.env.TERM || "xterm-256color",
    },
  });

  const collect = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    for await (const chunk of stream) {
      output += new TextDecoder().decode(chunk);
      if (output.length > 20_000) output = output.slice(-20_000);
    }
  };
  collect(proc.stdout);
  collect(proc.stderr);

  return {
    proc,
    output: () => output,
    async stop() {
      proc.stdin.write("\x03");
      proc.stdin.flush?.();
      proc.kill();
      await proc.exited.catch(() => undefined);
    },
  };
}

(RUN ? test : test.skip)("/btw opens a real TUI side session without a request-failed toast", async () => {
  const sandbox = makeSandbox();
  const port = 46_000 + Math.floor(Math.random() * 1_000);
  const eventOffset = bytes(EVENT_LOG);
  const serverOffset = bytes(SERVER_LOG);
  const toastOffset = bytes(TOAST_LOG);
  const tui = startOpencode(sandbox, port);

  try {
    const initialized = await waitFor(() => readSince(EVENT_LOG, eventOffset).includes("tui:init"));
    expect(initialized, `TUI did not initialize. Output:\n${tui.output()}`).toBe(true);

    const published = await waitFor(async () => {
      const result = await publishCommand(port, sandbox.project, "btw.open").catch((error) => ({
        ok: false,
        status: 0,
        text: String(error),
      }));
      return result.ok ? result : undefined;
    });
    expect(published, `Failed to publish TUI command. Output:\n${tui.output()}`).toBeTruthy();

    const result = await waitFor(() => {
      const events = readSince(EVENT_LOG, eventOffset);
      if (events.includes("enter:error")) return { ok: false, events };
      if (events.includes("enter:fork")) return { ok: true, events };
      return undefined;
    });

    const toasts = readSince(TOAST_LOG, toastOffset);
    const events = readSince(EVENT_LOG, eventOffset);
    const diagnostics = [
      "TUI output:",
      tui.output(),
      "Publish result:",
      JSON.stringify(published),
      "Plugin events:",
      events,
      "Server plugin events:",
      readSince(SERVER_LOG, serverOffset),
      "Plugin toasts:",
      toasts,
    ].join("\n");
    expect(result, diagnostics).toBeTruthy();
    expect(result?.events, diagnostics).not.toContain("enter:error");
    expect(toasts, diagnostics).not.toContain("Request failed");
  } finally {
    await tui.stop();
  }
}, 30_000);

(RUN ? test : test.skip)("/btw typed with a prompt forks and submits that exact prompt", async () => {
  const sandbox = makeSandbox();
  const port = 46_000 + Math.floor(Math.random() * 1_000);
  const eventOffset = bytes(EVENT_LOG);
  const serverOffset = bytes(SERVER_LOG);
  const toastOffset = bytes(TOAST_LOG);
  const prompt = "this is a topic";
  const tui = startOpencode(sandbox, port);

  try {
    const initialized = await waitFor(() => readSince(EVENT_LOG, eventOffset).includes("tui:init"));
    expect(initialized, `TUI did not initialize. Output:\n${tui.output()}`).toBe(true);

    const origin = await waitFor(async () => {
      const result = await createSession(port, sandbox.project).catch((error) => ({
        ok: false,
        status: 0,
        text: String(error),
      }));
      return result.ok && result.sessionID ? result : undefined;
    });
    expect(origin, `Failed to create origin session. Output:\n${tui.output()}`).toBeTruthy();

    const selected = await waitFor(async () => {
      if (!origin?.sessionID) return undefined;
      const result = await selectSession(port, sandbox.project, origin.sessionID).catch((error) => ({
        ok: false,
        status: 0,
        text: String(error),
      }));
      return result.ok ? result : undefined;
    });
    expect(selected, `Failed to select origin session. Output:\n${tui.output()}`).toBeTruthy();

    await Bun.sleep(250);

    tui.proc.stdin.write(`/btw ${prompt}\r`);
    tui.proc.stdin.flush?.();

    const forked = await waitFor(() => {
      const events = eventsSince(eventOffset);
      const error = events.find((event) => event.stage === "enter:error");
      if (error) return { ok: false, error, events };
      const claimed = events.find((event) => event.stage === "experimental:claimed_handoff");
      const fork = events.find((event) => event.stage === "enter:fork" && typeof event.tempSessionID === "string");
      if (claimed && fork) return { ok: true, claimed, fork, tempSessionID: fork.tempSessionID as string, events };
      return undefined;
    }, 15_000);

    const prompted = forked?.ok
      ? await waitFor(async () => {
        const result = await sessionMessages(port, sandbox.project, forked.tempSessionID);
        if (result.ok && hasExactUserText(result.messages, prompt)) return result;
        return undefined;
      }, 10_000)
      : undefined;

    const toasts = readSince(TOAST_LOG, toastOffset);
    const diagnostics = [
      "TUI output:",
      tui.output(),
      "Plugin events:",
      readSince(EVENT_LOG, eventOffset),
      "Server plugin events:",
      readSince(SERVER_LOG, serverOffset),
      "Plugin toasts:",
      toasts,
      "Fork result:",
      JSON.stringify(forked),
      "Messages result:",
      JSON.stringify(prompted),
    ].join("\n");
    expect(forked, diagnostics).toBeTruthy();
    expect(forked?.ok, diagnostics).toBe(true);
    expect(forked?.claimed?.promptLength, diagnostics).toBe(prompt.length);
    expect(prompted, diagnostics).toBeTruthy();
  }
  finally {
    await tui.stop();
  }
}, 30_000);
