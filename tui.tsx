import { TextAttributes } from "@opentui/core";
import type { TuiPlugin, TuiPluginModule, TuiPromptRef } from "@opencode-ai/plugin/tui";
import { appendFile, readFile, unlink } from "node:fs/promises";
import packageJson from "./package.json" with { type: "json" };
import {
  ACTIVE_STATE_KEY,
  EXPERIMENTAL_COMMAND,
  PLUGIN_ID,
  TUI_EVENT_LOG_FILE,
  TUI_RUNTIME_MARKER,
  TUI_TOAST_LOG_FILE,
  diagnosticsenabled,
  endname,
  handofffile,
  isprompthandoff,
  isstatushandoff,
  mergename,
  openname,
  slash,
  slashbase,
  statusfile,
  statusname,
} from "./protocol.js";

declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
  }
}

type Spawn =
  | { mode: "all"; count: number; boundary?: string }
  | { mode: "cut"; count: number; boundary?: string; messageID: string };

type Btw = {
  origin: string;
  temp: string;
  /** Origin session timestamp when the side session was opened. Used to warn on merge. */
  originTime?: number;
  baseMessageID?: string;
  /** Fast-path boundary for forks where copied source messages keep their original timestamps. */
  baseTime?: number;
  /** Compatibility for active state saved by older plugin versions. */
  baseCount?: number;
  /** Used only when async prompt seeding cannot provide a concrete boundary. */
  skipInitial?: number;
};

type SessionInfo = {
  id: string;
  title?: string;
  parentID?: string;
  metadata?: Record<string, unknown>;
  time?: {
    created?: number;
    updated?: number;
  };
};

type SessionMessage = {
  info: {
    id: string;
    role: "user" | "assistant";
    parentID?: string;
    finish?: string;
    time?: {
      created?: number;
      completed?: number;
    };
  };
  parts: Array<{
    id?: string;
    type: string;
    text?: string;
    ignored?: boolean;
  }>;
};

type StatusHandoff = {
  type: "opencode-bytheway-status";
  version: 1;
  sessionID: string | null;
  serverVersion: string;
  time?: string;
};

type PromptHandoff = {
  type: "experimental-btw";
  version: 3;
  mode: "btw.open";
  originSessionID: string | null;
  prompt: string;
  time?: string;
};

const ui = {
  muted: "#a5a5a5",
  accent: "#5f87ff",
  notice: "#1f2b3d",
};

const key = ACTIVE_STATE_KEY;
const emptyCommandTurnTolerance = 5000;
const metadataKey = PLUGIN_ID;
const handoffMaxAge = 5 * 60 * 1000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isbtw = (value: unknown): value is Btw => {
  if (!value || typeof value !== "object") return false;
  if (!("origin" in value) || typeof value.origin !== "string") return false;
  if (!("temp" in value) || typeof value.temp !== "string") return false;
  if ("originTime" in value && value.originTime !== undefined && typeof value.originTime !== "number")
    return false;
  if ("baseMessageID" in value && value.baseMessageID !== undefined && typeof value.baseMessageID !== "string")
    return false;
  if ("baseTime" in value && value.baseTime !== undefined && typeof value.baseTime !== "number")
    return false;
  if ("baseCount" in value && value.baseCount !== undefined && typeof value.baseCount !== "number")
    return false;
  if ("skipInitial" in value && value.skipInitial !== undefined && typeof value.skipInitial !== "number")
    return false;
  return true;
};

const tempmetadata = (origin: string) => ({
  [metadataKey]: {
    type: "temp",
    origin,
    version: 1,
  },
});

const istempmetadata = (value: unknown, origin: string) => {
  if (!value || typeof value !== "object") return false;
  if (!(metadataKey in value)) return false;
  const item = value[metadataKey as keyof typeof value];
  if (!item || typeof item !== "object") return false;
  return "type" in item && item.type === "temp" && "origin" in item && item.origin === origin;
};

const btwstate = (origin: string, temp: string, baseMessageID?: string, extra: Partial<Btw> = {}): Btw => ({
  origin,
  temp,
  ...(baseMessageID ? { baseMessageID } : {}),
  ...extra,
});

export const indicator = (sessionID: string | undefined, state?: Btw) => {
  if (!sessionID || !state || state.temp !== sessionID) return;
  return {
    title: `${slash(openname())} session active`,
    detail: `Run ${slash(endname())} to return to the original session as it is now`,
  };
};

export const sessiontitle = () => `${slash(openname())} session`;

const statustext = (sessionID: string | undefined) => [
  `opencode-bytheway ${packageJson.version} is loaded.`,
  `session: ${sessionID ?? "<none>"}`,
].join("\n");

const statusreport = (sessionID: string | undefined, handoff?: StatusHandoff) => {
  if (!handoff) {
    return {
      title: "opencode-bytheway",
      message: statustext(sessionID),
      variant: "info" as const,
    };
  }

  const same = handoff.serverVersion === packageJson.version;
  if (same) {
    return {
      title: "opencode-bytheway",
      message: [
        "opencode-bytheway is loaded.",
        `server: ${handoff.serverVersion}`,
        `tui: ${packageJson.version}`,
        `session: ${sessionID ?? "<none>"}`,
      ].join("\n"),
      variant: "info" as const,
    };
  }

  return {
    title: "opencode-bytheway version mismatch",
    message: [
      "opencode-bytheway server and TUI plugin versions differ.",
      `server: ${handoff.serverVersion}`,
      `tui: ${packageJson.version}`,
      "Update both opencode.jsonc and tui.jsonc to the same package version.",
      `session: ${sessionID ?? "<none>"}`,
    ].join("\n"),
    variant: "warning" as const,
  };
};

const errorinfo = (err: unknown) => {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  if (err && typeof err === "object") {
    try {
      return { message: String(err), value: JSON.stringify(err) };
    } catch {
      return { message: String(err) };
    }
  }
  return { message: String(err) };
};

const msg = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (!err || typeof err !== "object") return "Request failed.";
  if ("message" in err && typeof err.message === "string") return err.message;
  if (!("data" in err) || !err.data || typeof err.data !== "object")
    return "Request failed.";
  if (!("message" in err.data) || typeof err.data.message !== "string")
    return "Request failed.";
  return err.data.message;
};

const tui: TuiPlugin = async (api) => {
  let btw: Btw | undefined;
  let resolving: Promise<Btw | undefined> | undefined;
  let homePrompt: TuiPromptRef | undefined;
  const sessionPrompts = new Map<string, TuiPromptRef>();
  let commanddispose: (() => void) | undefined;
  let refreshcommands = () => {};

  const toast = (input: { variant?: "info" | "success" | "warning" | "error"; title?: string; message: string; duration?: number }) => {
    api.ui.toast(input);
    if (!diagnosticsenabled()) return;
    const route = api.route.current;
    const currentSessionID = route.name === "session" && typeof route.params?.sessionID === "string"
      ? route.params.sessionID
      : undefined;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      variant: input.variant ?? "info",
      title: input.title ?? null,
      message: input.message,
      route: route.name,
      sessionID: currentSessionID ?? null,
    });
    void appendFile(TUI_TOAST_LOG_FILE, `${line}\n`, "utf8").catch(() => undefined);
  };

  const logevent = (stage: string, data: Record<string, unknown>) => {
    if (!diagnosticsenabled()) return;
    const route = api.route.current;
    const currentSessionID = route.name === "session" && typeof route.params?.sessionID === "string"
      ? route.params.sessionID
      : undefined;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      runtimeMarker: TUI_RUNTIME_MARKER,
      stage,
      route: route.name,
      sessionID: currentSessionID ?? null,
      ...data,
    });
    void appendFile(TUI_EVENT_LOG_FILE, `${line}\n`, "utf8").catch(() => undefined);
  };
  const logdiagnostic = (stage: string, data: Record<string, unknown> = {}) => {
    logevent(`diagnostic:${stage}`, data);
  };

  logevent("tui:init", { pluginID: PLUGIN_ID });

  const load = () => {
    if (btw) return btw;
    if (!api.kv.ready) return;
    const value = api.kv.get(key);
    if (!isbtw(value)) return;
    btw = value;
    return btw;
  };

  const save = (value?: Btw) => {
    btw = value;
    if (!api.kv.ready) return;
    api.kv.set(key, value ?? null);
    refreshcommands();
  };

  const current = () => {
    const route = api.route.current;
    if (route.name !== "session") return;
    const sessionID = route.params?.sessionID;
    if (typeof sessionID !== "string") return;
    return sessionID;
  };

  const currenttemp = (sessionID: string | undefined, state?: Btw) => {
    if (!sessionID || !state) return;
    if (state.temp === sessionID) return state;
  };

  const messages = async (sessionID: string): Promise<SessionMessage[]> => {
    const list = await api.client.session.messages({ sessionID }).catch(() => undefined);
    if (!list?.data?.length) return [];
    return list.data as SessionMessage[];
  };

  const sessioninfo = async (sessionID: string) => {
    const next: any = await api.client.session.get({ sessionID }).catch(() => undefined);
    return next?.data as SessionInfo | undefined;
  };

  const rootsessions = async (limit: number) => {
    const list: any = await api.client.session
      .list({ roots: true, limit })
      .catch((err) => ({ error: err }));
    if (list.error) throw list.error;
    if (Array.isArray(list.data)) return list.data as SessionInfo[];
    return (list.data?.items ?? []) as SessionInfo[];
  };

  const collecttext = (parts: SessionMessage["parts"]) =>
    parts
      .filter((part) => part.type === "text" && typeof part.text === "string" && !part.ignored)
      .map((part) => part.text!.trim())
      .filter(Boolean)
      .join("\n\n");

  const rehydrate = async () => {
    if (btw) return btw;
    if (resolving) return resolving;

    const sessionID = current();
    if (!sessionID) return;

    resolving = (async () => {
      const temp = (await rootsessions(20).catch(() => []))
        .filter((item) => istempmetadata(item.metadata, sessionID))
        .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))[0];
      if (!temp?.id) return;

      const value = btwstate(sessionID, temp.id);
      save(value);
      return value;
    })().finally(() => {
      resolving = undefined;
    });

    return resolving;
  };

  const getstate = async () => load() ?? (await rehydrate());

  const origin = async () => {
    const sessionID = current();
    if (sessionID) return { sessionID, created: false };

    logevent("enter:origin:list:start", {});
    const list: any = await api.client.session
      .list({ roots: true, limit: 1 })
      .catch((err) => ({ error: err }));
    if (list.error) logevent("enter:origin:list:error", { error: errorinfo(list.error) });
    const latest = (Array.isArray(list.data) ? list.data : list.data?.items)?.[0]?.id;
    if (typeof latest === "string") {
      logevent("enter:origin:list:success", { sessionID: latest });
      return { sessionID: latest, created: false };
    }

    logevent("enter:origin:create:start", {});
    const next: any = await api.client.session.create().catch((err) => ({ error: err }));
    if (next.error) logevent("enter:origin:create:error", { error: errorinfo(next.error) });
    if (next.error || !next.data?.id)
      throw next.error ?? new Error("Failed to create a new session.");
    logevent("enter:origin:create:success", { sessionID: next.data.id });
    return { sessionID: next.data.id, created: true };
  };

  const cutoff = async (sessionID: string, options?: { emptyCommandTurnSince?: number }): Promise<Spawn> => {
    const list = await api.client.session.messages({ sessionID }).catch(() => undefined);
    if (!list?.data?.length) return { mode: "all", count: 0 };
    const stripped = options
      ? withoutemptycommandturn(list.data as SessionMessage[], options.emptyCommandTurnSince)
      : { items: list.data as SessionMessage[] };
    const items = stripped.items;
    const stopBefore = stripped.messageID;
    if (!items.length) {
      if (stopBefore) return { mode: "cut", count: 0, boundary: undefined, messageID: stopBefore };
      return { mode: "all", count: 0 };
    }

    let last = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i].info;
      if (item.role !== "assistant") continue;
      if (!item.time?.completed) continue;
      if (!item.finish || ["tool-calls", "unknown"].includes(item.finish))
        continue;
      last = i;
      break;
    }

    if (last < 0) {
      const boundary = items.at(-1)?.info.id;
      if (stopBefore) return { mode: "cut", count: items.length, boundary: boundary ?? stopBefore, messageID: stopBefore };
      return { mode: "all", count: items.length, boundary };
    }
    const boundary = items[last].info.id;
    const next = items[last + 1]?.info.id ?? stopBefore;
    if (!next) return { mode: "all", count: items.length, boundary };
    return { mode: "cut", count: items.length, boundary, messageID: next };
  };

  const mergeitems = (items: SessionMessage[], state: Btw) => {
    if (state.baseMessageID) {
      const index = items.findIndex((item) => item.info.id === state.baseMessageID);
      if (index >= 0) return items.slice(index + 1 + (state.skipInitial ?? 0));
      if (state.baseCount === undefined) return [];
    }
    if (state.baseTime !== undefined) {
      return items
        .filter((item) => typeof item.info.time?.created === "number" && item.info.time.created >= state.baseTime!)
        .slice(state.skipInitial ?? 0);
    }
    return items.slice((state.baseCount ?? 0) + (state.skipInitial ?? 0));
  };

  const mergetext = (items: SessionMessage[]) => {
    const turns = items
      .map((item) => {
        const text = collecttext(item.parts);
        if (!text) return;
        const role = item.info.role === "assistant" ? "Assistant" : "User";
        return `${role}:\n${text}`;
      })
      .filter((item): item is string => Boolean(item));
    if (!turns.length) return;
    return [
      `Merged context from a temporary ${slash(openname())} session.`,
      "Only plain user and assistant text is included below.",
      "",
      turns.join("\n\n"),
    ].join("\n");
  };

  const originadvanced = async (state: Btw) => {
    if (state.originTime === undefined) return false;
    const info = await sessioninfo(state.origin);
    const updated = info?.time?.updated ?? info?.time?.created;
    return typeof updated === "number" && updated > state.originTime;
  };

  const confirmoriginmerge = (state: Btw) => {
    const DialogConfirm = api.ui.DialogConfirm;
    api.ui.dialog.setSize("large");
    api.ui.dialog.replace(() =>
      DialogConfirm({
        title: `Merge ${slash(openname())} into updated origin?`,
        message:
          `The original session continued while this ${slash(openname())} session was active. Merge into the original session as it is now?`,
        onConfirm: () => {
          api.ui.dialog.clear();
          void merge(true);
        },
        onCancel: () => {
          api.ui.dialog.clear();
        },
      }),
    );
  };

  const readhandoff = async (originSessionID: string) => {
    try {
      const text = await readFile(handofffile(originSessionID), "utf8");
      const value = JSON.parse(text);
      if (!isprompthandoff(value)) return;
      if (expired(value.time)) {
        await clearhandoff(originSessionID);
        return;
      }
      return value as PromptHandoff;
    } catch {
      return;
    }
  };

  const clearhandoff = async (originSessionID: string) => {
    await unlink(handofffile(originSessionID)).catch(() => undefined);
  };

  const readstatushandoff = async (sessionID: string | undefined) => {
    try {
      const text = await readFile(statusfile(sessionID), "utf8");
      const value = JSON.parse(text);
      if (!isstatushandoff(value, sessionID)) return;
      if (expired(value.time)) {
        await clearstatushandoff(sessionID);
        return;
      }
      return value as StatusHandoff;
    } catch {
      return;
    }
  };

  const clearstatushandoff = async (sessionID: string | undefined) => {
    await unlink(statusfile(sessionID)).catch(() => undefined);
  };

  const handofftime = (handoff: PromptHandoff | undefined) => {
    const time = Date.parse(handoff?.time ?? "");
    return Number.isFinite(time) ? time : undefined;
  };

  const expired = (time: string | undefined) => {
    if (!time) return false;
    const value = Date.parse(time);
    return Number.isFinite(value) && Date.now() - value > handoffMaxAge;
  };

  const emptycommandturn = (items: SessionMessage[], since?: number) => {
    if (items.length < 2) return;
    const user = items.at(-2);
    const assistant = items.at(-1);
    if (!user || !assistant) return;
    if (user.info.role !== "user") return;
    if (assistant.info.role !== "assistant") return;
    if (assistant.info.parentID !== user.info.id) return;
    if (user.parts.length || assistant.parts.length) return;

    const created = user.info.time?.created;
    if (since !== undefined && created !== undefined && created < since - emptyCommandTurnTolerance)
      return;

    return { user, assistant };
  };

  const deleteemptycommandturn = async (sessionID: string, since?: number) => {
    const client = api.client.session as typeof api.client.session & {
      abort?: (args: { sessionID: string }) => Promise<{ error?: unknown } | undefined>;
      deleteMessage?: (args: { sessionID: string; messageID: string }) => Promise<{ error?: unknown } | undefined>;
    };
    if (typeof client.deleteMessage !== "function") {
      logevent("experimental:cleanup:unavailable", { originSessionID: sessionID });
      return false;
    }

    let aborted = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const turn = emptycommandturn(await messages(sessionID), since);
      if (!turn) {
        await delay(25);
        continue;
      }

      const remove = async (messageID: string) => {
        const result = await client.deleteMessage!({ sessionID, messageID }).catch((error) => ({ error }));
        if (result?.error) {
          logevent("experimental:cleanup:delete_error", {
            originSessionID: sessionID,
            messageID,
            attempt,
            error: errorinfo(result.error),
          });
          return false;
        }
        return true;
      };

      const removedAssistant = await remove(turn.assistant.info.id);
      const removedUser = removedAssistant ? await remove(turn.user.info.id) : false;
      if (removedAssistant && removedUser) {
        logevent("experimental:cleanup:deleted", {
          originSessionID: sessionID,
          userMessageID: turn.user.info.id,
          assistantMessageID: turn.assistant.info.id,
          attempt,
        });
        return true;
      }

      if (!aborted && typeof client.abort === "function") {
        aborted = true;
        const result = await client.abort({ sessionID }).catch((error) => ({ error }));
        logevent(result?.error ? "experimental:cleanup:abort_error" : "experimental:cleanup:aborted", {
          originSessionID: sessionID,
          error: result?.error ? errorinfo(result.error) : undefined,
        });
      }
      await delay(25);
    }

    logevent("experimental:cleanup:miss", { originSessionID: sessionID });
    return false;
  };

  const withoutemptycommandturn = (items: SessionMessage[], since?: number) => {
    const turn = emptycommandturn(items, since);
    return turn ? { items: items.slice(0, -2), messageID: turn.user.info.id } : { items };
  };

  const fork = async (sessionID: string, cut: Spawn) => {
    const started = Date.now();
    const input = {
      sessionID,
      messageID: cut.mode === "cut" ? cut.messageID : undefined,
    };
    const next: any = await api.client.session.fork(input, { throwOnError: true }).catch((error) => ({ error }));
    if (next.error || !next.data?.id) {
      if (next.error) logevent("enter:fork:error", { originSessionID: sessionID, error: errorinfo(next.error) });

      // Some current OpenCode builds complete the fork but return an empty body,
      // which makes the generated SDK throw while decoding the successful response.
      const list: any = await api.client.session
        .list({ roots: true, limit: 5 })
        .catch((error) => ({ error }));
      if (list.error) logevent("enter:fork:fallback:list:error", { error: errorinfo(list.error) });
      const items = Array.isArray(list.data) ? list.data : list.data?.items ?? [];
      const fallback = items.find((item) => {
        if (item.id === sessionID || item.parentID) return false;
        if (istempmetadata(item.metadata, sessionID)) return true;
        const created = item.time?.created ?? item.time?.updated;
        return typeof created === "number" && created >= started - 1000;
      })?.id;
      if (typeof fallback === "string") {
        logevent("enter:fork:fallback:list:success", { originSessionID: sessionID, sessionID: fallback });
        return fallback;
      }
    }
    if (next.error || !next.data?.id)
      throw next.error ?? new Error("Failed to create temporary session.");
    return next.data.id;
  };

  const label = async (sessionID: string, originSessionID: string) => {
    const session = api.client.session as typeof api.client.session & {
      update(args: { sessionID: string; title: string; metadata: Record<string, unknown> }): Promise<{ error?: unknown } | undefined>;
    };
    const next = await session
      .update({ sessionID, title: sessiontitle(), metadata: tempmetadata(originSessionID) })
      .catch(() => undefined);
    return !next?.error;
  };

  const stateforentry = (sessionID: string | undefined, state: Btw | undefined) => {
    const staleState = state && sessionID && state.origin !== sessionID && state.temp !== sessionID ? state : undefined;
    if (!staleState) return state;

    logdiagnostic("enter.mismatched_state", {
      sessionID,
      stateOrigin: staleState.origin,
      stateTemp: staleState.temp,
    });
    save(undefined);
    return undefined;
  };

  const resumeactiveentry = async (sessionID: string | undefined, activeState: Btw | undefined) => {
    logdiagnostic("enter.preflight", {
      sessionID: sessionID ?? null,
      hasState: Boolean(activeState),
      stateOrigin: activeState?.origin ?? null,
      stateTemp: activeState?.temp ?? null,
      kvReady: api.kv.ready,
    });

    if (!activeState) return false;
    if (activeState.temp === sessionID) {
      logdiagnostic("enter.already_inside", {
        sessionID: sessionID ?? null,
        stateOrigin: activeState.origin,
        stateTemp: activeState.temp,
      });
      toast({
        variant: "warning",
        message: `Already inside a ${slash(openname())} session. Run ${slash(endname())} to return to the original session as it is now.`,
      });
      return true;
    }

    const temp = await sessioninfo(activeState.temp);
    logdiagnostic("enter.existing_temp", {
      stateOrigin: activeState.origin,
      stateTemp: activeState.temp,
      found: Boolean(temp?.id),
      parentID: temp?.parentID ?? null,
    });
    if (temp?.id && !temp.parentID) {
      logdiagnostic("enter.reuse_temp", {
        stateOrigin: activeState.origin,
        stateTemp: activeState.temp,
      });
      api.route.navigate("session", { sessionID: activeState.temp });
      refreshcommands();
      return true;
    }

    save(undefined);
    return false;
  };

  const claimexperimentalhandoff = async (sourceID: string) => {
    const handoff = await readhandoff(sourceID);
    const experimental = handoff && handoff.originSessionID === sourceID ? handoff : undefined;
    if (!experimental) return;

    await clearhandoff(sourceID);
    logevent("experimental:claimed_handoff", {
      originSessionID: sourceID,
      promptLength: experimental.prompt.length,
    });
    return experimental;
  };

  const seedexperimentalprompt = async (sourceID: string, temp: string, cut: Spawn, experimental: PromptHandoff, originTime: number) => {
    if (!experimental.prompt.trim()) return;

    logevent("experimental:prompt:start", {
      originSessionID: sourceID,
      tempSessionID: temp,
      promptLength: experimental.prompt.length,
    });
    const payload: { sessionID: string; parts: Array<{ type: "text"; text: string }> } = {
      sessionID: temp,
      parts: [{ type: "text", text: experimental.prompt }],
    };

    const promptAsync = "promptAsync" in api.client.session && typeof api.client.session.promptAsync === "function"
      ? api.client.session.promptAsync.bind(api.client.session)
      : undefined;
    const seeded = promptAsync
      ? await promptAsync(payload)
      : await api.client.session.prompt(payload);
    if (seeded?.error) throw seeded.error;

    const after = promptAsync ? [] : await messages(temp);
    const seededBoundary = after.at(-1)?.info.id;
    const nextState = seededBoundary
      ? btwstate(sourceID, temp, seededBoundary, { originTime })
      : btwstate(sourceID, temp, cut.boundary, { originTime, skipInitial: 2 });
    save(nextState);
    logevent("experimental:prompted", {
      originSessionID: sourceID,
      tempSessionID: temp,
      baseMessageID: nextState.baseMessageID ?? null,
      skipInitial: nextState.skipInitial ?? 0,
      promptLength: experimental.prompt.length,
    });
  };

  const showentrydialog = () => {
    const DialogAlert = api.ui.DialogAlert;
    api.ui.dialog.setSize("large");
    api.ui.dialog.replace(() =>
      DialogAlert({
        title: `Entered ${slash(openname())} Session`,
        message:
          `You are now in a temporary ${slash(openname())} session in this same terminal. Run ${slash(endname())} to return to your original session in its current state at return time.`,
        onConfirm: () => {
          api.ui.dialog.clear();
        },
      }),
    );
  };

  const openentry = async (sessionID: string | undefined, activeState: Btw | undefined, directPrompt?: string) => {
    logevent("enter:start", { sessionID, hasState: Boolean(activeState) });
    const source = await origin();
    const sourceID = source.sessionID;
    logevent("enter:origin", { sessionID: sourceID, created: source.created });

    const claimed = directPrompt === undefined ? await claimexperimentalhandoff(sourceID) : undefined;
    const experimental = directPrompt !== undefined
      ? {
          type: "experimental-btw" as const,
          version: 3 as const,
          mode: "btw.open" as const,
          originSessionID: sourceID,
          prompt: directPrompt,
        }
      : claimed;
    const cleanupSince = handofftime(claimed);
    if (claimed) await deleteemptycommandturn(sourceID, cleanupSince);
    const originTime = Date.now();
    const fastBoundary = !experimental;
    const cut = fastBoundary
      ? ({ mode: "all", count: 0 } as Spawn)
      : await cutoff(sourceID, claimed ? { emptyCommandTurnSince: cleanupSince } : undefined);
    logevent("enter:cutoff", {
      sessionID: sourceID,
      mode: fastBoundary ? "time" : cut.mode,
      count: cut.count,
      boundary: cut.boundary,
    });
    const temp = await fork(sourceID, cut);
    logevent("enter:fork", { originSessionID: sourceID, tempSessionID: temp });
    const labeled = await label(temp, sourceID);
    logevent("enter:label", { originSessionID: sourceID, tempSessionID: temp, labeled });
    save(btwstate(sourceID, temp, cut.boundary, { originTime, ...(fastBoundary ? { baseTime: Date.now() } : {}) }));
    api.route.navigate("session", { sessionID: temp });
    refreshcommands();

    if (experimental) {
      await seedexperimentalprompt(sourceID, temp, cut, experimental, originTime);
      return;
    }

    showentrydialog();
  };

  const enter = async (directPrompt?: string) => {
    const sessionID = current();
    const activeState = stateforentry(sessionID, await getstate());
    if (await resumeactiveentry(sessionID, activeState)) return;

    try {
      await openentry(sessionID, activeState, directPrompt);
    } catch (err) {
      logevent("enter:error", { error: errorinfo(err) });
      toast({
        variant: "error",
        message: msg(err),
      });
    }
  };

  const merge = async (confirmed = false) => {
    const state = await getstate();
    if (!state) {
      toast({
        variant: "warning",
        message: `No active ${slash(openname())} session.`,
      });
      return;
    }

    if (current() !== state.temp) {
      toast({
        variant: "warning",
        message: `Run ${slash(mergename())} from inside the active ${slash(openname())} session.`,
      });
      return;
    }

    try {
      if (!confirmed && await originadvanced(state)) {
        confirmoriginmerge(state);
        return;
      }

      const temp = await messages(state.temp);
      const text = mergetext(mergeitems(temp, state));

      if (text) {
        const next = await api.client.session.prompt({
          sessionID: state.origin,
          noReply: true,
          parts: [{ type: "text", text }],
        });
        if (next.error) throw next.error;
      }

      api.route.navigate("session", { sessionID: state.origin });
      refreshcommands();
      let result;
      try {
        result = await api.client.session.delete({ sessionID: state.temp });
      } catch {
        result = { error: new Error("Failed to delete the temp session.") };
      }
      if (result?.error) {
        toast({
          variant: "error",
          message: text
            ? `Merged back into the original session as it is now, but failed to delete the temp session. Run ${slash(endname())} to clean it up.`
            : `Returned to the original session as it is now, but failed to delete the temp session.`,
        });
        return;
      }

      save(undefined);
      toast({
        variant: "info",
        message: text
          ? `Merged back into the original session as it is now.`
          : `No new text to merge. Returned to the original session as it is now.`,
      });
    } catch (err) {
      toast({
        variant: "error",
        message: msg(err),
      });
    }
  };

  const end = async () => {
    const state = await getstate();
    if (!state) {
      toast({
        variant: "warning",
        message: `No active ${slash(openname())} session.`,
      });
      return;
    }
    if (state.temp !== current()) {
      toast({
        variant: "warning",
        message: `Run ${slash(endname())} from inside the active ${slash(openname())} session.`,
      });
      return;
    }

    api.route.navigate("session", { sessionID: state.origin });
    refreshcommands();
    let result;
    try {
      result = await api.client.session.delete({ sessionID: state.temp });
    } catch {
      result = { error: new Error("Failed to delete the temp session.") };
    }
    if (result?.error) {
      toast({
        variant: "error",
        message: `Returned to the original session as it is now, but failed to delete the temp session.`,
      });
      return;
    }
    save(undefined);
    toast({
      variant: "info",
      message: `Returned to the original session as it is now.`,
    });
  };

  const status = async () => {
    const sessionID = current();
    const handoff = await readstatushandoff(sessionID);
    if (handoff) await clearstatushandoff(sessionID);
    const report = statusreport(sessionID, handoff);
    toast({
      title: report.title,
      message: report.message,
      variant: report.variant,
      duration: 6000,
    });
  };

  const activeprompt = () => {
    const route = api.route.current;
    if (route.name === "session" && typeof route.params?.sessionID === "string")
      return sessionPrompts.get(route.params.sessionID);
    if (route.name === "home") return homePrompt;
  };

  const parsepromptcommand = (input: string) => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith("/")) return;
    const match = trimmed.slice(1).match(/^(\S+)(?:\s+([\s\S]*))?$/);
    if (!match) return;
    return { name: match[1], arguments: match[2] ?? "" };
  };

  const isbtwpromptcommand = (input: string) => {
    const command = parsepromptcommand(input);
    if (!command) return false;
    return [openname(), mergename(), endname(), statusname(), EXPERIMENTAL_COMMAND].includes(command.name);
  };

  const handlepromptsubmit = () => {
    const prompt = activeprompt();
    if (!prompt?.focused) return false;

    const command = parsepromptcommand(prompt.current.input);
    if (!command) return false;

    if (command.name === openname()) {
      const text = command.arguments;
      prompt.reset();
      void enter(text.trim() ? text : undefined);
      return true;
    }
    if (command.name === mergename()) {
      prompt.reset();
      void merge();
      return true;
    }
    if (command.name === endname()) {
      prompt.reset();
      void end();
      return true;
    }
    if (command.name === statusname()) {
      prompt.reset();
      void status();
      return true;
    }
    if (command.name === EXPERIMENTAL_COMMAND) {
      const text = command.arguments;
      prompt.reset();
      void enter(text.trim() ? text : undefined);
      return true;
    }

    return false;
  };

  api.keymap?.registerLayer?.({
    priority: 1000,
    enabled: () => {
      const prompt = activeprompt();
      return Boolean(prompt?.focused && isbtwpromptcommand(prompt.current.input));
    },
    commands: [
      {
        name: "prompt.submit",
        hidden: true,
        run: handlepromptsubmit,
      },
    ],
    bindings: [{ key: "return", cmd: "prompt.submit" }],
  });

  api.slots.register({
    order: 60,
    slots: {
      home_prompt(_ctx, value) {
        const bind = (ref: TuiPromptRef | undefined) => {
          homePrompt = ref;
          if (typeof value.ref === "function") value.ref(ref);
        };
        return api.ui.Prompt({
          ref: bind,
          right: api.ui.Slot({ name: "home_prompt_right" }),
        });
      },
      session_prompt(_ctx, value) {
        const sessionID = value.session_id;
        if (typeof sessionID !== "string") return null;
        const bind = (ref: TuiPromptRef | undefined) => {
          if (ref) sessionPrompts.set(sessionID, ref);
          else sessionPrompts.delete(sessionID);
          if (typeof value.ref === "function") value.ref(ref);
        };
        return api.ui.Prompt({
          sessionID,
          visible: value.visible,
          disabled: value.disabled,
          onSubmit: value.on_submit,
          ref: bind,
          right: api.ui.Slot({ name: "session_prompt_right", session_id: sessionID }),
        });
      },
      sidebar_content(_ctx, value) {
        const item = indicator(value.session_id, load());
        if (!item) return null;

        return (
          <box
            border
            borderColor={ui.accent}
            backgroundColor={ui.notice}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            flexDirection="column"
            gap={1}
          >
            <text fg={ui.accent} attributes={TextAttributes.BOLD}>
              {item.title}
            </text>
            <text fg={ui.muted}>{item.detail}</text>
          </box>
        );
      },
    },
  });

  logdiagnostic("command.register", {
    commands: ["btw.open", "btw.merge", "btw.end", "btw.status", "btw.prompt"],
    slashbase: slashbase(),
  });
  const commandstate = () => {
    const sessionID = current();
    const tempState = currenttemp(sessionID, load());
    const active = Boolean(tempState);
    const inbtw = Boolean(indicator(sessionID, tempState));
    logdiagnostic("command.rows", { sessionID: sessionID ?? null, active, inbtw });
    return { sessionID, active, inbtw };
  };

  const selectcommand = (name: string, run: () => void | Promise<void>) => {
    logdiagnostic("command.select", { command: name, sessionID: current() ?? null });
    return run();
  };

  refreshcommands = () => {
    commanddispose?.();
    const state = commandstate();
    commanddispose = api.keymap.registerLayer({
      commands: [
      {
        namespace: "palette",
        name: "btw.open",
        title: "By the way",
        value: "btw.open",
        desc: `Open a ${slash(openname())} side session in this terminal`,
        description: `Open a ${slash(openname())} side session in this terminal`,
        category: "Session",
        slashName: openname(),
        slash: { name: openname() },
        hidden: state.active,
        run: () => selectcommand("btw.open", () => enter()),
        onSelect: () => selectcommand("btw.open", () => enter()),
      },
      {
        namespace: "palette",
        name: "btw.merge",
        title: `Merge ${slash(openname())}`,
        value: "btw.merge",
        desc: `Append ${slash(openname())} text back to the original session and close it`,
        description: `Append ${slash(openname())} text back to the original session and close it`,
        category: "Session",
        slashName: mergename(),
        slash: { name: mergename() },
        hidden: !state.inbtw,
        suggested: state.inbtw,
        run: () => selectcommand("btw.merge", () => merge()),
        onSelect: () => selectcommand("btw.merge", () => merge()),
      },
      {
        namespace: "palette",
        name: "btw.end",
        title: `End ${slash(openname())}`,
        value: "btw.end",
        desc: `Return to the original session as it is now and close ${slash(openname())}`,
        description: `Return to the original session as it is now and close ${slash(openname())}`,
        category: "Session",
        slashName: endname(),
        slash: { name: endname() },
        hidden: !state.inbtw,
        run: () => selectcommand("btw.end", () => end()),
        onSelect: () => selectcommand("btw.end", () => end()),
      },
      {
        namespace: "palette",
        name: "btw.status",
        title: "By the way status",
        value: "btw.status",
        desc: "Check whether the opencode-bytheway plugin is loaded",
        description: "Check whether the opencode-bytheway plugin is loaded",
        category: "Session",
        slashName: statusname(),
        slash: { name: statusname() },
        run: () => selectcommand("btw.status", () => status()),
        onSelect: () => selectcommand("btw.status", () => status()),
      },
      {
        namespace: "palette",
        name: "btw.prompt",
        title: "By the way prompt",
        value: "btw.prompt",
        desc: "Open a by-the-way session and send an initial prompt",
        description: "Open a by-the-way session and send an initial prompt",
        category: "Session",
        slashName: EXPERIMENTAL_COMMAND,
        slash: { name: EXPERIMENTAL_COMMAND },
        hidden: state.active,
        run: () => selectcommand("btw.prompt", () => enter()),
        onSelect: () => selectcommand("btw.prompt", () => enter()),
      },
      ],
    });
  };
  refreshcommands();
};

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
};

export default plugin;
