import { TextAttributes } from "@opentui/core";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
  }
}

const id = "opencode-bytheway";

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

type Spawn =
  | { mode: "all"; count: number; boundary?: string }
  | { mode: "cut"; count: number; boundary: string; messageID: string };

type Btw = {
  origin: string;
  temp: string;
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

  const origin = async () => {
    const sessionID = current();
    if (sessionID) return sessionID;

    const next = await api.client.session.create({});
    if (next.error || !next.data?.id)
      throw next.error ?? new Error("Failed to create a new session.");
    return next.data.id;
  };

  const cutoff = async (sessionID: string): Promise<Spawn> => {
    const list = await api.client.session
      .messages({ sessionID, limit: 1000 })
      .catch(() => undefined);
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

  const fork = async (sessionID: string) => {
    const cut = await cutoff(sessionID);
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
    const state = load();
    if (state && state.temp === sessionID) {
      api.ui.toast({
        variant: "warning",
        message: `Already inside a ${slash(openname())} session. Run ${slash(endname())} to return.`,
      });
      return;
    }
    if (state) {
      api.ui.toast({
        variant: "warning",
        message: `A ${slash(openname())} session is already active. Run ${slash(endname())} first.`,
      });
      return;
    }

    try {
      const source = await origin();
      const temp = await fork(source);
      await label(temp);
      save({ origin: source, temp });
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
      api.ui.toast({
        variant: "error",
        message: msg(err),
      });
    }
  };

  const end = async () => {
    const state = load();
    if (!state) {
      api.ui.toast({
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
      api.ui.toast({
        variant: "error",
        message: `Returned from ${slash(openname())}, but failed to delete the temp session.`,
      });
      return;
    }
    save(undefined);
    api.ui.toast({
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
        title: `End ${slash(openname())}`,
        value: "btw.end",
        description: `Return to the original session and close ${slash(openname())}`,
        category: "Session",
        slash: {
          name: endname(),
        },
        hidden: !active,
        suggested: inbtw,
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
