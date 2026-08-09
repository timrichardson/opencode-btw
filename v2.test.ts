import { describe, expect, test } from "bun:test";
import { createV2, internals } from "./v2";

type Message = ReturnType<typeof user> | ReturnType<typeof assistant> | ReturnType<typeof synthetic>;

function user(id: string, text: string, created = 1) {
  return { id, type: "user" as const, text, time: { created } };
}

function assistant(id: string, text: string, created = 2) {
  return {
    id,
    type: "assistant" as const,
    agent: "build",
    model: { providerID: "test", id: "model" },
    content: [{ type: "text" as const, text }],
    finish: "stop" as const,
    time: { created, completed: created + 1 },
  };
}

function synthetic(id: string, text: string, created = 1) {
  return { id, type: "synthetic" as const, text, time: { created } };
}

function session(id: string, updated = 1) {
  return {
    id,
    projectID: "global",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated },
    location: { directory: "/project" },
    agent: "build",
    model: { providerID: "test", id: "model" },
  };
}

function setup(input?: {
  route?: string;
  active?: Record<string, unknown> | null;
  messages?: Record<string, Message[]>;
  sessions?: Record<string, ReturnType<typeof session>>;
  getErrors?: Record<string, unknown>;
  removeError?: Error;
}) {
  let route = input?.route ? { type: "session", sessionID: input.route } : { type: "home" };
  const state = { active: input?.active ?? null };
  const sessions = new Map(Object.entries(input?.sessions ?? { ses_origin: session("ses_origin") }));
  const messages = new Map(Object.entries(input?.messages ?? {}).map(([id, value]) => [id, [...value]]));
  const calls: Array<{ name: string; input?: Record<string, unknown> }> = [];
  const toasts: Array<Record<string, unknown>> = [];
  const layers: Array<() => Record<string, unknown>> = [];
  let created = 0;
  let admitted = 0;

  const context = {
    location: { directory: "/project" },
    data: {
      location: { default: () => ({ directory: "/project" }) },
    },
    storage: {
      store() {
        return [
          state,
          async (update: (draft: typeof state) => void) => {
            update(state);
          },
        ];
      },
    },
    keymap: {
      layer(value: () => Record<string, unknown>) {
        layers.push(value);
      },
    },
    ui: {
      router: {
        current: () => route,
        navigate(next: typeof route) {
          route = next;
          calls.push({ name: "navigate", input: next });
        },
      },
      toast: { show: (value: Record<string, unknown>) => toasts.push(value) },
      dialog: { confirm: async () => true },
      slot(_name: string, render: () => unknown) {
        render();
        return () => {};
      },
    },
    client: {
      session: {
        async get({ sessionID }: { sessionID: string }) {
          if (sessionID in (input?.getErrors ?? {})) throw input?.getErrors?.[sessionID];
          const value = sessions.get(sessionID);
          if (!value) throw { _tag: "SessionNotFoundError", sessionID, message: "Session not found" };
          return value;
        },
        async create(value?: Record<string, unknown>) {
          const id = `ses_created_${++created}`;
          const result = session(id);
          sessions.set(id, result);
          messages.set(id, []);
          calls.push({ name: "create", input: value });
          return result;
        },
        async fork(value: { sessionID: string; boundary: { type: "through" } | { type: "before"; messageID: string } }) {
          const id = `ses_created_${++created}`;
          const result = session(id);
          sessions.set(id, result);
          const source = messages.get(value.sessionID) ?? [];
          const copied =
            value.boundary.type === "before"
              ? source.slice(0, source.findIndex((item) => item.id === value.boundary.messageID))
              : source;
          messages.set(
            id,
            copied.map((item, index) => ({ ...item, id: `msg_cloned_${index}` })),
          );
          calls.push({ name: "fork", input: value });
          return result;
        },
        async rename(value: Record<string, unknown>) {
          calls.push({ name: "rename", input: value });
        },
        async remove(value: Record<string, unknown>) {
          calls.push({ name: "remove", input: value });
          if (input?.removeError) throw input.removeError;
          sessions.delete(String(value.sessionID));
        },
        async prompt(value: Record<string, unknown>) {
          calls.push({ name: "prompt", input: value });
          return {
            id: value.id ?? `msg_admitted_${++admitted}`,
            sessionID: value.sessionID,
            type: "user",
            timeCreated: Date.now(),
            data: { text: value.text },
            delivery: "steer",
          };
        },
        async synthetic(value: Record<string, unknown>) {
          calls.push({ name: "synthetic", input: value });
          return {
            id: `msg_synthetic_${++admitted}`,
            sessionID: value.sessionID,
            type: "synthetic",
            timeCreated: Date.now(),
            data: { text: value.text },
            delivery: "steer",
          };
        },
        pending: { list: async () => [] },
      },
      message: {
        async list(value: { sessionID: string; limit?: number; order?: "asc" | "desc"; cursor?: string }) {
          calls.push({ name: "messages", input: value });
          const all = [...(messages.get(value.sessionID) ?? [])];
          const ordered = value.order === "desc" ? all.toReversed() : all;
          const start = value.cursor ? Number(value.cursor) : 0;
          const limit = value.limit ?? 50;
          return {
            data: ordered.slice(start, start + limit),
            cursor: { next: start + limit < ordered.length ? String(start + limit) : undefined },
          };
        },
      },
    },
  };

  return {
    calls,
    context: context as unknown as Parameters<typeof createV2>[0],
    layers,
    messages,
    plugin: createV2(context as unknown as Parameters<typeof createV2>[0]),
    route: () => route,
    sessions,
    state,
    toasts,
  };
}

describe("opencode-bytheway V2 plugin", () => {
  test("opens an independent temp session when the origin is empty", async () => {
    const value = setup({ route: "ses_origin", messages: { ses_origin: [] } });

    await value.plugin.open();

    expect(value.calls.some((call) => call.name === "fork")).toBe(false);
    expect(value.state.active).toMatchObject({ origin: "ses_origin", temp: "ses_created_1", kind: "empty" });
    expect(value.route()).toEqual({ type: "session", sessionID: "ses_created_1" });
  });

  test("forks through a populated origin and stores the reminted baseline", async () => {
    const value = setup({
      route: "ses_origin",
      messages: { ses_origin: [user("msg_origin", "question"), assistant("msg_answer", "answer")] },
    });

    await value.plugin.open();

    expect(value.calls.find((call) => call.name === "fork")?.input).toMatchObject({
      sessionID: "ses_origin",
      boundary: { type: "through" },
    });
    expect(value.state.active).toMatchObject({
      kind: "fork",
      baselineMessageID: "msg_cloned_1",
    });
  });

  test("admits direct slash arguments and stores their durable input boundary", async () => {
    const value = setup({
      route: "ses_origin",
      messages: { ses_origin: [user("msg_origin", "question"), assistant("msg_answer", "answer")] },
    });

    await value.plugin.open("side question");

    expect(value.calls.findLast((call) => call.name === "prompt")?.input).toMatchObject({
      sessionID: "ses_created_1",
      text: "side question",
      metadata: { "opencode-bytheway": { type: "initial", origin: "ses_origin", version: 2 } },
    });
    expect(value.state.active).toMatchObject({ initialPromptID: "msg_admitted_1" });
  });

  test("fast mode seeds bounded synthetic context without resuming", async () => {
    const history = Array.from({ length: 15 }, (_, index) =>
      index % 2 === 0
        ? user(`msg_${index}`, `user ${index}`, index)
        : assistant(`msg_${index}`, `assistant ${index}`, index),
    );
    const value = setup({ route: "ses_origin", messages: { ses_origin: history } });

    await value.plugin.openFast();

    const seeded = value.calls.find((call) => call.name === "synthetic")?.input;
    expect(seeded).toMatchObject({ sessionID: "ses_created_1", resume: false });
    expect(String(seeded?.text)).not.toContain("user 0");
    expect(String(seeded?.text)).toContain("assistant 13");
    expect(value.state.active).toMatchObject({ kind: "fast" });
  });

  test("merge paginates, stops at the baseline, and excludes non-text records", async () => {
    const copied = Array.from({ length: 205 }, (_, index) => synthetic(`msg_copy_${index}`, `copy ${index}`, index));
    const tempMessages = [
      ...copied,
      user("msg_baseline", "copied origin", 206),
      user("msg_side_user", "side question", 207),
      assistant("msg_side_assistant", "side answer", 208),
      synthetic("msg_hidden", "hidden", 209),
    ];
    const value = setup({
      route: "ses_temp",
      active: {
        version: 2,
        origin: "ses_origin",
        temp: "ses_temp",
        originUpdated: 1,
        kind: "fork",
        baselineMessageID: "msg_baseline",
      },
      sessions: { ses_origin: session("ses_origin"), ses_temp: session("ses_temp") },
      messages: { ses_temp: tempMessages },
    });

    await value.plugin.merge();

    const merged = value.calls.find((call) => call.name === "prompt")?.input;
    expect(merged).toMatchObject({ sessionID: "ses_origin", resume: false });
    expect(merged?.id).toMatch(/^msg_/);
    expect(String(merged?.text)).toContain("side question");
    expect(String(merged?.text)).toContain("side answer");
    expect(String(merged?.text)).not.toContain("copied origin");
    expect(String(merged?.text)).not.toContain("hidden");
    expect(value.calls.filter((call) => call.name === "messages").length).toBe(1);
    expect(value.state.active).toBeNull();
  });

  test("recovers an initial prompt boundary from projected metadata", async () => {
    const value = setup({
      route: "ses_temp",
      active: {
        version: 2,
        origin: "ses_origin",
        temp: "ses_temp",
        originUpdated: 1,
        kind: "empty",
      },
      sessions: { ses_origin: session("ses_origin"), ses_temp: session("ses_temp") },
      messages: {
        ses_temp: [
          { ...user("msg_initial", "initial question"), metadata: { "opencode-bytheway": { type: "initial" } } },
          assistant("msg_initial_answer", "initial answer"),
          user("msg_followup", "follow-up question"),
          assistant("msg_followup_answer", "follow-up answer"),
        ],
      },
    });

    await value.plugin.merge();

    const merged = String(value.calls.find((call) => call.name === "prompt")?.input?.text);
    expect(merged).toContain("follow-up question");
    expect(merged).toContain("follow-up answer");
    expect(merged).not.toContain("initial question");
    expect(merged).not.toContain("initial answer");
  });

  test("reuses the stable merge admission ID when cleanup is retried", async () => {
    const value = setup({
      route: "ses_temp",
      active: {
        version: 2,
        origin: "ses_origin",
        temp: "ses_temp",
        originUpdated: 1,
        kind: "empty",
        mergeMessageID: "msg_stable_merge",
      },
      sessions: { ses_origin: session("ses_origin"), ses_temp: session("ses_temp") },
      messages: {
        ses_temp: [user("msg_side", "side question")],
      },
    });

    await value.plugin.merge();

    expect(value.calls.find((call) => call.name === "prompt")?.input?.id).toBe("msg_stable_merge");
    expect(value.calls.some((call) => call.name === "remove")).toBe(true);
    expect(value.state.active).toBeNull();
  });

  test("a missing merge baseline fails closed and preserves the temp session", async () => {
    const value = setup({
      route: "ses_temp",
      active: {
        version: 2,
        origin: "ses_origin",
        temp: "ses_temp",
        originUpdated: 1,
        kind: "fork",
        baselineMessageID: "msg_missing",
      },
      sessions: { ses_origin: session("ses_origin"), ses_temp: session("ses_temp") },
      messages: { ses_temp: [user("msg_side", "do not merge")] },
    });

    await value.plugin.merge();

    expect(value.calls.some((call) => call.name === "prompt")).toBe(false);
    expect(value.calls.some((call) => call.name === "remove")).toBe(false);
    expect(value.state.active).not.toBeNull();
    expect(value.toasts.at(-1)?.message).toContain("merge boundary");
  });

  test("delete failure keeps durable state so end can be retried", async () => {
    const value = setup({
      route: "ses_temp",
      active: {
        version: 2,
        origin: "ses_origin",
        temp: "ses_temp",
        originUpdated: 1,
        kind: "fast",
      },
      sessions: { ses_origin: session("ses_origin"), ses_temp: session("ses_temp") },
      removeError: new Error("still busy"),
    });

    await value.plugin.end();

    expect(value.state.active).not.toBeNull();
    expect(value.route()).toEqual({ type: "session", sessionID: "ses_temp" });
    expect(value.toasts.at(-1)?.message).toBe("still busy");
  });

  test("preserves active state when session validation fails transiently", async () => {
    const value = setup({
      route: "ses_origin",
      active: {
        version: 2,
        origin: "ses_origin",
        temp: "ses_temp",
        originUpdated: 1,
        kind: "empty",
      },
      sessions: { ses_origin: session("ses_origin"), ses_temp: session("ses_temp") },
      getErrors: { ses_temp: new Error("network unavailable") },
    });

    await value.plugin.open();

    expect(value.state.active).not.toBeNull();
    expect(value.calls.some((call) => call.name === "create")).toBe(false);
    expect(value.toasts.at(-1)?.message).toBe("network unavailable");
  });

  test("removes a surviving temp before clearing a missing origin", async () => {
    const value = setup({
      route: "ses_current",
      active: {
        version: 2,
        origin: "ses_missing",
        temp: "ses_temp",
        originUpdated: 1,
        kind: "empty",
      },
      sessions: { ses_current: session("ses_current"), ses_temp: session("ses_temp") },
    });

    await value.plugin.open();

    expect(value.calls.find((call) => call.name === "remove")?.input).toEqual({ sessionID: "ses_temp" });
    expect(value.state.active).toMatchObject({ origin: "ses_current", temp: "ses_created_1" });
  });

  test("registers native argument-bearing V2 slash commands", () => {
    const value = setup();
    value.plugin.mount();
    const layer = value.layers[0]?.();
    const commands = layer?.commands as Array<Record<string, unknown>>;

    expect(commands.map((command) => command.id)).toEqual([
      "btw.open",
      "btw.fast",
      "btw.merge",
      "btw.end",
      "btw.status",
      "btw.prompt",
    ]);
    expect(commands[0]?.slash).toEqual({ name: "btw", arguments: true });
    expect(commands[5]?.slash).toEqual({ name: "btw-prompt", arguments: true });
  });

  test("extracts only user and assistant text", () => {
    expect(internals.text(user("msg_user", "hello"))).toBe("hello");
    expect(internals.text(assistant("msg_assistant", "world"))).toBe("world");
    expect(internals.text(synthetic("msg_hidden", "hidden"))).toBeUndefined();
  });
});
