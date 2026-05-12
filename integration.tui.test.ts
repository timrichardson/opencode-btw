import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RUN = process.env.OPENCODE_BTW_INTEGRATION === "1";
const PLUGIN_ROOT = path.resolve(import.meta.dir);
const EVENT_LOG = "/tmp/opencode-bytheway-event.log";
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
  mkdirSync(config, { recursive: true });
  mkdirSync(project, { recursive: true });

  const plugin = `file://${PLUGIN_ROOT}`;
  const json = JSON.stringify({ plugin: [plugin] }, null, 2);
  writeFileSync(path.join(config, "opencode.jsonc"), `${json}\n`);
  writeFileSync(path.join(config, "tui.jsonc"), `${json}\n`);

  return { root, config, project };
}

async function publishCommand(port: number, project: string, command: string) {
  const url = new URL(`http://127.0.0.1:${port}/tui/publish`);
  url.searchParams.set("directory", project);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "tui.command.execute",
      properties: { command },
    }),
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text().catch(() => ""),
  };
}

(RUN ? test : test.skip)("/btw opens a real TUI side session without a request-failed toast", async () => {
  const sandbox = makeSandbox();
  const port = 46_000 + Math.floor(Math.random() * 1_000);
  const eventOffset = bytes(EVENT_LOG);
  const toastOffset = bytes(TOAST_LOG);
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
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_SERVER_PASSWORD: "",
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

  try {
    const initialized = await waitFor(() => readSince(EVENT_LOG, eventOffset).includes("tui:init"));
    expect(initialized, `TUI did not initialize. Output:\n${output}`).toBe(true);

    const published = await waitFor(async () => {
      const result = await publishCommand(port, sandbox.project, "btw.open").catch((error) => ({
        ok: false,
        status: 0,
        text: String(error),
      }));
      return result.ok ? result : undefined;
    });
    expect(published, `Failed to publish TUI command. Output:\n${output}`).toBeTruthy();

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
      output,
      "Publish result:",
      JSON.stringify(published),
      "Plugin events:",
      events,
      "Plugin toasts:",
      toasts,
    ].join("\n");
    expect(result, diagnostics).toBeTruthy();
    expect(result?.events, diagnostics).not.toContain("enter:error");
    expect(toasts, diagnostics).not.toContain("Request failed");
  } finally {
    proc.stdin.write("\x03");
    proc.stdin.flush?.();
    proc.kill();
    await proc.exited.catch(() => undefined);
  }
}, 30_000);
