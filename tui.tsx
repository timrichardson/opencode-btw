import { TextAttributes } from "@opentui/core";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { appendFile, readFile, unlink } from "node:fs/promises";

declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
  }
}

const id = "opencode-bytheway";
const toastLogFile = "/tmp/opencode-bytheway-toast.log";
const eventLogFile = "/tmp/opencode-bytheway-event.log";
const handoffFile = "/tmp/opencode-bytheway-handoff.json";
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
const endname = () => `${slashbase()}_end`;
const mergename = () => `${slashbase()}_merge`;
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

  const messages = async (sessionID: string): Promise<SessionMessage[]> => {
    const list = await api.client.session.messages({ sessionID, limit: 1000 }).catch(() => undefined);
    if (!list?.data?.length) return [];
    return list.data as SessionMessage[];
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
      const currentSession = await api.client.session.get({ sessionID }).catch(() => undefined);
      const info = currentSession?.data;
      if (info?.title === sessiontitle() && info.parentID) {
        const value = { origin: info.parentID, temp: sessionID };
        save(value);
        return value;
      }

      const children = await api.client.session.children({ sessionID }).catch(() => undefined);
      const temp = children?.data
        ?.filter((item) => item.title === sessiontitle())
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
    if (sessionID) return sessionID;

    const next = await api.client.session.create({});
    if (next.error || !next.data?.id)
      throw next.error ?? new Error("Failed to create a new session.");
    return next.data.id;
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

  const readhandoff = async () => {
    try {
      const text = await readFile(handoffFile, "utf8");
      const value = JSON.parse(text);
      if (!value || typeof value !== "object") return;
      if (value.type !== "experimental-btw") return;
      if ("version" in value && value.version !== undefined && typeof value.version !== "number") return;
      if (typeof value.tempSessionID !== "string") return;
      if (value.originSessionID !== null && typeof value.originSessionID !== "string") return;
      if (typeof value.prompt !== "string") return;
      return value as {
        type: "experimental-btw";
        version?: number;
        originSessionID: string | null;
        tempSessionID: string;
        prompt: string;
        time?: string;
      };
    } catch {
      return;
    }
  };

  const clearhandoff = async () => {
    await unlink(handoffFile).catch(() => undefined);
  };

  const fork = async (sessionID: string, cut: Spawn) => {
    const next = await api.client.session.fork({
      sessionID,
      ...(cut.mode === "cut" ? { messageID: cut.messageID } : {}),
    });
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
      toast({
        variant: "warning",
        message: `A ${slash(openname())} session is already active. Run ${slash(endname())} first.`,
      });
      return;
    }

    try {
      const source = await origin();
      const cut = await cutoff(source);
      const temp = await fork(source, cut);
      await label(temp);
      save({ origin: source, temp, baseCount: cut.count });
      api.route.navigate("session", { sessionID: temp });
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

  const pendingExperimental = new Set<string>();
  const adoptExperimental = async (sessionID: string) => {
    logevent("adopt:start", { targetSessionID: sessionID });
    if (pendingExperimental.has(sessionID)) {
      logevent("adopt:skip_pending", { targetSessionID: sessionID });
      return;
    }

    const currentSessionID = current();
    const active = load();
    if (active) {
      const canReplaceActive = currentSessionID !== active.temp;
      if (!canReplaceActive) {
        logevent("adopt:skip_active", {
          targetSessionID: sessionID,
          activeOriginSessionID: active.origin,
          activeTempSessionID: active.temp,
        });
        return;
      }
      logevent("adopt:replace_active", {
        targetSessionID: sessionID,
        activeOriginSessionID: active.origin,
        activeTempSessionID: active.temp,
      });
    }

    const originSessionID = currentSessionID;
    if (!originSessionID || originSessionID === sessionID) {
      logevent("adopt:skip_origin", { targetSessionID: sessionID, originSessionID: originSessionID ?? null });
      return;
    }

    pendingExperimental.add(sessionID);

    try {
      const handoff = await readhandoff();
      logevent("adopt:fetched_handoff", {
        targetSessionID: sessionID,
        handoffSessionID: handoff?.tempSessionID ?? null,
        handoffOriginSessionID: handoff?.originSessionID ?? null,
      });
      if (!handoff || handoff.tempSessionID !== sessionID || handoff.originSessionID !== originSessionID) {
        logevent("adopt:skip_marker", {
          targetSessionID: sessionID,
          handoffSessionID: handoff?.tempSessionID ?? null,
          handoffOriginSessionID: handoff?.originSessionID ?? null,
        });
        return;
      }

      const before = await messages(sessionID);
      const beforeCount = before.length;
      logevent("adopt:fetched_messages", {
        targetSessionID: sessionID,
        count: beforeCount,
      });

      save({ origin: originSessionID, temp: sessionID, baseCount: beforeCount });
      if (currentSessionID !== sessionID) {
        api.route.navigate("session", { sessionID });
        logevent("adopt:navigated", { targetSessionID: sessionID });
      }

      if (handoff.prompt.trim()) {
        const seeded = await api.client.session.prompt({
          sessionID,
          parts: [{ type: "text", text: handoff.prompt }],
        });
        if (seeded?.error) throw seeded.error;

        const after = await messages(sessionID);
        const baseCount = Math.max(after.length, beforeCount + 2);
        save({ origin: originSessionID, temp: sessionID, baseCount });
        logevent("adopt:fetched_messages_after_prompt", {
          targetSessionID: sessionID,
          count: after.length,
          baseCount,
        });
      }

      await clearhandoff();

      logevent("adopt:completed", {
        targetSessionID: sessionID,
        originSessionID,
        promptLength: handoff.prompt.length,
      });
    } catch (err) {
      logevent("adopt:error", { targetSessionID: sessionID, error: msg(err) });
      toast({
        variant: "error",
        message: msg(err),
      });
    } finally {
      pendingExperimental.delete(sessionID);
    }
  };

  const offCreated = api.event.on("session.created", (event) => {
    logevent("event:session.created", {
      targetSessionID: event.properties.sessionID,
      title: event.properties.info.title ?? null,
    });
    void adoptExperimental(event.properties.sessionID);
  });
  const offUpdated = api.event.on("session.updated", (event) => {
    logevent("event:session.updated", {
      targetSessionID: event.properties.sessionID,
      title: event.properties.info.title ?? null,
    });
    void adoptExperimental(event.properties.sessionID);
  });
  const offMessageUpdated = api.event.on("message.updated", (event) => {
    logevent("event:message.updated", {
      targetSessionID: event.properties.sessionID,
      messageID: event.properties.info.id,
      role: event.properties.info.role,
    });
    void adoptExperimental(event.properties.sessionID);
  });
  const offPartUpdated = api.event.on("message.part.updated", (event) => {
    logevent("event:message.part.updated", {
      targetSessionID: event.properties.sessionID,
      partType: event.properties.part.type,
      messageID: event.properties.part.messageID,
    });
    void adoptExperimental(event.properties.sessionID);
  });
  api.lifecycle.onDispose(offCreated);
  api.lifecycle.onDispose(offUpdated);
  api.lifecycle.onDispose(offMessageUpdated);
  api.lifecycle.onDispose(offPartUpdated);

  api.command.register(() => {
    const sessionID = current();
    const state = load();
    const active = Boolean(state);
    const inbtw = Boolean(indicator(sessionID, state));

    return [
      {
        title: "By the way",
        value: "btw.open",
        description: `Open a ${slash(openname())} side session in this terminal`,
        category: "Session",
        slash: {
          name: openname(),
        },
        hidden: active,
        onSelect: () => {
          void enter();
        },
      },
      {
        title: `Merge ${slash(openname())}`,
        value: "btw.merge",
        description: `Append ${slash(openname())} text back to the original session and close it`,
        category: "Session",
        slash: {
          name: mergename(),
        },
        hidden: !inbtw,
        suggested: inbtw,
        onSelect: () => {
          void merge();
        },
      },
      {
        title: `End ${slash(openname())}`,
        value: "btw.end",
        description: `Return to the original session and close ${slash(openname())}`,
        category: "Session",
        slash: {
          name: endname(),
        },
        hidden: !active,
        onSelect: () => {
          void end();
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
