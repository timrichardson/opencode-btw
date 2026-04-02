import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import serverPlugin from "./index.js"
import plugin, { debug, indicator, plain, sessiontitle, wrap } from "./tui"

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const env = () =>
  (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env ?? {}

function cmd(rows: any[], value: string) {
  return rows.find((row) => row.value === value)
}

function setup(input?: {
  session?: boolean
  createError?: Error
  createIDs?: string[]
  updateError?: Error
  promptError?: Error
  forkError?: Error
  forkDelays?: number[]
  forkIDs?: string[]
  messagesDelay?: number
  sourceTail?: boolean
  sourceBlank?: boolean
  deleteError?: Error
  deleteReject?: Error
}) {
  const calls: string[] = []
  const looked: string[] = []
  const toasts: Array<Record<string, unknown>> = []
  const views: any[] = []
  const nav: any[] = []
  const reg: Array<() => any[]> = []
  const slots: any[] = []
  const handlers = new Map<string, Array<(evt: any) => void>>()
  const dispose: Array<() => void | Promise<void>> = []
  const kv = new Map<string, unknown>()
  let creates = 0
  let forks = 0
  let messages = 0
  let created: Record<string, unknown> | undefined
  let updated: Record<string, unknown> | undefined
  let fork: Record<string, unknown> | undefined
  let sent: Record<string, unknown> | undefined
  let route: any = input?.session === false ? { name: "home" } : { name: "session", params: { sessionID: "ses_main" } }
  let done = () => {}
  const wait = new Promise<void>((resolve) => {
    done = resolve
  })

  const api: any = {
    command: {
      register(cb: () => any[]) {
        reg.push(cb)
        return () => {}
      },
      trigger() {},
    },
    route: {
      get current() {
        return route
      },
      navigate(name: string, params?: Record<string, unknown>) {
        nav.push({ name, params })
        if (name === "home") route = { name: "home" }
        if (name === "session") route = { name: "session", params }
      },
      register() {
        return () => {}
      },
    },
    slots: {
      register(input: unknown) {
        slots.push(input)
        return `slot:${slots.length}`
      },
    },
    kv: {
      ready: true,
      get(key: string, fallback?: unknown) {
        return kv.has(key) ? kv.get(key) : fallback
      },
      set(key: string, value: unknown) {
        if (value === null || value === undefined) {
          kv.delete(key)
          return
        }
        kv.set(key, value)
      },
    },
    ui: {
      DialogPrompt: (props: Record<string, unknown>) => ({ type: "prompt", props }),
      Dialog: (props: Record<string, unknown>) => ({ type: "dialog", props }),
      DialogAlert: (props: Record<string, unknown>) => ({ type: "alert", props }),
      dialog: {
        replace(render: () => unknown) {
          try {
            views.push(render())
          } catch (error) {
            if (error instanceof Error && error.message === "No renderer found") {
              views.push({ type: "renderable" })
              return
            }
            throw error
          }
        },
        clear() {},
        setSize() {},
      },
      toast(input: Record<string, unknown>) {
        toasts.push(input)
      },
    },
    event: {
      on(type: string, handler: (evt: any) => void) {
        const list = handlers.get(type) ?? []
        list.push(handler)
        handlers.set(type, list)
        return () => {
          const next = (handlers.get(type) ?? []).filter((item) => item !== handler)
          handlers.set(type, next)
        }
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose(fn: () => void | Promise<void>) {
        dispose.push(fn)
        return () => {}
      },
    },
    client: {
      session: {
        async create(args: Record<string, unknown>) {
          calls.push("create")
          created = args
          const id = input?.createIDs?.[creates] ?? "ses_main"
          creates += 1
          if (input?.createError) return { error: input.createError }
          return { data: { id } }
        },
        async fork(args: Record<string, unknown>) {
          calls.push("fork")
          fork = args
          const delay = input?.forkDelays?.[forks] ?? 0
          const id = input?.forkIDs?.[forks] ?? "ses_btw"
          forks += 1
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
          if (input?.forkError) return { error: input.forkError }
          return { data: { id } }
        },
        async update(args: Record<string, unknown>) {
          calls.push("update")
          updated = args
          if (input?.updateError) return { error: input.updateError }
          return { data: undefined }
        },
        async promptAsync(args: Record<string, unknown>) {
          calls.push("promptAsync")
          sent = args
          if (input?.promptError) return { error: input.promptError }
          return { data: undefined }
        },
        async message(args: Record<string, unknown>) {
          calls.push("message")
          if (typeof args.messageID === "string") looked.push(args.messageID)
          return {
            data: {
              parts: [
                { id: "prt_done", type: "text", text: "hidden", synthetic: true },
                {
                  id: "prt_live",
                  type: "text",
                  text: typeof args.messageID === "string" && args.messageID === "msg_old" ? "old reply" : "side reply",
                },
              ],
            },
          }
        },
        async messages(args: Record<string, unknown>) {
          calls.push("messages")
          if (args.sessionID === "ses_main") {
            return {
              data: input?.sourceTail
                ? [
                    {
                      info: { id: "msg_done_user", role: "user", time: { created: 1 } },
                      parts: [{ id: "prt_done_user", type: "text", text: "done" }],
                    },
                    {
                      info: {
                        id: "msg_done_assistant",
                        role: "assistant",
                        parentID: "msg_done_user",
                        time: { created: 2, completed: 3 },
                        finish: "stop",
                      },
                      parts: [{ id: "prt_done_assistant", type: "text", text: "done" }],
                    },
                    {
                      info: { id: "msg_tail_user", role: "user", time: { created: 4 } },
                      parts: [{ id: "prt_tail_user", type: "text", text: "tail" }],
                    },
                    {
                      info: {
                        id: "msg_tail_assistant",
                        role: "assistant",
                        parentID: "msg_tail_user",
                        time: { created: 5 },
                      },
                      parts: [{ id: "prt_tail_assistant", type: "text", text: "tail" }],
                    },
                  ]
                : input?.sourceBlank
                  ? [
                      {
                        info: { id: "msg_busy_user", role: "user", time: { created: 1 } },
                        parts: [{ id: "prt_busy_user", type: "text", text: "busy" }],
                      },
                      {
                        info: {
                          id: "msg_busy_assistant",
                          role: "assistant",
                          parentID: "msg_busy_user",
                          time: { created: 2 },
                        },
                        parts: [{ id: "prt_busy_assistant", type: "text", text: "busy" }],
                      },
                    ]
                  : [],
            }
          }
          messages += 1
          return {
            data:
              messages <= (input?.messagesDelay ?? 0)
                ? [{ info: { id: "msg_old", role: "assistant", parentID: "msg_other" }, parts: [] }]
                : [
                    {
                      info: { id: "msg_old", role: "assistant", parentID: "msg_other" },
                      parts: [{ id: "prt_old", type: "text", text: "old reply" }],
                    },
                    {
                      info: { id: sent?.messageID, role: "user", parentID: undefined },
                      parts: [{ id: "prt_user", type: "text", text: "what changed?" }],
                    },
                    {
                      info: { id: "msg_a", role: "assistant", parentID: sent?.messageID },
                      parts: [{ id: "prt_live", type: "text", text: "side reply" }],
                    },
                  ],
          }
        },
        async abort() {
          calls.push("abort")
          return {}
        },
        async delete() {
          calls.push("delete")
          if (input?.deleteReject) throw input.deleteReject
          if (input?.deleteError) return { error: input.deleteError }
          done()
          return {}
        },
      },
    },
  }

  return {
    api,
    calls,
    created: () => created,
    fork: () => fork,
    kv,
    looked,
    nav,
    updated: () => updated,
    rows() {
      return reg.flatMap((cb) => cb())
    },
    slot(name: string) {
      return slots.find((item) => item?.slots?.[name])
    },
    toasts,
    views,
    wait,
    sent: () => sent,
    emit(type: string, properties: Record<string, unknown>) {
      for (const handler of handlers.get(type) ?? []) handler({ type, properties })
    },
    async dispose() {
      for (const fn of dispose) await fn()
    },
  }
}

describe("opencode-bytheway tui plugin", () => {
  test("exports the runtime plugin id from index.js", () => {
    expect(serverPlugin.id).toBe("opencode-bytheway")
  })

  test("registers btw_status and injects the btw-status command", async () => {
    const server = await serverPlugin.server()
    const cfg = { command: { existing: { description: "keep" } } } as any

    await server.config(cfg)

    expect(Object.keys(server.tool)).toEqual(["btw_status"])
    expect(await server.tool.btw_status.execute({}, { sessionID: "ses_main" })).toBe(
      "opencode-bytheway is loaded.\nsession: ses_main",
    )
    expect(cfg.command["btw-status"]).toEqual({
      description: "Check whether the opencode-bytheway plugin is loaded",
      agent: "general",
      template: "Call the btw_status tool and return its output.",
    })
    expect(cfg.command.existing).toEqual({ description: "keep" })
  })

  test("registers /btw slash command", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(rows()).toHaveLength(3)
    expect(cmd(rows(), "btw.open")?.slash).toEqual({ name: "btw" })
    expect(cmd(rows(), "btw.popup")?.slash).toEqual({ name: "btw_popup" })
    expect(cmd(rows(), "btw.end")?.slash).toEqual({ name: "btw_end" })
  })

  test("registers a sidebar indicator slot", async () => {
    const { api, slot } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(slot("sidebar_content")).toBeTruthy()
  })

  test("renders the sidebar indicator without DOM globals", async () => {
    const { api, kv, slot } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw" })
    const entry = slot("sidebar_content")

    expect(entry).toBeTruthy()

    const rendered = await testRender(() =>
      entry?.slots?.sidebar_content({}, { session_id: "ses_btw" }),
    )

    await rendered.renderOnce()

    expect(rendered.captureCharFrame()).toContain("/btw session active")
    expect(rendered.captureCharFrame()).toContain("Run /btw_end to return")
  })

  test("only shows the sidebar indicator for the active btw temp session", () => {
    expect(indicator("ses_main", undefined)).toBeUndefined()
    expect(indicator("ses_main", { origin: "ses_root", temp: "ses_btw" } as any)).toBeUndefined()
    expect(indicator("ses_btw", { origin: "ses_main", temp: "ses_btw" } as any)).toEqual({
      title: "/btw session active",
      detail: "Run /btw_end to return",
    })
    expect(sessiontitle()).toBe("/btw session")
  })

  test("derives slash command names from OPENCODE_BYTHEWAY_COMMAND", async () => {
    const prev = env()["OPENCODE_BYTHEWAY_COMMAND"]
    env()["OPENCODE_BYTHEWAY_COMMAND"] = "aside"

    try {
      const { api, rows, views } = setup()
      await plugin.tui(api, undefined, { state: "first" } as any)

      expect(cmd(rows(), "btw.open")?.slash).toEqual({ name: "aside" })
      expect(cmd(rows(), "btw.popup")?.slash).toEqual({ name: "aside_popup" })
      expect(cmd(rows(), "btw.end")?.slash).toEqual({ name: "aside_end" })
      expect(indicator("ses_btw", { origin: "ses_main", temp: "ses_btw" } as any)).toEqual({
        title: "/aside session active",
        detail: "Run /aside_end to return",
      })
      expect(sessiontitle()).toBe("/aside session")

      cmd(rows(), "btw.open").onSelect()
      await tick()

      expect(views.at(-1)?.props?.title).toBe("Entered /aside Session")
      expect(views.at(-1)?.props?.message).toContain("Run /aside_end to return")
    } finally {
      if (prev === undefined) delete env()["OPENCODE_BYTHEWAY_COMMAND"]
      else env()["OPENCODE_BYTHEWAY_COMMAND"] = prev
    }
  })

  test("keeps btw_popup hidden when not inside a session", async () => {
    const { api, rows, toasts } = setup({ session: false })
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(cmd(rows(), "btw.open")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.popup")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(true)
  })

  test("creates an origin session when opening /btw from home", async () => {
    const { api, calls, created, kv, nav, rows, updated } = setup({ session: false })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(created()).toEqual({})
    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session" })
    expect(calls).toEqual(["create", "messages", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw" })
  })

  test("continues into /btw when session title labeling fails", async () => {
    const { api, calls, kv, nav, rows, updated } = setup({ updateError: new Error("update failed") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session" })
    expect(calls).toEqual(["messages", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw" })
  })

  test("shows an error toast when creating the origin session fails", async () => {
    const { api, nav, rows, toasts } = setup({ session: false, createError: new Error("create failed") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(toasts.at(-1)).toEqual({ variant: "error", message: "create failed" })
    expect(nav).toEqual([])
  })

  test("streams async reply and deletes fork on completion", async () => {
    const { api, calls, rows, views, wait, sent, emit } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const ask: any = views[0]
    ask.props.onConfirm("what changed?")

    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync"])

    const user = sent()?.messageID as string
    emit("message.updated", {
      sessionID: "ses_btw",
      info: {
        role: "assistant",
        id: "msg_a",
        parentID: user,
        time: { created: 1 },
      },
    })
    emit("message.part.updated", {
      sessionID: "ses_btw",
      part: { id: "prt_live", type: "text", messageID: "msg_a", text: "side" },
      time: 1,
    })
    emit("message.part.delta", {
      sessionID: "ses_btw",
      messageID: "msg_a",
      partID: "prt_live",
      field: "text",
      delta: " reply",
    })
    emit("message.updated", {
      sessionID: "ses_btw",
      info: {
        role: "assistant",
        id: "msg_a",
        parentID: user,
        time: { created: 1, completed: 2 },
      },
    })

    await wait
    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync", "delete"])
  })

  test("coalesces busy redraws while streaming", async () => {
    const { api, rows, views, sent, emit } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const ask: any = views[0]
    ask.props.onConfirm("what changed?")

    await tick()

    const base = views.length
    const user = sent()?.messageID as string
    emit("message.updated", {
      sessionID: "ses_btw",
      info: {
        role: "assistant",
        id: "msg_a",
        parentID: user,
        time: { created: 1 },
      },
    })
    emit("message.part.updated", {
      sessionID: "ses_btw",
      part: { id: "prt_live", type: "text", messageID: "msg_a", text: "a" },
      time: 1,
    })
    emit("message.part.delta", {
      sessionID: "ses_btw",
      messageID: "msg_a",
      partID: "prt_live",
      field: "text",
      delta: "b",
    })
    emit("message.part.delta", {
      sessionID: "ses_btw",
      messageID: "msg_a",
      partID: "prt_live",
      field: "text",
      delta: "c",
    })

    await tick()

    expect(views.length).toBe(base)

    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(views.length).toBe(base + 1)
  })

  test("ignores historical fork text before the new assistant reply is identified", async () => {
    const { api, calls, looked, rows, views, wait, sent, emit } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const ask: any = views[0]
    ask.props.onConfirm("is node better than bun?")

    await tick()

    const user = sent()?.messageID as string
    emit("message.part.updated", {
      sessionID: "ses_btw",
      part: { id: "prt_old", type: "text", messageID: "msg_old", text: "old" },
      time: 1,
    })
    emit("message.part.delta", {
      sessionID: "ses_btw",
      messageID: "msg_old",
      partID: "prt_old",
      field: "text",
      delta: " reply",
    })
    emit("message.updated", {
      sessionID: "ses_btw",
      info: {
        role: "assistant",
        id: "msg_a",
        parentID: user,
        time: { created: 1 },
      },
    })
    emit("message.part.updated", {
      sessionID: "ses_btw",
      part: { id: "prt_live", type: "text", messageID: "msg_a", text: "side" },
      time: 1,
    })
    emit("message.updated", {
      sessionID: "ses_btw",
      info: {
        role: "assistant",
        id: "msg_a",
        parentID: user,
        time: { created: 1, completed: 2 },
      },
    })

    await wait
    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync", "delete"])
    expect(looked).toEqual([])
  })

  test("falls back to messages lookup when idle arrives before assistant identification", async () => {
    const { api, calls, looked, rows, views, wait, emit } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const ask: any = views[0]
    ask.props.onConfirm("what changed?")

    await tick()

    emit("session.status", {
      sessionID: "ses_btw",
      status: { type: "idle" },
    })

    await wait
    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync", "messages", "delete"])
    expect(looked).toEqual([])
  })

  test("retries messages lookup when the reply appears after idle", async () => {
    const { api, calls, rows, views, wait, emit } = setup({ messagesDelay: 2 })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const ask: any = views[0]
    ask.props.onConfirm("what changed?")

    await tick()

    emit("session.idle", {
      sessionID: "ses_btw",
    })

    await wait
    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync", "messages", "messages", "messages", "delete"])
  })

  test("forks from the last completed assistant boundary", async () => {
    const { api, fork, rows, views } = setup({ sourceTail: true })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const ask: any = views[0]
    ask.props.onConfirm("what changed?")

    await tick()

    expect(fork()).toEqual({ sessionID: "ses_main", messageID: "msg_tail_user" })
  })

  test("forks the full session when no completed boundary exists", async () => {
    const { api, calls, rows, views } = setup({ sourceBlank: true })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const ask: any = views[0]
    ask.props.onConfirm("what changed?")

    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync"])
  })

  test("deletes fork when async prompt fails", async () => {
    const { api, calls, rows, views, wait } = setup({ promptError: new Error("boom") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const prompt: any = views[0]
    prompt.props.onConfirm("what changed?")

    await wait
    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync", "delete"])
  })

  test("deletes a stale popup fork when a delayed run is replaced", async () => {
    const { api, calls, rows, views, emit } = setup({
      forkDelays: [30, 0],
      forkIDs: ["ses_old", "ses_new"],
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    let prompt: any = views.at(-1)
    prompt.props.onConfirm("first question")

    await tick()

    cmd(rows(), "btw.popup").onSelect()
    prompt = views.at(-1)
    prompt.props.onConfirm("second question")

    await tick()

    emit("session.idle", {
      sessionID: "ses_new",
    })

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(calls.filter((item) => item === "promptAsync")).toHaveLength(1)
    expect(calls.filter((item) => item === "delete")).toHaveLength(2)
  })

  test("filters synthetic text from response", () => {
    expect(
      plain([{ type: "text", text: "skip", synthetic: true } as any, { type: "text", text: "keep" } as any] as any),
    ).toBe("keep")
  })

  test("wraps long lines for dialog display", () => {
    expect(wrap("alpha beta gamma delta", 10)).toBe("alpha beta\ngamma delta")
  })

  test("preserves bullet indentation when wrapping", () => {
    expect(wrap("- alpha beta gamma delta", 12)).toBe("- alpha beta\n  gamma\n  delta")
  })

  test("formats diagnostics for empty visible responses", () => {
    expect(
      debug({
        step: "done",
        fork: "ses_btw",
        user: "msg_user",
        aid: undefined,
        part: new Map([["prt_hidden", { text: "hidden", synthetic: true }]]),
        wait: new Map([["msg_a", new Map([["prt_live", { text: "side" }]])]]),
        diag: ["fork ses_btw", "locate.match=-"],
      } as any),
    ).toContain("locate.match=-")
  })

  test("aborts active run on lifecycle dispose", async () => {
    const { api, calls, rows, views, wait, dispose } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const prompt: any = views[0]
    prompt.props.onConfirm("what changed?")

    await tick()

    await dispose()

    await wait
    await tick()

    expect(calls).toEqual(["messages", "fork", "promptAsync", "abort", "delete"])
  })

  test("blocks overlapping btw runs", async () => {
    const { api, rows, views, toasts } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.popup").onSelect()
    const prompt: any = views[0]
    prompt.props.onConfirm("what changed?")

    await tick()

    cmd(rows(), "btw.open").onSelect()
    expect(toasts.at(-1)?.message).toBe("/btw is unavailable while /btw_popup is running.")
  })

  test("shows an error toast when opening /btw fails", async () => {
    const { api, kv, nav, rows, toasts } = setup({ forkError: new Error("fork failed") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(toasts.at(-1)).toEqual({ variant: "error", message: "fork failed" })
    expect(nav).toEqual([])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
  })

  test("opens a btw side session and records origin/temp", async () => {
    const { api, calls, kv, nav, rows, updated } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session" })
    expect(calls).toEqual(["messages", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw" })
  })

  test("shows a btw entry message with exit instructions", async () => {
    const { api, rows, views } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(views.at(-1)?.type).toBe("alert")
    expect(views.at(-1)?.props?.title).toBe("Entered /btw Session")
    expect(views.at(-1)?.props?.message).toContain("Run /btw_end to return")
  })

  test("shows btw_end and hides btw while inside active btw session", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(cmd(rows(), "btw.open")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.popup")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.popup")?.enabled).toBe(false)
  })

  test("blocks btw_popup inside an active btw session", async () => {
    const { api, rows, toasts } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    cmd(rows(), "btw.popup").onSelect()
    expect(toasts.at(-1)?.message).toBe("/btw_popup is disabled inside a /btw session. Run /btw_end first.")
  })

  test("ends btw session, returns to origin, and deletes temp", async () => {
    const { api, calls, kv, nav, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    cmd(rows(), "btw.end").onSelect()
    await tick()

    expect(calls).toEqual(["messages", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
  })

  test("keeps btw state when temp-session deletion returns an error", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({
      deleteError: new Error("nope"),
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    cmd(rows(), "btw.end").onSelect()
    await tick()

    expect(calls).toEqual(["messages", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw" })
    expect(toasts.at(-1)).toEqual({
      variant: "error",
      message: "Returned from /btw, but failed to delete the temp session.",
    })
  })

  test("keeps btw state when temp-session deletion rejects", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({
      deleteReject: new Error("boom"),
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    cmd(rows(), "btw.end").onSelect()
    await tick()

    expect(calls).toEqual(["messages", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw" })
    expect(toasts.at(-1)).toEqual({
      variant: "error",
      message: "Returned from /btw, but failed to delete the temp session.",
    })
  })
})
