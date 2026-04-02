import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import serverPlugin from "./index.js"
import plugin, { indicator, sessiontitle } from "./tui"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

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
  forkError?: Error
  forkIDs?: string[]
  sourceTail?: boolean
  sourceBlank?: boolean
  deleteError?: Error
  deleteReject?: Error
}) {
  const calls: string[] = []
  const toasts: Array<Record<string, unknown>> = []
  const views: any[] = []
  const nav: any[] = []
  const reg: Array<() => any[]> = []
  const slots: any[] = []
  const kv = new Map<string, unknown>()
  let creates = 0
  let forks = 0
  let created: Record<string, unknown> | undefined
  let updated: Record<string, unknown> | undefined
  let fork: Record<string, unknown> | undefined
  let route: any = input?.session === false ? { name: "home" } : { name: "session", params: { sessionID: "ses_main" } }

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
      DialogAlert: (props: Record<string, unknown>) => ({ type: "alert", props }),
      dialog: {
        replace(render: () => unknown) {
          views.push(render())
        },
        clear() {},
        setSize() {},
      },
      toast(input: Record<string, unknown>) {
        toasts.push(input)
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
        async messages(args: Record<string, unknown>) {
          calls.push("messages")
          if (args.sessionID !== "ses_main") return { data: [] }
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
        },
        async fork(args: Record<string, unknown>) {
          calls.push("fork")
          fork = args
          const id = input?.forkIDs?.[forks] ?? "ses_btw"
          forks += 1
          if (input?.forkError) return { error: input.forkError }
          return { data: { id } }
        },
        async update(args: Record<string, unknown>) {
          calls.push("update")
          updated = args
          if (input?.updateError) return { error: input.updateError }
          return { data: undefined }
        },
        async delete() {
          calls.push("delete")
          if (input?.deleteReject) throw input.deleteReject
          if (input?.deleteError) return { error: input.deleteError }
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
    nav,
    rows() {
      return reg.flatMap((cb) => cb())
    },
    slot(name: string) {
      return slots.find((item) => item?.slots?.[name])
    },
    toasts,
    updated: () => updated,
    views,
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

  test("registers /btw and /btw_end slash commands", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(rows()).toHaveLength(2)
    expect(cmd(rows(), "btw.open")?.slash).toEqual({ name: "btw" })
    expect(cmd(rows(), "btw.end")?.slash).toEqual({ name: "btw_end" })
    expect(cmd(rows(), "btw.popup")).toBeUndefined()
  })

  test("registers a sidebar indicator slot", async () => {
    const { api, slot } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(slot("sidebar_content")).toBeTruthy()
  })

  test("renders the sidebar indicator", async () => {
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

  test("only shows the indicator for the active btw temp session", () => {
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

  test("shows /btw from home and hides /btw_end", async () => {
    const { api, rows } = setup({ session: false })
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(cmd(rows(), "btw.open")?.hidden).toBe(false)
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

  test("forks from the last completed assistant boundary", async () => {
    const { api, fork, rows } = setup({ sourceTail: true })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(fork()).toEqual({ sessionID: "ses_main", messageID: "msg_tail_user" })
  })

  test("forks the full session when no completed boundary exists", async () => {
    const { api, calls, fork, rows } = setup({ sourceBlank: true })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(fork()).toEqual({ sessionID: "ses_main" })
    expect(calls).toEqual(["messages", "fork", "update"])
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

  test("shows /btw_end and hides /btw while inside an active btw session", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(cmd(rows(), "btw.open")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.end")?.suggested).toBe(true)
  })

  test("warns when trying to open /btw from inside the active btw session", async () => {
    const { api, rows, toasts } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    cmd(rows(), "btw.open").onSelect()
    expect(toasts.at(-1)?.message).toBe("Already inside a /btw session. Run /btw_end to return.")
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
    const { api, calls, kv, nav, rows, toasts } = setup({ deleteError: new Error("nope") })
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
    const { api, calls, kv, nav, rows, toasts } = setup({ deleteReject: new Error("boom") })
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
