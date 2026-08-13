import type { Plugin } from "@opencode-ai/plugin/tui";
import { appendFile } from "node:fs/promises";
import { createComponent } from "solid-js";
import packageJson from "./package.json" with { type: "json" };
import { BtwIndicator } from "./v2-indicator.js";
import {
  EXPERIMENTAL_COMMAND,
  PLUGIN_ID,
  TUI_EVENT_LOG_FILE,
  TUI_RUNTIME_MARKER_V2,
  TUI_TOAST_LOG_FILE,
  diagnosticsenabled,
  endname,
  fastname,
  mergename,
  openname,
  slash,
  slashbase,
  statusname,
} from "./protocol.js";

type Context = Plugin.Context;
type Session = Awaited<ReturnType<Context["client"]["session"]["get"]>>;
type MessagePage = Awaited<ReturnType<Context["client"]["message"]["list"]>>;
type Message = MessagePage["data"][number];

type Active = {
  version: 2;
  origin: string;
  temp: string;
  originUpdated: number;
  kind: "fork" | "fast" | "empty";
  baselineMessageID?: string;
  mergeMessageID?: string;
  mergeText?: string;
};

type State = {
  active: Record<string, Active> | Active | null;
};

const RECENT_CONTEXT_LIMIT = 12;

export function createV2(context: Context) {
  const [state, updateState] = context.storage.store<State>("active", { initial: { active: {} } });
  let working = false;

  const current = () => {
    const route = context.ui.router.current();
    if (route.type === "session") return route.sessionID;
  };

  const activeRecords = () => {
    if (!state.active) return {};
    if (isActive(state.active)) return { [state.active.temp]: state.active };
    return state.active;
  };

  const inside = () => {
    const sessionID = current();
    return Boolean(sessionID && activeRecords()[sessionID]);
  };

  const isTemp = (sessionID: string) => Boolean(activeRecords()[sessionID]);

  const log = (stage: string, data: Record<string, unknown> = {}) => {
    if (!diagnosticsenabled()) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      runtimeMarker: TUI_RUNTIME_MARKER_V2,
      stage,
      route: context.ui.router.current().type,
      sessionID: current() ?? null,
      ...data,
    });
    void appendFile(TUI_EVENT_LOG_FILE, `${line}\n`, "utf8").catch(() => undefined);
  };

  const toast = (input: {
    variant?: "info" | "success" | "warning" | "error";
    title?: string;
    message: string;
    duration?: number;
  }) => {
    context.ui.toast.show(input);
    if (!diagnosticsenabled()) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      variant: input.variant ?? "info",
      title: input.title ?? null,
      message: input.message,
      route: context.ui.router.current().type,
      sessionID: current() ?? null,
      runtimeMarker: TUI_RUNTIME_MARKER_V2,
    });
    void appendFile(TUI_TOAST_LOG_FILE, `${line}\n`, "utf8").catch(() => undefined);
  };

  const save = (active: Active) =>
    updateState((draft) => {
      draft.active = { ...activeRecords(), [active.temp]: active };
    });

  const clear = (temp: string) =>
    updateState((draft) => {
      draft.active = Object.fromEntries(Object.entries(activeRecords()).filter(([sessionID]) => sessionID !== temp));
    });

  const run = async (task: () => Promise<void>) => {
    if (working) {
      toast({ variant: "warning", message: "A by-the-way operation is already in progress." });
      return;
    }
    working = true;
    try {
      await task();
    } catch (error) {
      toast({ variant: "error", message: errorMessage(error) });
    } finally {
      working = false;
    }
  };

  const get = (sessionID: string) => context.client.session.get({ sessionID });

  const origin = async () => {
    const sessionID = current();
    if (sessionID) return { session: await get(sessionID), created: false };
    return {
      session: await context.client.session.create({
        location: context.location ?? context.data.location.default(),
      }),
      created: true,
    };
  };

  const latest = async (sessionID: string) =>
    (
      await context.client.message.list({
        sessionID,
        limit: 1,
        order: "desc",
      })
    ).data[0];

  const allMessages = async (sessionID: string) => {
    const messages: Message[] = [];
    let cursor: string | undefined;
    do {
      const page = await context.client.message.list(
        cursor
          ? { sessionID, limit: 200, cursor }
          : {
              sessionID,
              limit: 200,
              order: "asc",
            },
      );
      messages.push(...page.data);
      cursor = page.cursor.next;
    } while (cursor);
    return messages;
  };

  const recentMessages = async (sessionID: string) => {
    const selected: Message[] = [];
    let cursor: string | undefined;
    while (selected.length < RECENT_CONTEXT_LIMIT) {
      const page = await context.client.message.list(
        cursor
          ? { sessionID, limit: 200, cursor }
          : {
              sessionID,
              limit: 200,
              order: "desc",
            },
      );
      selected.push(...page.data.filter((message) => text(message) !== undefined));
      cursor = page.cursor.next;
      if (!cursor) break;
    }
    return selected.slice(0, RECENT_CONTEXT_LIMIT).toReversed();
  };

  const createTemp = (source: Session) =>
    context.client.session.create({
      title: sessiontitle(),
      location: source.location,
      agent: source.agent,
      model: source.model,
    });

  const cutoff = async (sessionID: string) => {
    let cursor: string | undefined;
    let newer: Message | undefined;
    do {
      const page = await context.client.message.list(
        cursor ? { sessionID, limit: 200, cursor } : { sessionID, limit: 200, order: "desc" },
      );
      for (const message of page.data) {
        if (
          message.type === "assistant" &&
          message.time.completed !== undefined &&
          message.finish !== "tool-calls" &&
          message.finish !== "unknown"
        )
          return newer ? { type: "before" as const, messageID: newer.id } : { type: "through" as const };
        newer = message;
      }
      cursor = page.cursor.next;
    } while (cursor);
  };

  const prepare = async (prompt?: string) => {
    if (!requireAvailable()) return;
    const source = await origin();
    log("v2:enter:start", { originSessionID: source.session.id, prompt: Boolean(prompt) });
    toast({ message: `Starting ${slash(openname())} session...` });
    if (prompt) await context.client.session.wait({ sessionID: source.session.id });
    const boundary = prompt
      ? (await cutoff(source.session.id)) ?? ((await latest(source.session.id)) ? { type: "through" as const } : undefined)
      : (await latest(source.session.id))
        ? { type: "through" as const }
        : undefined;
    const temp = boundary
      ? await context.client.session.fork({ sessionID: source.session.id, boundary })
      : await createTemp(source.session);
    const provisional: Active = {
      version: 2,
      origin: source.session.id,
      temp: temp.id,
      originUpdated: source.session.time.updated,
      kind: boundary ? "fork" : "empty",
    };
    await save(provisional);
    if (boundary) await context.client.session.rename({ sessionID: temp.id, title: sessiontitle() });
    const baselineMessageID = boundary ? (await latest(temp.id))?.id : undefined;
    const next = baselineMessageID ? { ...provisional, baselineMessageID } : provisional;
    await save(next);
    context.ui.router.navigate({ type: "session", sessionID: temp.id });
    log("v2:enter:ready", { originSessionID: source.session.id, tempSessionID: temp.id, kind: next.kind });
    if (!prompt) {
      toast({ message: `${slash(openname())} session active. Run ${slash(endname())} to return.` });
      return;
    }
    await context.client.session.prompt({
      sessionID: temp.id,
      text: prompt,
      metadata: { [PLUGIN_ID]: { type: "initial", origin: source.session.id, version: 2 } },
    });
  };

  const prepareFast = async () => {
    if (!requireAvailable()) return;
    const source = await origin();
    log("v2:fast:start", { originSessionID: source.session.id });
    toast({ message: `Starting ${slash(fastname())} session...` });
    const temp = await createTemp(source.session);
    await save({
      version: 2,
      origin: source.session.id,
      temp: temp.id,
      originUpdated: source.session.time.updated,
      kind: "fast",
    });
    const contextText = recentContext(await recentMessages(source.session.id));
    if (contextText) {
      await context.client.session.synthetic({
        sessionID: temp.id,
        text: contextText,
        description: `Recent context for ${slash(fastname())}`,
        metadata: {
          [PLUGIN_ID]: {
            type: "seed",
            origin: source.session.id,
            version: 2,
          },
        },
        resume: false,
      });
    }
    context.ui.router.navigate({ type: "session", sessionID: temp.id });
    log("v2:fast:ready", { originSessionID: source.session.id, tempSessionID: temp.id });
    toast({ message: `${slash(fastname())} session active. Run ${slash(endname())} to return.` });
  };

  const requireAvailable = () => {
    if (!inside()) return true;
    toast({ variant: "warning", message: `Already inside a ${slash(openname())} session.` });
    return false;
  };

  const requireTemp = () => {
    const sessionID = current();
    const active = sessionID ? activeRecords()[sessionID] : undefined;
    if (!active) {
      toast({ variant: "warning", message: `No active ${slash(openname())} session.` });
      return;
    }
    return active;
  };

  const afterBaseline = async (active: Active) => {
    if (!active.baselineMessageID) return allMessages(active.temp);
    const messages: Message[] = [];
    let cursor: string | undefined;
    do {
      const page = await context.client.message.list(
        cursor ? { sessionID: active.temp, limit: 200, cursor } : { sessionID: active.temp, limit: 200, order: "desc" },
      );
      const index = page.data.findIndex((message) => message.id === active.baselineMessageID);
      messages.push(...(index < 0 ? page.data : page.data.slice(0, index)));
      if (index >= 0) return messages.toReversed();
      cursor = page.cursor.next;
    } while (cursor);
    throw new Error("The by-the-way merge boundary is no longer available; nothing was merged.");
  };

  const merge = async () => {
    const active = requireTemp();
    if (!active) return;
    await context.client.session.wait({ sessionID: active.temp });
    const origin = await get(active.origin);
    if (
      origin.time.updated > active.originUpdated &&
      !(await context.ui.dialog.confirm({
        title: `Merge ${slash(openname())}?`,
        message: "The original session continued while this side session was active. Merge into its current state?",
        label: { confirm: "Merge", cancel: "Cancel" },
      }))
    )
      return;
    const value = active.mergeText ?? mergeText(await afterBaseline(active));
    if (value) {
      const mergeMessageID = active.mergeMessageID ?? `msg_${crypto.randomUUID().replaceAll("-", "")}`;
      if (!active.mergeMessageID || !active.mergeText) await save({ ...active, mergeMessageID, mergeText: value });
      await context.client.session.prompt({
        id: mergeMessageID,
        sessionID: active.origin,
        text: value,
        metadata: {
          [PLUGIN_ID]: {
            type: "merge",
            temp: active.temp,
            version: 2,
          },
        },
        resume: false,
      });
    }
    await context.client.session.remove({ sessionID: active.temp });
    await clear(active.temp);
    context.ui.router.navigate({ type: "session", sessionID: active.origin });
    log("v2:merge:complete", { originSessionID: active.origin, tempSessionID: active.temp, merged: Boolean(value) });
    toast({
      message: value
        ? "Merged back into the original session as it is now."
        : "No new text to merge. Returned to the original session as it is now.",
    });
  };

  const end = async () => {
    const active = requireTemp();
    if (!active) return;
    await context.client.session.remove({ sessionID: active.temp });
    await clear(active.temp);
    context.ui.router.navigate({ type: "session", sessionID: active.origin });
    log("v2:end:complete", { originSessionID: active.origin, tempSessionID: active.temp });
    toast({ message: `Ended ${slash(openname())} session.` });
  };

  const status = () =>
    toast({
      message: [
        `opencode-bytheway ${packageJson.version} is loaded.`,
        "mode: V2 TUI plugin",
        `session: ${current() ?? "<none>"}`,
      ].join("\n"),
    });

  const commands = () => [
    {
      id: "btw.open",
      title: "By the way",
      description: `Open a ${slash(openname())} side session in this terminal`,
      group: "Session",
      palette: true as const,
      slash: { name: openname(), arguments: true as const },
      enabled: () => !inside(),
      run: (input?: string) => void run(() => prepare(input?.trim() || undefined)),
    },
    {
      id: "btw.fast",
      title: "By the way fast",
      description: `Open a ${slash(openname())} side session with recent context only`,
      group: "Session",
      palette: true as const,
      slash: { name: fastname() },
      enabled: () => !inside(),
      run: () => void run(prepareFast),
    },
    {
      id: "btw.merge",
      title: `Merge ${slash(openname())}`,
      description: `Append ${slash(openname())} text back to the original session and close it`,
      group: "Session",
      palette: true as const,
      slash: { name: mergename() },
      enabled: inside,
      suggested: inside,
      run: () => void run(merge),
    },
    {
      id: "btw.end",
      title: `End ${slash(openname())}`,
      description: `Return to the original session and close ${slash(openname())}`,
      group: "Session",
      palette: true as const,
      slash: { name: endname() },
      enabled: inside,
      run: () => void run(end),
    },
    {
      id: "btw.status",
      title: "By the way status",
      description: "Check whether the opencode-bytheway plugin is loaded",
      group: "Session",
      palette: true as const,
      slash: { name: statusname() },
      run: status,
    },
    {
      id: "btw.prompt",
      title: "By the way prompt",
      description: "Open a by-the-way session and send an initial prompt",
      group: "Session",
      palette: true as const,
      slash: { name: EXPERIMENTAL_COMMAND, arguments: true as const },
      enabled: () => !inside(),
      run: (input?: string) => void run(() => prepare(input?.trim() || undefined)),
    },
  ];

  const mount = () => {
    context.keymap.layer(() => ({ mode: "global", commands: commands() }));
    return null;
  };

  log("v2:init", { pluginID: PLUGIN_ID });

  return {
    active: isTemp,
    commands,
    end: () => run(end),
    merge: () => run(merge),
    open: (prompt?: string) => run(() => prepare(prompt)),
    openFast: () => run(prepareFast),
    state,
    status,
    mount,
  };
}

export const setup = (async (context) => {
  const plugin = createV2(context);
  context.ui.slot({
    append: "sidebar.content",
    render: (props) =>
      createComponent(BtwIndicator, {
        context,
        get active() {
          return plugin.active(props.sessionID);
        },
      }),
  });
  return context.ui.slot({ append: "app", render: plugin.mount });
}) satisfies Plugin.Definition["setup"];

function sessiontitle() {
  return `${slash(openname())} session`;
}

function text(message: Message) {
  if (message.type === "user") return message.text.trim() || undefined;
  if (message.type !== "assistant") return;
  const value = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return value || undefined;
}

function recentContext(messages: Message[]) {
  const turns = messages.flatMap((message) => {
    const value = text(message);
    if (!value || (message.type !== "user" && message.type !== "assistant")) return [];
    return [`${message.type === "assistant" ? "Assistant" : "User"}:\n${value}`];
  });
  if (!turns.length) return;
  return [
    `Recent context from the original ${slash(openname())} session.`,
    `This context was copied by ${slash(fastname())}; do not merge it back.`,
    "",
    turns.join("\n\n"),
  ].join("\n");
}

function mergeText(messages: Message[]) {
  const turns = messages.flatMap((message) => {
    const value = text(message);
    if (!value || (message.type !== "user" && message.type !== "assistant")) return [];
    return [`${message.type === "assistant" ? "Assistant" : "User"}:\n${value}`];
  });
  if (!turns.length) return;
  return [
    `Merged context from a temporary ${slash(openname())} session.`,
    "Only plain user and assistant text is included below.",
    "",
    turns.join("\n\n"),
  ].join("\n");
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return "Request failed.";
  if ("message" in error && typeof error.message === "string") return error.message;
  if ("data" in error && error.data && typeof error.data === "object" && "message" in error.data) {
    if (typeof error.data.message === "string") return error.data.message;
  }
  return "Request failed.";
}

function isActive(value: Record<string, Active> | Active): value is Active {
  return value.version === 2 && typeof value.origin === "string" && typeof value.temp === "string";
}

export const internals = {
  errorMessage,
  mergeText,
  recentContext,
  text,
  slashbase,
};
