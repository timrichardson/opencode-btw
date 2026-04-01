/** @jsx h */
import h from "solid-js/h";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { copy as clip } from "./clipboard";
import { mid } from "./id";

declare namespace JSX {
  interface IntrinsicElements {
    box: any;
    text: any;
    scrollbox: any;
    code: any;
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
const popupname = () => `${slashbase()}_popup`;
const endname = () => `${slashbase()}_end`;

type Step =
  | "creating"
  | "waiting"
  | "streaming"
  | "done"
  | "error"
  | "canceled";

type Item = {
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
};

type Part = {
  type: string;
  text?: string;
  synthetic?: boolean;
  ignored?: boolean;
};

type Run = {
  ctrl: AbortController;
  off: Array<() => void>;
  done: Promise<void>;
  end: () => void;
  draw?: ReturnType<typeof setTimeout>;
  timer?: ReturnType<typeof setTimeout>;
  root: string;
  fork?: string;
  user?: string;
  aid?: string;
  ask: string;
  step: Step;
  err?: string;
  live: boolean;
  copy?: { message: string; tone: "success" | "error" };
  part: Map<string, Item>;
  wait: Map<string, Map<string, Item>>;
  diag: string[];
};

type Locate = {
  user: boolean;
  assistant: boolean;
};

type Spawn =
  | { mode: "all"; count: number; boundary?: string }
  | { mode: "cut"; count: number; boundary: string; messageID: string };

type Btw = {
  origin: string;
  temp: string;
};

const ui = {
  text: "#f0f0f0",
  muted: "#a5a5a5",
  accent: "#5f87ff",
  panel: "#2a2a2a",
  danger: "#ff7b72",
};

const key = "opencode-bytheway.active";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isbtw = (value: unknown): value is Btw => {
  if (!value || typeof value !== "object") return false;
  if (!("origin" in value) || typeof value.origin !== "string") return false;
  if (!("temp" in value) || typeof value.temp !== "string") return false;
  return true;
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

export const plain = (parts: Part[]) => {
  const text = parts
    .flatMap((part) => {
      if (part.type !== "text") return [];
      if (part.synthetic || part.ignored) return [];
      const text = part.text?.trim();
      if (!text) return [];
      return [text];
    })
    .join("\n\n")
    .trim();
  if (text) return text;
  return `The ${slash(popupname())} run completed without a visible text response.`;
};

export const wrap = (input: string, cols: number) => {
  const width = Math.max(12, cols);

  return input
    .split("\n")
    .flatMap((row) => {
      if (!row.trim()) return [""];

      const pad = row.match(/^\s*/)?.[0] ?? "";
      const lead = row.match(/^\s*([-*] |\d+\. )/)?.[0] ?? pad;
      const rest = row.slice(lead.length);
      const limit = Math.max(8, width - lead.length);

      if (rest.length <= limit) return [row];

      const out: string[] = [];
      let text = rest;
      let first = true;

      while (text.length > limit) {
        let cut = text.lastIndexOf(" ", limit);
        if (cut <= 0) cut = limit;
        const head = text.slice(0, cut).trimEnd();
        out.push((first ? lead : " ".repeat(lead.length)) + head);
        text = text.slice(cut).trimStart();
        first = false;
      }

      out.push((first ? lead : " ".repeat(lead.length)) + text);
      return out;
    })
    .join("\n");
};

const raw = (run: Pick<Run, "part">) => {
  const text = [...run.part.values()]
    .flatMap((part) => {
      if (part.synthetic || part.ignored) return [];
      if (!part.text) return [];
      return [part.text];
    })
    .join("")
    .trim();
  return text;
};

const longest = (input: string) =>
  Math.max(...input.split("\n").map((row) => row.length), 0);

const token = (input: string) =>
  Math.max(
    ...input
      .split(/\s+/)
      .filter(Boolean)
      .map((item) => item.length),
    0,
  );

const blank = (run: Pick<Run, "part" | "step" | "err">) =>
  !raw(run) && run.step === "done" && !run.err;

export const debug = (
  run: Pick<Run, "step" | "fork" | "user" | "aid" | "part" | "wait" | "diag">,
) => {
  const part = [...run.part.entries()].map(([id, part]) => {
    const bits = [`${id}:len=${part.text.length}`];
    if (part.synthetic) bits.push("synthetic");
    if (part.ignored) bits.push("ignored");
    return bits.join(",");
  });
  const wait = [...run.wait.entries()].map(
    ([id, part]) => `${id}:${part.size}`,
  );

  return [
    "Diagnostics",
    `step=${run.step}`,
    `fork=${run.fork ?? "-"}`,
    `user=${run.user ?? "-"}`,
    `assistant=${run.aid ?? "-"}`,
    `part_count=${run.part.size}`,
    `wait_count=${run.wait.size}`,
    `parts=${part.length ? part.join(" | ") : "-"}`,
    `waiting=${wait.length ? wait.join(" | ") : "-"}`,
    ...run.diag.slice(-14),
  ].join("\n");
};

const view = (run: Run) => {
  const text = raw(run);
  if (text) return text;
  if (run.step === "creating") return "Creating temporary fork...";
  if (run.step === "waiting") return "Waiting for the first reply tokens...";
  if (run.step === "streaming") return "Streaming reply...";
  if (run.step === "canceled") return `The ${slash(popupname())} run was canceled.`;
  if (run.err) return run.err;
  return (
    `The ${slash(popupname())} run completed without a visible text response.\n\n` +
    debug(run)
  );
};

const note = (run: Run) => {
  if (run.step === "creating") return "creating fork";
  if (run.step === "waiting") return "waiting for reply";
  if (run.step === "streaming") return "streaming reply";
  if (run.step === "done") return "finished";
  if (run.step === "canceled") return "canceled";
  return "failed";
};

const busy = (run: Run) =>
  run.step === "creating" || run.step === "waiting" || run.step === "streaming";

const Btn = (props: {
  txt: string;
  run: () => void;
  on?: boolean;
  danger?: boolean;
}) => {
  return (
    <box
      onMouseUp={() => props.run()}
      backgroundColor={
        props.danger ? ui.danger : props.on ? ui.accent : ui.panel
      }
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.on || props.danger ? "#111111" : ui.text}>
        {props.txt}
      </text>
    </box>
  );
};

const Body = (props: {
  run: Run;
  close: () => void;
  again: () => void;
  stop: () => void;
  copy: () => void;
}) => {
  const term = useTerminalDimensions();
  const live = busy(props.run);
  const body = Math.max(8, Math.min(18, term().height - 16));
  const outer = Math.max(40, Math.min(116, term().width - 2));
  const cols = Math.max(24, Math.min(52, outer - 32));
  const pane = cols + 2;
  const keys = live
    ? "a abort · c copy · esc close"
    : "c copy · r rerun · esc close";
  const text = view(props.run);
  const stats = wrap(text, cols);
  const info = `diag term=${term().width}x${term().height} outer=${outer} wrap=${cols} body=${body} raw=${text.length} line=${longest(text)} token=${token(text)} rows=${stats.split("\n").length}`;

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault();
      evt.stopPropagation();
      props.close();
      return;
    }
    if (live && evt.name === "a") {
      evt.preventDefault();
      evt.stopPropagation();
      props.stop();
      return;
    }
    if (evt.name === "c") {
      evt.preventDefault();
      evt.stopPropagation();
      props.copy();
      return;
    }
    if (!live && evt.name === "r") {
      evt.preventDefault();
      evt.stopPropagation();
      props.again();
    }
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
    >
      <box flexDirection="column" flexShrink={0} paddingBottom={1}>
        <text fg={ui.text} attributes={TextAttributes.BOLD}>
          {slash(popupname())}
        </text>
        <text fg={props.run.step === "error" ? ui.danger : ui.muted}>
          {note(props.run)}
        </text>
      </box>
      <box flexDirection="row" gap={1} flexShrink={0} paddingBottom={1}>
        <Btn txt="copy" run={props.copy} />
        {live ? (
          <Btn txt="abort" run={props.stop} danger />
        ) : (
          <Btn txt="again" run={props.again} on />
        )}
        <Btn txt="close" run={props.close} />
      </box>
      {props.run.copy ? (
        <text
          fg={props.run.copy.tone === "error" ? ui.danger : ui.accent}
          paddingBottom={1}
        >
          {props.run.copy.message}
        </text>
      ) : null}
      <box
        flexDirection="column"
        gap={1}
        flexShrink={0}
        paddingBottom={1}
        width={pane}
      >
        <text fg={ui.muted}>prompt</text>
        <box width={cols} paddingRight={2}>
          <text fg={ui.text} wrapMode="word" width={cols - 2}>
            {wrap(props.run.ask, cols - 2)}
          </text>
        </box>
      </box>
      <box flexDirection="column" gap={1} width={pane}>
        <text fg={ui.muted}>response</text>
        <scrollbox height={body} width={cols} paddingRight={2}>
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={true}
            content={text}
            fg={props.run.step === "error" ? ui.danger : ui.text}
          />
        </scrollbox>
      </box>
      <text fg={ui.muted} flexShrink={0} paddingTop={1}>
        {keys}
      </text>
      <text fg={ui.muted} flexShrink={0}>
        {info}
      </text>
    </box>
  );
};

const tui: TuiPlugin = async (api) => {
  let run: Run | undefined;
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
    return route.params?.sessionID;
  };

  const render = (item: Run) => {
    if (run !== item) return;
    api.ui.dialog.setSize("xlarge");
    api.ui.dialog.replace(() => (
      <Body
        run={item}
        close={() => close(item)}
        again={() => again(item)}
        stop={() => stop(item, true)}
        copy={() => copy(item)}
      />
    ));
  };

  const draw = (item: Run, force = false) => {
    if (run !== item) return;
    if (!force && busy(item)) {
      if (item.draw) return;
      item.draw = setTimeout(() => {
        item.draw = undefined;
        render(item);
      }, 48);
      return;
    }
    if (item.draw) {
      clearTimeout(item.draw);
      item.draw = undefined;
    }
    render(item);
  };

  const flash = (item: Run, message: string, tone: "success" | "error") => {
    item.copy = { message, tone };
    if (item.timer) clearTimeout(item.timer);
    draw(item, true);
    item.timer = setTimeout(() => {
      if (run !== item) return;
      item.copy = undefined;
      draw(item, true);
    }, 1600);
  };

  const copy = (item: Run) => {
    const text = blank(item) ? `${view(item)}\n` : view(item);
    void clip(text)
      .then(() => {
        flash(item, "Message copied to clipboard!", "success");
        api.ui.toast({
          variant: "success",
          message: "Message copied to clipboard!",
        });
      })
      .catch(() => {
        flash(item, "Failed to copy to clipboard", "error");
        api.ui.toast({
          variant: "error",
          message: "Failed to copy to clipboard",
        });
      });
  };

  const clear = async (item: Run) => {
    trace(item, "clear");
    if (item.draw) clearTimeout(item.draw);
    if (item.timer) clearTimeout(item.timer);
    for (const off of item.off.splice(0)) off();
    if (!item.fork) return;
    await api.client.session
      .delete({ sessionID: item.fork })
      .catch(() => undefined);
  };

  const reset = (item: Run) => {
    for (const off of item.off.splice(0)) off();
    if (item.draw) clearTimeout(item.draw);
    item.user = undefined;
    item.aid = undefined;
    item.part = new Map();
    item.wait = new Map();
    item.err = undefined;
    item.copy = undefined;
    item.step = "creating";
  };

  const cutoff = async (sessionID: string): Promise<Spawn> => {
    const list = await api.client.session
      .messages({ sessionID, limit: 1000 })
      .catch(() => undefined);
    if (!list?.data?.length) return { mode: "all", count: 0 };

    let last = -1;
    for (let i = list.data.length - 1; i >= 0; i--) {
      const msg = list.data[i].info;
      if (msg.role !== "assistant") continue;
      if (!msg.time.completed) continue;
      if (!msg.finish || ["tool-calls", "unknown"].includes(msg.finish))
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

  const trace = (item: Run, input: string) => {
    item.diag.push(input);
    if (item.diag.length > 30) item.diag.shift();
  };

  const locate = async (item: Run): Promise<Locate> => {
    if (!item.fork) return { user: false, assistant: false };

    let user = false;
    if (!item.aid) {
      const list = await api.client.session
        .messages({ sessionID: item.fork, limit: 100 })
        .catch(() => undefined);
      user = list?.data?.some((msg) => msg.info.id === item.user) ?? false;
      trace(
        item,
        `locate.messages count=${list?.data?.length ?? 0} user_present=${user} assistants=${
          list?.data
            ?.filter((msg) => msg.info.role === "assistant")
            .slice(-5)
            .map((msg) => `${msg.info.id}<-${msg.info.parentID ?? "-"}`)
            .join(",") ?? "-"
        }`,
      );
      const match = list?.data?.find(
        (msg) =>
          msg.info.role === "assistant" && msg.info.parentID === item.user,
      );
      if (match) item.aid = match.info.id;
      trace(item, `locate.match=${item.aid ?? "-"}`);
      if (match?.parts) {
        item.part = new Map(
          match.parts.flatMap((part) => {
            if (part.type !== "text") return [];
            return [
              [
                part.id,
                {
                  text: part.text,
                  synthetic: part.synthetic,
                  ignored: part.ignored,
                },
              ] as const,
            ];
          }),
        );
        trace(
          item,
          `locate.parts from=messages count=${item.part.size} visible_len=${raw(item).length}`,
        );
      }
    }
    if (!item.aid || item.part.size)
      return { user, assistant: Boolean(item.aid) };
    const reply = await api.client.session
      .message({ sessionID: item.fork, messageID: item.aid })
      .catch(() => undefined);
    if (!reply?.data?.parts) return { user, assistant: Boolean(item.aid) };
    item.part = new Map(
      reply.data.parts.flatMap((part) => {
        if (part.type !== "text") return [];
        return [
          [
            part.id,
            {
              text: part.text,
              synthetic: part.synthetic,
              ignored: part.ignored,
            },
          ] as const,
        ];
      }),
    );
    trace(
      item,
      `locate.parts from=message count=${item.part.size} visible_len=${raw(item).length}`,
    );
    return { user, assistant: Boolean(item.aid) };
  };

  const push = (item: Run, messageID: string, partID: string, next: Item) => {
    if (item.aid) {
      if (messageID !== item.aid) return;
      item.part.set(partID, next);
      trace(item, `part ${messageID}/${partID} len=${next.text.length}`);
      if (item.step === "creating" || item.step === "waiting")
        item.step = "streaming";
      draw(item);
      return;
    }

    const list = item.wait.get(messageID) ?? new Map<string, Item>();
    list.set(partID, next);
    item.wait.set(messageID, list);
    trace(item, `buffer ${messageID}/${partID} len=${next.text.length}`);
  };

  const flush = (item: Run) => {
    if (!item.aid) return;
    const list = item.wait.get(item.aid);
    if (!list) return;
    item.part = new Map(list);
    item.wait.delete(item.aid);
    trace(
      item,
      `flush aid=${item.aid} count=${item.part.size} visible_len=${raw(item).length}`,
    );
    if (item.step === "creating" || item.step === "waiting")
      item.step = "streaming";
    draw(item);
  };

  const finish = async (item: Run, err?: unknown) => {
    if (!item.live) return;

    if (err) {
      item.live = false;
      item.step = item.ctrl.signal.aborted ? "canceled" : "error";
      item.err = item.ctrl.signal.aborted ? undefined : msg(err);
      trace(item, `finish err=${item.err ?? "canceled"}`);
      draw(item, true);
      item.end();
      return;
    }

    let state: Locate = { user: false, assistant: Boolean(item.aid) };
    for (const wait of [0, 20, 60, 120, 240]) {
      if (wait) await sleep(wait);
      state = await locate(item);
      trace(
        item,
        `finish locate user=${state.user} assistant=${state.assistant} visible_len=${raw(item).length}`,
      );
      if (state.assistant) break;
    }

    item.live = false;
    item.step = "done";
    if (!state.user) trace(item, "finish missing user message");
    if (!state.assistant) trace(item, "finish missing assistant message");
    if (!raw(item)) trace(item, "finish missing visible text");
    trace(
      item,
      `finish ok visible_len=${raw(item).length} parts=${item.part.size} wait=${item.wait.size}`,
    );
    draw(item, true);
    item.end();
  };

  const stop = (item: Run, keep: boolean) => {
    if (!busy(item)) return;
    trace(item, `stop keep=${keep}`);
    item.ctrl.abort();
    if (item.fork) {
      void api.client.session
        .abort({ sessionID: item.fork })
        .catch(() => undefined);
    }
    void finish(item, new Error("Canceled"));
    if (!keep) {
      item.live = false;
    }
  };

  const close = (item: Run) => {
    if (busy(item)) stop(item, false);
    if (run === item) run = undefined;
    api.ui.dialog.clear();
  };

  const again = (item: Run) => {
    if (run === item) run = undefined;
    show(item.ask);
  };

  const wire = (item: Run) => {
    item.off.push(
      api.event.on("message.updated", (evt) => {
        if (evt.properties.sessionID !== item.fork) return;
        if (evt.properties.info.role !== "assistant") return;
        if (evt.properties.info.parentID !== item.user) return;
        item.aid = evt.properties.info.id;
        trace(
          item,
          `message.updated aid=${item.aid} completed=${Boolean(evt.properties.info.time?.completed)}`,
        );
        flush(item);
        if (evt.properties.info.time?.completed) {
          void finish(item);
        }
      }),
    );
    item.off.push(
      api.event.on("message.part.updated", (evt) => {
        if (evt.properties.sessionID !== item.fork) return;
        const part = evt.properties.part;
        if (part.type !== "text") return;
        if (part.messageID === item.user) return;
        trace(
          item,
          `message.part.updated msg=${part.messageID} part=${part.id} len=${part.text.length}`,
        );
        push(item, part.messageID, part.id, {
          text: part.text,
          synthetic: part.synthetic,
          ignored: part.ignored,
        });
      }),
    );
    item.off.push(
      api.event.on("message.part.delta", (evt) => {
        if (evt.properties.sessionID !== item.fork) return;
        if (evt.properties.field !== "text") return;
        if (evt.properties.messageID === item.user) return;
        trace(
          item,
          `message.part.delta msg=${evt.properties.messageID} part=${evt.properties.partID} delta=${evt.properties.delta.length}`,
        );
        const list = item.aid
          ? item.part
          : (item.wait.get(evt.properties.messageID) ??
            new Map<string, Item>());
        const part = list.get(evt.properties.partID) ?? { text: "" };
        part.text += evt.properties.delta;
        push(item, evt.properties.messageID, evt.properties.partID, part);
      }),
    );
    item.off.push(
      api.event.on("session.status", (evt) => {
        if (evt.properties.sessionID !== item.fork) return;
        trace(item, `session.status ${evt.properties.status.type}`);
        if (evt.properties.status.type === "idle") {
          void finish(item);
          return;
        }
        if (evt.properties.status.type === "busy" && item.step === "creating") {
          item.step = "waiting";
          draw(item);
          return;
        }
        if (evt.properties.status.type === "retry") {
          item.step = item.part.size ? "streaming" : "waiting";
          draw(item);
        }
      }),
    );
    item.off.push(
      api.event.on("session.idle", (evt) => {
        if (evt.properties.sessionID !== item.fork) return;
        trace(item, "session.idle");
        void finish(item);
      }),
    );
    item.off.push(
      api.event.on("session.error", (evt) => {
        if (evt.properties.sessionID !== item.fork) return;
        trace(
          item,
          `session.error ${msg(evt.properties.error ?? new Error(`Failed to run ${slash(popupname())}.`))}`,
        );
        void finish(
          item,
          evt.properties.error ?? new Error(`Failed to run ${slash(popupname())}.`),
        );
      }),
    );
  };

  const launch = async (item: Run) => {
    const cut = await cutoff(item.root);
    trace(
      item,
      `spawn mode=${cut.mode} count=${cut.count} boundary=${"boundary" in cut ? cut.boundary : "-"}`,
    );
    const next = await api.client.session.fork({
      sessionID: item.root,
      ...(cut.mode === "cut" ? { messageID: cut.messageID } : {}),
    });
    if (next.error || !next.data?.id)
      throw next.error ?? new Error("Failed to create temporary session.");
    const forkID = next.data.id;
    if (run !== item || item.ctrl.signal.aborted) {
      await api.client.session.delete({ sessionID: forkID }).catch(() => undefined);
      return;
    }
    item.fork = forkID;
    trace(item, `fork ${item.fork}`);
    item.step = "waiting";
    wire(item);
    draw(item);

    item.user = mid();
    trace(item, `prompt_async start user=${item.user}`);
    const reply = await api.client.session.promptAsync({
      sessionID: item.fork,
      messageID: item.user,
      parts: [{ type: "text", text: item.ask }],
    });
    if (reply.error) throw reply.error;
    trace(item, `prompt_async ok user=${item.user}`);
  };

  const start = (sessionID: string, ask: string) => {
    if (run && busy(run)) {
      stop(run, false);
    }

    let end: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      end = resolve;
    });
    const item: Run = {
      ctrl: new AbortController(),
      off: [],
      done,
      end,
      root: sessionID,
      ask,
      step: "creating",
      live: true,
      copy: undefined,
      part: new Map(),
      wait: new Map(),
      diag: [],
    };
    run = item;
    trace(item, `start ask_len=${ask.length}`);
    draw(item);
    void (async () => {
      try {
        await launch(item);

        await item.done;
      } catch (err) {
        await finish(item, err);
      } finally {
        await clear(item);
      }
    })();
  };

  const show = (prev = "") => {
    const sessionID = current();
    const DialogPrompt = api.ui.DialogPrompt;
    api.ui.dialog.setSize("large");
    api.ui.dialog.replace(() =>
      DialogPrompt({
        title: "By the way (Popup)",
        value: prev,
        placeholder: "Ask a one-off question",
        onConfirm: (raw) => {
          const ask = raw.trim();
          if (!ask) {
            api.ui.toast({
              variant: "warning",
              message: `Enter a prompt for ${slash(popupname())}.`,
            });
            return;
          }
          if (typeof sessionID !== "string") {
            api.ui.toast({
              variant: "warning",
              message: `${slash(popupname())} is only available inside a session.`,
            });
            return;
          }
          start(sessionID, ask);
        },
        onCancel: () => {
          api.ui.dialog.clear();
        },
      }),
    );
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

  const enter = async () => {
    if (run && busy(run)) {
      api.ui.toast({
        variant: "warning",
        message: `${slash(openname())} is unavailable while ${slash(popupname())} is running.`,
      });
      return;
    }

    const sessionID = current();
    const state = load();
    if (typeof sessionID !== "string") {
      api.ui.toast({
        variant: "warning",
        message: `${slash(openname())} is only available inside a session.`,
      });
      return;
    }
    if (state?.temp === sessionID) {
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
      const temp = await fork(sessionID);
      save({ origin: sessionID, temp });
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

  api.lifecycle.onDispose(() => {
    if (!run || !busy(run)) return;
    stop(run, false);
  });

  api.command.register(() => {
    const sessionID = current();
    const state = load();
    const active = Boolean(state);
    const inbtw = Boolean(state && state.temp === sessionID);

    return [
      {
        title: "By the way",
        value: "btw.open",
        description: `Open a ${slash(openname())} side session in this terminal`,
        category: "Session",
        slash: {
          name: openname(),
        },
        hidden: typeof sessionID !== "string" || active,
        onSelect: () => {
          void enter();
        },
      },
      {
        title: "By the way (Popup)",
        value: "btw.popup",
        description: "Ask a one-off popup question in a temporary fork",
        category: "Session",
        slash: {
          name: popupname(),
        },
        hidden: typeof sessionID !== "string",
        enabled: !inbtw,
        onSelect: () => {
          if (inbtw) {
            api.ui.toast({
              variant: "warning",
              message: `${slash(popupname())} is disabled inside a ${slash(openname())} session. Run ${slash(endname())} first.`,
            });
            return;
          }
          show(run?.ask ?? "");
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
        hidden: typeof sessionID !== "string" || !active,
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
