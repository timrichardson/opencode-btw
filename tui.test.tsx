import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import serverPlugin from "./index.js"
import plugin, { indicator, sessiontitle } from "./tui"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const handoffFile = (originSessionID = "none") => `/tmp/opencode-bytheway-handoff-test-${originSessionID.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`

const env = () =>
  (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env ?? {}

env()["OPENCODE_BYTHEWAY_HANDOFF_NAMESPACE"] = "test"

function cmd(rows: any[], value: string) {
  return rows.find((row) => row.value === value)
}

function textMessage(id: string, role: "user" | "assistant", text: string, completed?: boolean) {
  return {
    info:
      role === "assistant"
        ? {
            id,
            role,
            parentID: `${id}_parent`,
            time: completed ? { created: 1, completed: 2 } : { created: 1 },
            finish: completed ? "stop" : undefined,
          }
        : {
            id,
            role,
            time: { created: 1 },
          },
    parts: [{ id: `${id}_part`, type: "text", text }],
  }
}

function setup(input?: {
  session?: boolean
  sessionID?: string
  createError?: Error
  createIDs?: string[]
  updateError?: Error
  forkError?: Error
  forkIDs?: string[]
  sourceTail?: boolean
  sourceBlank?: boolean
  originMessages?: any[]
  tempMessages?: any[]
  currentSession?: any
  getSessions?: Record<string, any>
  childSessions?: any[]
  deleteError?: Error
  deleteReject?: Error
  promptError?: Error
  promptAsyncError?: Error
  promptResult?: unknown
  onPrompt?: (args: Record<string, unknown>) => void
}) {
  rmSync(handoffFile(input?.sessionID ?? "ses_main"), { force: true })
  const calls: string[] = []
  const toasts: Array<Record<string, unknown>> = []
  const views: any[] = []
  const nav: any[] = []
  const reg: Array<() => any[]> = []
  const slots: any[] = []
  const kv = new Map<string, unknown>()
  const events = new Map<string, Array<(event: any) => void>>()
  let creates = 0
  let forks = 0
  let created: Record<string, unknown> | undefined
  let updated: Record<string, unknown> | undefined
  let fork: Record<string, unknown> | undefined
  let prompted: Record<string, unknown> | undefined
  let appended: Record<string, unknown> | undefined
  let route: any =
    input?.session === false
      ? { name: "home" }
      : { name: "session", params: { sessionID: input?.sessionID ?? "ses_main" } }

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
    event: {
      on(type: string, handler: (event: any) => void) {
        const list = events.get(type) ?? []
        list.push(handler)
        events.set(type, list)
        return () => {
          events.set(type, (events.get(type) ?? []).filter((item) => item !== handler))
        }
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose() {
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
          if (args.sessionID !== "ses_main") return { data: input?.tempMessages ?? [] }
          if (input?.originMessages) return { data: input.originMessages }
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
        async get(args: Record<string, unknown>) {
          calls.push("get")
          if (input?.getSessions?.[String(args.sessionID)]) {
            return { data: input.getSessions[String(args.sessionID)] }
          }
          if (input?.currentSession) return { data: input.currentSession }
          return {
            data:
              args.sessionID === "ses_btw"
                ? { id: "ses_btw", parentID: "ses_main", title: "/btw session", time: { updated: 2 } }
                : { id: args.sessionID, title: "main", time: { updated: 1 } },
          }
        },
        async children() {
          calls.push("children")
          return { data: input?.childSessions ?? [] }
        },
        async prompt(args: Record<string, unknown>) {
          calls.push("prompt")
          prompted = args
          input?.onPrompt?.(args)
          if (input?.promptError) return { error: input.promptError }
          return { data: input?.promptResult }
        },
        async promptAsync(args: Record<string, unknown>) {
          calls.push("promptAsync")
          prompted = args
          if (input?.promptAsyncError) return { error: input.promptAsyncError }
          return { data: undefined }
        },
        async delete() {
          calls.push("delete")
          if (input?.deleteReject) throw input.deleteReject
          if (input?.deleteError) return { error: input.deleteError }
          return {}
        },
      },
      tui: {
        async selectSession(args: Record<string, unknown>) {
          calls.push("selectSession")
          nav.push({ name: "session", params: { sessionID: args.sessionID } })
          return { data: true }
        },
        async clearPrompt() {
          calls.push("clearPrompt")
          return { data: true }
        },
        async appendPrompt(args: Record<string, unknown>) {
          calls.push("appendPrompt")
          appended = args
          return { data: true }
        },
        async submitPrompt() {
          calls.push("submitPrompt")
          return { data: true }
        },
      },
    },
  }

  return {
    api,
    calls,
    appended: () => appended,
    created: () => created,
    fork: () => fork,
    kv,
    nav,
    prompted: () => prompted,
    rows() {
      return reg.flatMap((cb) => cb())
    },
    emit(type: string, properties: Record<string, unknown>) {
      for (const handler of events.get(type) ?? []) handler({ type, properties })
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

  test("registers btw_status and injects the btw-prompt command", async () => {
    const server = await serverPlugin.server()
    const cfg = { command: { existing: { description: "keep" } } } as any

    await server.config(cfg)

    expect(Object.keys(server.tool)).toEqual([
      "btw_status",
      "opencode_bytheway_plugin_open",
      "opencode_bytheway_plugin_select_temp",
    ])
    expect(await server.tool.btw_status.execute({}, { sessionID: "ses_status" })).toBe(
      "opencode-bytheway 0.3.5 is loaded.\nsession: ses_status",
    )
    expect(cfg.command["btw-prompt"]).toEqual({
      description: "Experimental: open a temporary by-the-way session and hand its initial prompt to the TUI",
      template: "/btw-prompt",
    })
    expect(cfg.command.btw).toBeUndefined()
    expect(cfg.command["btw-status"]).toEqual({
      description: "Check whether the opencode-bytheway plugin is loaded",
      template: "/btw-status",
    })
    expect(cfg.command.existing).toEqual({ description: "keep" })
  })

  test("btw-status command executes directly in command.execute.before and shows a toast", async () => {
    const client: any = {
      tui: {
        async showToast(args: Record<string, unknown>) {
          expect(args).toEqual({
            title: "opencode-bytheway",
            message: "opencode-bytheway 0.3.5 is loaded.\nsession: ses_status",
            variant: "info",
            duration: 6000,
          })
          return { data: true }
        },
      },
    }

    const server = await serverPlugin.server({ client })
    const hook = server["command.execute.before"]
    await expect(hook?.({ command: "btw-status", sessionID: "ses_status", arguments: "" }, { parts: [] })).rejects.toThrow(
      "__OPENCODE_BYTHEWAY_BTW_STATUS_HANDLED__",
    )
  })

  test("opencode_bytheway_plugin_open tool writes the prompt handoff and triggers btw.open in the TUI", async () => {
    rmSync(handoffFile("ses_exp_server_open"), { force: true })
    const client: any = {
      tui: {
        async publish(args: Record<string, unknown>) {
          expect(args).toEqual({
            body: {
              type: "tui.command.execute",
              properties: { command: "btw.open" },
            },
          })
          return { data: true }
        },
      },
    }

    const server = await serverPlugin.server({ client })
    await expect(server.tool.opencode_bytheway_plugin_open.execute({ prompt: "investigate this" }, { sessionID: "ses_exp_server_open" })).resolves.toBe("")
    expect(JSON.parse(readFileSync(handoffFile("ses_exp_server_open"), "utf8"))).toMatchObject({
      type: "experimental-btw",
      version: 3,
      mode: "btw.open",
      originSessionID: "ses_exp_server_open",
      prompt: "investigate this",
    })
    rmSync(handoffFile("ses_exp_server_open"), { force: true })
  })

  test("opencode_bytheway_plugin_open tool preserves the user prompt exactly in the handoff file", async () => {
    rmSync(handoffFile("ses_exp_server_prompt"), { force: true })
    const client: any = {
      tui: {
        async publish() {
          return { data: true }
        },
      },
    }

    const server = await serverPlugin.server({ client })
    await expect(server.tool.opencode_bytheway_plugin_open.execute({ prompt: "  investigate this  " }, { sessionID: "ses_exp_server_prompt" })).resolves.toBe("")
    expect(JSON.parse(readFileSync(handoffFile("ses_exp_server_prompt"), "utf8"))).toMatchObject({
      type: "experimental-btw",
      mode: "btw.open",
      prompt: "  investigate this  ",
    })
    rmSync(handoffFile("ses_exp_server_prompt"), { force: true })
  })

  test("opencode_bytheway_plugin_open tool writes an empty prompt handoff when no prompt is provided", async () => {
    rmSync(handoffFile("ses_exp_server_empty"), { force: true })
    const client: any = {
      tui: {
        async publish() {
          return { data: true }
        },
      },
    }

    const server = await serverPlugin.server({ client })
    await expect(server.tool.opencode_bytheway_plugin_open.execute({}, { sessionID: "ses_exp_server_empty" })).resolves.toBe("")
    expect(JSON.parse(readFileSync(handoffFile("ses_exp_server_empty"), "utf8"))).toMatchObject({
      type: "experimental-btw",
      mode: "btw.open",
      prompt: "",
    })
    rmSync(handoffFile("ses_exp_server_empty"), { force: true })
  })

  test("btw-prompt command executes directly in command.execute.before", async () => {
    rmSync(handoffFile("ses_exp_server_hook"), { force: true })
    const client: any = {
      tui: {
        async publish(args: Record<string, unknown>) {
          expect(args).toEqual({
            body: {
              type: "tui.command.execute",
              properties: { command: "btw.open" },
            },
          })
          return { data: true }
        },
      },
    }

    const server = await serverPlugin.server({ client })
    const hook = server["command.execute.before"]
    await expect(hook?.({ command: "btw-prompt", sessionID: "ses_exp_server_hook", arguments: "investigate this" }, { parts: [] })).rejects.toThrow(
      "__OPENCODE_BYTHEWAY_EXPERIMENTAL_BTW_HANDLED__",
    )
    expect(JSON.parse(readFileSync(handoffFile("ses_exp_server_hook"), "utf8"))).toMatchObject({
      type: "experimental-btw",
      version: 3,
      mode: "btw.open",
      originSessionID: "ses_exp_server_hook",
      prompt: "investigate this",
    })
    rmSync(handoffFile("ses_exp_server_hook"), { force: true })
  })

  test("opencode_bytheway_plugin_select_temp selects the provided session", async () => {
    const client: any = {
      tui: {
        async selectSession(args: Record<string, unknown>) {
          expect(args).toEqual({ sessionID: "ses_btw" })
          return { data: true }
        },
      },
    }

    const server = await serverPlugin.server({ client })
    await expect(server.tool.opencode_bytheway_plugin_select_temp.execute({ sessionID: "ses_btw" }, {} as any)).resolves.toBe("")
  })

  test("registers /btw, /btw-merge, and /btw-end slash commands", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(rows()).toHaveLength(3)
    expect(cmd(rows(), "btw.open")?.slash).toEqual({ name: "btw" })
    expect(cmd(rows(), "btw.merge")?.slash).toEqual({ name: "btw-merge" })
    expect(cmd(rows(), "btw.end")?.slash).toEqual({ name: "btw-end" })
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
    expect(rendered.captureCharFrame()).toContain("Run /btw-end to return")
  })

  test("only shows the indicator for the active btw temp session", () => {
    expect(indicator("ses_main", undefined)).toBeUndefined()
    expect(indicator("ses_main", { origin: "ses_root", temp: "ses_btw" } as any)).toBeUndefined()
    expect(indicator("ses_btw", { origin: "ses_main", temp: "ses_btw" } as any)).toEqual({
      title: "/btw session active",
      detail: "Run /btw-end to return",
    })
    expect(sessiontitle()).toBe("/btw session")
  })

  test("derives slash command names from OPENCODE_BYTHEWAY_COMMAND", async () => {
    const prev = env()["OPENCODE_BYTHEWAY_COMMAND"]
    env()["OPENCODE_BYTHEWAY_COMMAND"] = "aside"

    try {
      const server = await serverPlugin.server()
      const cfg = { command: {} } as any
      await server.config(cfg)

      const { api, rows, views } = setup()
      await plugin.tui(api, undefined, { state: "first" } as any)

      expect(cfg.command["btw-prompt"]).toEqual({
        description: "Experimental: open a temporary by-the-way session and hand its initial prompt to the TUI",
        template: "/btw-prompt",
      })
      expect(cfg.command.aside).toBeUndefined()
      expect(cmd(rows(), "btw.open")?.slash).toEqual({ name: "aside" })
      expect(cmd(rows(), "btw.merge")?.slash).toEqual({ name: "aside-merge" })
      expect(cmd(rows(), "btw.end")?.slash).toEqual({ name: "aside-end" })
      expect(indicator("ses_btw", { origin: "ses_main", temp: "ses_btw" } as any)).toEqual({
        title: "/aside session active",
        detail: "Run /aside-end to return",
      })
      expect(sessiontitle()).toBe("/aside session")

      cmd(rows(), "btw.open").onSelect()
      await tick()
      await tick()

      expect(views.at(-1)?.props?.title).toBe("Entered /aside Session")
      expect(views.at(-1)?.props?.message).toContain("Run /aside-end to return")
    } finally {
      if (prev === undefined) delete env()["OPENCODE_BYTHEWAY_COMMAND"]
      else env()["OPENCODE_BYTHEWAY_COMMAND"] = prev
    }
  })

  test("shows /btw from home and hides /btw-end", async () => {
    const { api, rows } = setup({ session: false })
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(cmd(rows(), "btw.open")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.merge")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(true)
  })

  test("shows /btw and hides /btw-end in an unrelated session even if another btw state is saved", async () => {
    const { api, kv, rows } = setup({ sessionID: "ses_other" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw", baseCount: 2 })

    expect(cmd(rows(), "btw.open")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.merge")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(true)
  })

  test("creates an origin session when opening /btw from home", async () => {
    const { api, calls, created, kv, nav, rows, updated } = setup({ session: false })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    expect(created()).toEqual({})
    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session" })
    expect(calls).toEqual(["create", "messages", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 0 })
  })

  test("continues into /btw when session title labeling fails", async () => {
    const { api, calls, kv, nav, rows, updated } = setup({ updateError: new Error("update failed") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session" })
    expect(calls).toEqual(["get", "children", "messages", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 0 })
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
    await tick()

    expect(fork()).toEqual({ sessionID: "ses_main", messageID: "msg_tail_user" })
  })

  test("forks the full session when no completed boundary exists", async () => {
    const { api, calls, fork, rows } = setup({ sourceBlank: true })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    expect(fork()).toEqual({ sessionID: "ses_main" })
    expect(calls).toEqual(["get", "children", "messages", "fork", "update"])
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
    expect(calls).toEqual(["get", "children", "messages", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 0 })
  })

  test("shows a btw entry message with exit instructions", async () => {
    const { api, rows, views } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    expect(views.at(-1)?.type).toBe("alert")
    expect(views.at(-1)?.props?.title).toBe("Entered /btw Session")
    expect(views.at(-1)?.props?.message).toContain("Run /btw-end to return")
  })

  test("shows /btw-merge and /btw-end while inside an active btw session", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    expect(cmd(rows(), "btw.open")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.merge")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.merge")?.suggested).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.end")?.suggested).toBeUndefined()
  })

  test("merges btw text back into the origin session and deletes temp", async () => {
    const { api, calls, kv, nav, prompted, rows, toasts } = setup({
      tempMessages: [
        textMessage("msg_user", "user", "keep this note"),
        textMessage("msg_assistant", "assistant", "here is the answer", true),
        {
          info: { id: "msg_tool", role: "assistant", parentID: "msg_user", time: { created: 3 } },
          parts: [{ id: "prt_tool", type: "tool", tool: "bash", state: { status: "completed" } }],
        },
      ],
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    cmd(rows(), "btw.merge").onSelect()
    await tick()

    expect(calls).toEqual(["get", "children", "messages", "fork", "update", "messages", "prompt", "delete"])
    expect(prompted()).toEqual({
      sessionID: "ses_main",
      noReply: true,
      parts: [
        {
          type: "text",
          text: [
            "Merged context from a temporary /btw session.",
            "Only plain user and assistant text is included below.",
            "",
            "User:\nkeep this note\n\nAssistant:\nhere is the answer",
          ].join("\n"),
        },
      ],
    })
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
    expect(toasts.at(-1)).toEqual({ variant: "info", message: "Merged back from /btw session." })
  })

  test("returns without prompting when there is no new mergeable text", async () => {
    const { api, calls, kv, nav, prompted, rows, toasts } = setup({
      tempMessages: [
        {
          info: { id: "msg_tool", role: "assistant", parentID: "msg_user", time: { created: 1 } },
          parts: [{ id: "prt_tool", type: "tool", tool: "bash", state: { status: "completed" } }],
        },
      ],
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    cmd(rows(), "btw.merge").onSelect()
    await tick()

    expect(calls).toEqual(["get", "children", "messages", "fork", "update", "messages", "delete"])
    expect(prompted()).toBeUndefined()
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
    expect(toasts.at(-1)).toEqual({
      variant: "info",
      message: "No new text to merge. Returned from /btw session.",
    })
  })

  test("keeps the active btw session when merge append fails", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({
      tempMessages: [textMessage("msg_assistant", "assistant", "here is the answer", true)],
      promptError: new Error("prompt failed"),
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    cmd(rows(), "btw.merge").onSelect()
    await tick()

    expect(calls).toEqual(["get", "children", "messages", "fork", "update", "messages", "prompt"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 0 })
    expect(toasts.at(-1)).toEqual({ variant: "error", message: "prompt failed" })
  })

  test("warns when trying to open /btw from inside the active btw session", async () => {
    const { api, rows, toasts } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    cmd(rows(), "btw.open").onSelect()
    await tick()
    expect(toasts.at(-1)?.message).toBe("Already inside a /btw session. Run /btw-end to return.")
  })

  test("uses the experimental handoff inside btw.open and skips the entry dialog", async () => {
    rmSync(handoffFile("ses_exp_origin_a"), { force: true })
    const tempMessages: any[] = []

    const { api, kv, nav, prompted, rows, views } = setup({
      sessionID: "ses_exp_origin_a",
      tempMessages,
      promptResult: {
        info: { id: "msg_reply", role: "assistant" },
        parts: [{ type: "text", text: "Experimental ANZAC reply" }],
      },
      onPrompt(args) {
        expect(args).toEqual({
          sessionID: "ses_btw",
          parts: [{ type: "text", text: "tell me about the anzacs" }],
        })
        tempMessages.push(
          textMessage("msg_prompt", "user", "tell me about the anzacs"),
          textMessage("msg_reply", "assistant", "Experimental ANZAC reply", true),
        )
      },
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    writeFileSync(handoffFile("ses_exp_origin_a"), `${JSON.stringify({
      type: "experimental-btw",
      version: 3,
      mode: "btw.open",
      originSessionID: "ses_exp_origin_a",
      prompt: "tell me about the anzacs",
    })}\n`)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    expect(kv.get("opencode-bytheway.active")).toEqual({
      origin: "ses_exp_origin_a",
      temp: "ses_btw",
      baseCount: 2,
    })
    expect(prompted()).toEqual({
      sessionID: "ses_btw",
      parts: [{ type: "text", text: "tell me about the anzacs" }],
    })
    expect(nav.at(-1)).toEqual({ name: "session", params: { sessionID: "ses_btw" } })
    expect(views).toEqual([])
    expect(() => readFileSync(handoffFile("ses_exp_origin_a"), "utf8")).toThrow()
    rmSync(handoffFile("ses_exp_origin_a"), { force: true })
  })

  test("ignores the experimental handoff when it belongs to a different origin session", async () => {
    rmSync(handoffFile("ses_exp_origin_b"), { force: true })
    const { api, kv, nav, prompted, rows, views } = setup({ sessionID: "ses_exp_origin_b" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    writeFileSync(handoffFile("ses_exp_origin_b"), `${JSON.stringify({
      type: "experimental-btw",
      version: 3,
      mode: "btw.open",
      originSessionID: "ses_other_origin",
      prompt: "tell me about the anzacs",
    })}\n`)

    cmd(rows(), "btw.open").onSelect()
    await tick()

    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_exp_origin_b", temp: "ses_btw", baseCount: 0 })
    expect(prompted()).toBeUndefined()
    expect(nav.at(-1)).toEqual({ name: "session", params: { sessionID: "ses_btw" } })
    expect(views.at(-1)?.props?.title).toBe("Entered /btw Session")
    expect(JSON.parse(readFileSync(handoffFile("ses_exp_origin_b"), "utf8"))).toMatchObject({
      type: "experimental-btw",
      version: 3,
      mode: "btw.open",
      originSessionID: "ses_other_origin",
      prompt: "tell me about the anzacs",
    })
    rmSync(handoffFile("ses_exp_origin_b"), { force: true })
  })

  test("ends btw session, returns to origin, and deletes temp", async () => {
    const { api, calls, kv, nav, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    cmd(rows(), "btw.end").onSelect()
    await tick()

    expect(calls).toEqual(["get", "children", "messages", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
  })

  test("rehydrates btw state from the current temp session", async () => {
    const { api, calls, kv, nav, rows } = setup({ sessionID: "ses_btw" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.end").onSelect()
    await tick()

    expect(calls).toEqual(["get", "delete"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_main" } }])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
  })

  test("keeps btw state when temp-session deletion returns an error", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({ deleteError: new Error("nope") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    cmd(rows(), "btw.open").onSelect()
    await tick()
    await tick()

    cmd(rows(), "btw.end").onSelect()
    await tick()

    expect(calls).toEqual(["get", "children", "messages", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 0 })
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

    expect(calls).toEqual(["get", "children", "messages", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 0 })
    expect(toasts.at(-1)).toEqual({
      variant: "error",
      message: "Returned from /btw, but failed to delete the temp session.",
    })
  })
})
