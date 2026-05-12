import { TextAttributes } from "@opentui/core";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { appendFile, readFile, unlink } from "node:fs/promises";
import packageJson from "./package.json" with { type: "json" };

declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
  }
}

const id = "opencode-bytheway";
const toastLogFile = "/tmp/opencode-bytheway-toast.log";
const eventLogFile = "/tmp/opencode-bytheway-event.log";
const runtimeMarker = "tui-file-handoff-prompt-v1";

const slashbase = () => {
  const env = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const value = env?.["OPENCODE_BYTHEWAY_COMMAND"]
    ?.trim()
    .replace(/^\/+/, "")
    .toLowerCase();
  if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) return "btw";
  return value;
};

const slash = (name: string) => `/${name}`;
const openname = () => slashbase();
const endname = () => `${slashbase()}-end`;
const mergename = () => `${slashbase()}-merge`;
const experimentaltitle = () => `${slash(openname())} experimental session`;

type Spawn =
  | { mode: "all"; count: number; boundary?: string }
  | { mode: "cut"; count: number; boundary: string; messageID: string };

type Btw = {
  origin: string;
  temp: string;
  baseCount?: number;
};

type SessionMessage = {
  info: {
    id: string;
    role: "user" | "assistant";
  };
  parts: Array<{
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

const ui = {
  muted: "#a5a5a5",
  accent: "#5f87ff",
  notice: "#1f2b3d",
};

const key = "opencode-bytheway.active";

const isbtw = (value: unknown): value is Btw => {
  if (!value || typeof value !== "object") return false;
  if (!("origin" in value) || typeof value.origin !== "string") return false;
  if (!("temp" in value) || typeof value.temp !== "string") return false;
  if ("baseCount" in value && value.baseCount !== undefined && typeof value.baseCount !== "number")
    return false;
  return true;
};

export const indicator = (sessionID: string | undefined, state?: Btw) => {
  if (!sessionID || !state || state.temp !== sessionID) return;
  return {
    title: `${slash(openname())} session active`,
    detail: `Run ${slash(endname())} to return`,
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

const handoffnamespace = () => {
  const env = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const value = env?.["OPENCODE_BYTHEWAY_HANDOFF_NAMESPACE"]?.trim();
  if (!value) return;
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
};

const handofffile = (originSessionID: string | undefined) => {
  const namespace = handoffnamespace();
  const token = (originSessionID ?? "none").replace(/[^a-zA-Z0-9_-]/g, "_");
  return namespace
    ? `/tmp/opencode-bytheway-handoff-${namespace}-${token}.json`
    : `/tmp/opencode-bytheway-handoff-${token}.json`;
};

const statusfile = (sessionID: string | undefined) => {
  const namespace = handoffnamespace();
  const token = (sessionID ?? "none").replace(/[^a-zA-Z0-9_-]/g, "_");
  return namespace
    ? `/tmp/opencode-bytheway-status-${namespace}-${token}.json`
    : `/tmp/opencode-bytheway-status-${token}.json`;
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

  const toast = (input: { variant?: "info" | "success" | "warning" | "error"; title?: string; message: string; duration?: number }) => {
    api.ui.toast(input);
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
    void appendFile(toastLogFile, `${line}\n`, "utf8").catch(() => undefined);
  };

  const logevent = (stage: string, data: Record<string, unknown>) => {
    const route = api.route.current;
    const currentSessionID = route.name === "session" && typeof route.params?.sessionID === "string"
      ? route.params.sessionID
      : undefined;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      runtimeMarker,
      stage,
      route: route.name,
      sessionID: currentSessionID ?? null,
      ...data,
    });
    void appendFile(eventLogFile, `${line}\n`, "utf8").catch(() => undefined);
  };

  logevent("tui:init", { pluginID: id });

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
    const list = await api.client.session.messages({ sessionID, limit: 1000 }).catch(() => undefined);
    if (!list?.data?.length) return [];
    return list.data as SessionMessage[];
  };

  const sessioninfo = async (sessionID: string) => {
    const next = await api.client.session.get({ sessionID }).catch(() => undefined);
    return next?.data;
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
      const children = await api.client.session.children({ sessionID }).catch(() => undefined);
      const temp = children?.data
        ?.filter((item) => item.title === sessiontitle() && !item.parentID)
        .sort((a, b) => b.time.updated - a.time.updated)[0];
      if (!temp?.id) return;

      const value = { origin: sessionID, temp: temp.id };
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
    const list = await api.client.session
      .list({ roots: true, order: "desc", limit: 1 })
      .catch((err) => ({ error: err }));
    if (list.error) logevent("enter:origin:list:error", { error: errorinfo(list.error) });
    const latest = list.data?.items?.[0]?.id;
    if (typeof latest === "string") {
      logevent("enter:origin:list:success", { sessionID: latest });
      return { sessionID: latest, created: false };
    }

    logevent("enter:origin:create:start", {});
    const next = await api.client.session.create().catch((err) => ({ error: err }));
    if (next.error) logevent("enter:origin:create:error", { error: errorinfo(next.error) });
    if (next.error || !next.data?.id)
      throw next.error ?? new Error("Failed to create a new session.");
    logevent("enter:origin:create:success", { sessionID: next.data.id });
    return { sessionID: next.data.id, created: true };
  };

  const cutoff = async (sessionID: string): Promise<Spawn> => {
    const list = await api.client.session.messages({ sessionID, limit: 1000 }).catch(() => undefined);
    if (!list?.data?.length) return { mode: "all", count: 0 };

    let last = -1;
    for (let i = list.data.length - 1; i >= 0; i--) {
      const item = list.data[i].info;
      if (item.role !== "assistant") continue;
      if (!item.time.completed) continue;
      if (!item.finish || ["tool-calls", "unknown"].includes(item.finish))
        continue;
      last = i;
      break;
    }

    if (last < 0) return { mode: "all", count: list.data.length };
    const boundary = list.data[last].info.id;
    const next = list.data[last + 1]?.info.id;
    if (!next) return { mode: "all", count: list.data.length, boundary };
    return { mode: "cut", count: list.data.length, boundary, messageID: next };
  };

  const mergetext = (items: SessionMessage[], start: number) => {
    const turns = items
      .slice(start)
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

  const readhandoff = async (originSessionID: string) => {
    try {
      const text = await readFile(handofffile(originSessionID), "utf8");
      const value = JSON.parse(text);
      if (!value || typeof value !== "object") return;
      if (value.type !== "experimental-btw") return;
      if (value.version !== 3) return;
      if (value.mode !== "btw.open") return;
      if (value.originSessionID !== null && typeof value.originSessionID !== "string") return;
      if (typeof value.prompt !== "string") return;
      return value as {
        type: "experimental-btw";
        version: 3;
        mode: "btw.open";
        originSessionID: string | null;
        prompt: string;
        time?: string;
      };
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
      if (!value || typeof value !== "object") return;
      if (value.type !== "opencode-bytheway-status") return;
      if (value.version !== 1) return;
      if (value.sessionID !== null && typeof value.sessionID !== "string") return;
      if (value.sessionID !== (sessionID ?? null)) return;
      if (typeof value.serverVersion !== "string") return;
      return value as StatusHandoff;
    } catch {
      return;
    }
  };

  const clearstatushandoff = async (sessionID: string | undefined) => {
    await unlink(statusfile(sessionID)).catch(() => undefined);
  };

  const fork = async (sessionID: string, cut: Spawn) => {
    const input = {
      sessionID,
      messageID: cut.mode === "cut" ? cut.messageID : undefined,
    };
    const next = await api.client.session.fork(input, { throwOnError: true }).catch((error) => ({ error }));
    if (next.error || !next.data?.id) {
      if (next.error) logevent("enter:fork:error", { originSessionID: sessionID, error: errorinfo(next.error) });

      // Some current OpenCode builds complete the fork but return an empty body,
      // which makes the generated SDK throw while decoding the successful response.
      const list = await api.client.session
        .list({ roots: true, order: "desc", limit: 5 })
        .catch((error) => ({ error }));
      if (list.error) logevent("enter:fork:fallback:list:error", { error: errorinfo(list.error) });
      const fallback = list.data?.items?.find((item) => item.id !== sessionID && !item.parentID)?.id;
      if (typeof fallback === "string") {
        logevent("enter:fork:fallback:list:success", { originSessionID: sessionID, sessionID: fallback });
        return fallback;
      }
    }
    if (next.error || !next.data?.id)
      throw next.error ?? new Error("Failed to create temporary session.");
    return next.data.id;
  };

  const label = async (sessionID: string) => {
    const next = await api.client.session
      .update({ sessionID, title: sessiontitle() })
      .catch(() => undefined);
    return !next?.error;
  };

  const enter = async () => {
    const sessionID = current();
    const state = await getstate();
    if (state && state.temp === sessionID) {
      toast({
        variant: "warning",
        message: `Already inside a ${slash(openname())} session. Run ${slash(endname())} to return.`,
      });
      return;
    }
    if (state) {
      const temp = await sessioninfo(state.temp);
      if (temp?.parentID) {
        save(undefined);
      } else if (temp?.id) {
        api.route.navigate("session", { sessionID: state.temp });
        return;
      }
      save(undefined);
    }

    try {
      logevent("enter:start", { sessionID, hasState: Boolean(state) });
      const source = await origin();
      const sourceID = source.sessionID;
      logevent("enter:origin", { sessionID: sourceID, created: source.created });
      const handoff = await readhandoff(sourceID);
      const experimental = handoff && handoff.originSessionID === sourceID ? handoff : undefined;
      if (experimental) {
        await clearhandoff(sourceID);
        logevent("experimental:claimed_handoff", {
          originSessionID: sourceID,
          promptLength: experimental.prompt.length,
        });
      }
      const cut = await cutoff(sourceID);
      logevent("enter:cutoff", { sessionID: sourceID, mode: cut.mode, count: cut.count, boundary: cut.boundary });
      const temp = await fork(sourceID, cut);
      logevent("enter:fork", { originSessionID: sourceID, tempSessionID: temp });
      await label(temp);
      save({ origin: sourceID, temp, baseCount: cut.count });
      api.route.navigate("session", { sessionID: temp });
      if (experimental) {
        if (experimental.prompt.trim()) {
          const seeded = await api.client.session.prompt({
            sessionID: temp,
            parts: [{ type: "text", text: experimental.prompt }],
          });
          if (seeded?.error) throw seeded.error;

          const after = await messages(temp);
          const baseCount = Math.max(after.length, cut.count + 2);
          save({ origin: sourceID, temp, baseCount });
          logevent("experimental:prompted", {
            originSessionID: sourceID,
            tempSessionID: temp,
            baseCount,
            promptLength: experimental.prompt.length,
          });
        }
        return;
      }
      const DialogAlert = api.ui.DialogAlert;
      api.ui.dialog.setSize("large");
      api.ui.dialog.replace(() =>
        DialogAlert({
          title: `Entered ${slash(openname())} Session`,
          message:
            `You are now in a temporary ${slash(openname())} session in this same terminal. Run ${slash(endname())} to return to your original session.`,
          onConfirm: () => {
            api.ui.dialog.clear();
          },
        }),
      );
    } catch (err) {
      logevent("enter:error", { error: errorinfo(err) });
      toast({
        variant: "error",
        message: msg(err),
      });
    }
  };

  const merge = async () => {
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
      const temp = await messages(state.temp);
      const baseCount = state.baseCount ?? (await messages(state.origin)).length;
      const text = mergetext(temp, baseCount);

      if (text) {
        const next = await api.client.session.prompt({
          sessionID: state.origin,
          noReply: true,
          parts: [{ type: "text", text }],
        });
        if (next.error) throw next.error;
      }

      api.route.navigate("session", { sessionID: state.origin });
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
            ? `Merged back from ${slash(openname())}, but failed to delete the temp session. Run ${slash(endname())} to clean it up.`
            : `Returned from ${slash(openname())}, but failed to delete the temp session.`,
        });
        return;
      }

      save(undefined);
      toast({
        variant: "info",
        message: text
          ? `Merged back from ${slash(openname())} session.`
          : `No new text to merge. Returned from ${slash(openname())} session.`,
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
    let result;
    try {
      result = await api.client.session.delete({ sessionID: state.temp });
    } catch {
      result = { error: new Error("Failed to delete the temp session.") };
    }
    if (result?.error) {
      toast({
        variant: "error",
        message: `Returned from ${slash(openname())}, but failed to delete the temp session.`,
      });
      return;
    }
    save(undefined);
    toast({
      variant: "info",
      message: `Returned from ${slash(openname())} session.`,
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

  api.slots.register({
    order: 60,
    slots: {
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

  api.command.register(() => {
    const sessionID = current();
    const tempState = currenttemp(sessionID, load());
    const active = Boolean(tempState);
    const inbtw = Boolean(indicator(sessionID, tempState));

    return [
      {
        title: "By the way",
        value: "btw.open",
        description: `Open a ${slash(openname())} side session in this terminal`,
        category: "Session",
        slash: { name: openname() },
        hidden: active,
        onSelect: () => {
          return enter();
        },
      },
      {
        title: `Merge ${slash(openname())}`,
        value: "btw.merge",
        description: `Append ${slash(openname())} text back to the original session and close it`,
        category: "Session",
        slash: { name: mergename() },
        hidden: !inbtw,
        suggested: inbtw,
        onSelect: () => {
          return merge();
        },
      },
      {
        title: `End ${slash(openname())}`,
        value: "btw.end",
        description: `Return to the original session and close ${slash(openname())}`,
        category: "Session",
        slash: { name: endname() },
        hidden: !inbtw,
        onSelect: () => {
          return end();
        },
      },
      {
        title: "By the way status",
        value: "btw.status",
        description: "Check whether the opencode-bytheway plugin is loaded",
        category: "Session",
        slash: { name: `${slashbase()}-status` },
        onSelect: () => {
          return status();
        },
      },
    ];
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default plugin;
