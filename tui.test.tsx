import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import packageJson from "./package.json" with { type: "json" }
import { COMMAND_ENV, PLUGIN_ID } from "./protocol.js"
import plugin, { indicator, sessiontitle } from "./tui"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const version = packageJson.version
const tempMetadata = (origin: string) => ({
  [PLUGIN_ID]: {
    type: "temp",
    origin,
    version: 1,
  },
})

function expectOriginState(value: unknown, origin: string, temp = "ses_btw") {
  expect(value).toMatchObject({ origin, temp })
  expect(typeof (value as any)?.originTime).toBe("number")
}

function expectFastState(value: unknown, origin: string, temp = "ses_btw") {
  expectOriginState(value, origin, temp)
  expect(typeof (value as any)?.baseTime).toBe("number")
}

const env = () =>
  (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env ?? {}

function cmd(rows: any[], value: string) {
  return rows.find((row) => row.btwCommand === value || row.name === value)
}

async function select(rows: any[], value: string) {
  await cmd(rows, value).onSelect()
}

function textMessage(id: string, role: "user" | "assistant", text: string, completed?: boolean, created = 1) {
  return {
    info:
      role === "assistant"
        ? {
            id,
            role,
            parentID: `${id}_parent`,
            time: completed ? { created, completed: created + 1 } : { created },
            finish: completed ? "stop" : undefined,
          }
        : {
            id,
            role,
            time: { created },
          },
    parts: [{ id: `${id}_part`, type: "text", text }],
  }
}

function largeSourceMessages(count = 501) {
  return Array.from({ length: count }, (_, index) =>
    textMessage(`msg_large_${index}`, index % 2 === 0 ? "user" : "assistant", `message ${index}`, index % 2 === 1),
  )
}

function setup(input?: {
  session?: boolean
  sessionID?: string
  createError?: Error
  createIDs?: string[]
  listSessions?: any[]
  listError?: Error
  updateError?: Error
  forkError?: Error
  forkIDs?: string[]
  sourceTail?: boolean
  sourceBlank?: boolean
  originMessages?: any[]
  tempMessages?: any[]
  currentSession?: any
  getSessions?: Record<string, any>
  missingSessions?: string[]
  childSessions?: any[]
  deleteError?: Error
  deleteReject?: Error
  promptError?: Error
  promptAsyncError?: Error
  promptResult?: unknown
  onPrompt?: (args: Record<string, unknown>) => void
}) {
  const calls: string[] = []
  const toasts: Array<Record<string, unknown>> = []
  const views: any[] = []
  const nav: any[] = []
  const slots: any[] = []
  const keymapLayers: any[] = []
  const kv = new Map<string, unknown>()
  const events = new Map<string, Array<(event: any) => void>>()
  const dispatchCommand = (name: string) => {
    const command = keymapLayers
      .flatMap((layer) => layer?.commands ?? [])
      .find((row) => row?.name === name)
    return command?.run?.()
  }
  let creates = 0
  let forks = 0
  let created: Record<string, unknown> | undefined
  let updated: Record<string, unknown> | undefined
  let fork: Record<string, unknown> | undefined
  let prompted: Record<string, unknown> | undefined
  let appended: Record<string, unknown> | undefined
  const originSessionID = input?.sessionID ?? "ses_main"
  let route: any =
    input?.session === false
      ? { name: "home" }
      : { name: "session", params: { sessionID: originSessionID } }
  const expectFlatParams = (args: Record<string, unknown> | undefined, allowed: string[], required: string[] = []) => {
    expect(args?.path).toBeUndefined()
    expect(args?.body).toBeUndefined()
    expect(args?.query).toBeUndefined()
    for (const key of Object.keys(args ?? {})) expect(allowed).toContain(key)
    for (const key of required) expect(args?.[key]).toBeDefined()
  }
  const api: any = {
    command: {
      register(cb: () => any[]) {
        keymapLayers.push({ commands: cb() })
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
    keymap: {
      registerLayer(input: unknown) {
        keymapLayers.push(input)
        return () => {
          const index = keymapLayers.indexOf(input)
          if (index >= 0) keymapLayers.splice(index, 1)
        }
      },
      dispatchCommand,
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
      DialogConfirm: (props: Record<string, unknown>) => ({ type: "confirm", props }),
      Prompt: (props: Record<string, unknown>) => ({ type: "prompt", props }),
      Slot: (props: Record<string, unknown>) => ({ type: "slot", props }),
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
        async create(args?: Record<string, unknown>) {
          calls.push("create")
          created = args
          expectFlatParams(args, [])
          const id = input?.createIDs?.[creates] ?? "ses_main"
          creates += 1
          if (input?.createError) return { error: input.createError }
          return { data: { id } }
        },
        async messages(args: Record<string, unknown>) {
          calls.push("messages")
          expectFlatParams(args, ["sessionID"], ["sessionID"])
          if (args.sessionID !== originSessionID) return { data: input?.tempMessages ?? [] }
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
        async list(args: Record<string, unknown>) {
          calls.push("list")
          expectFlatParams(args, ["roots", "limit"])
          if (input?.listError) return { error: input.listError }
          return { data: input?.listSessions ?? [] }
        },
        async fork(args: Record<string, unknown>, options?: Record<string, unknown>) {
          calls.push("fork")
          fork = args
          expect(options).toEqual({ throwOnError: true })
          expectFlatParams(args, ["sessionID", "messageID"], ["sessionID"])
          const id = input?.forkIDs?.[forks] ?? "ses_btw"
          forks += 1
          if (input?.forkError) throw input.forkError
          return { data: { id } }
        },
        async update(args: Record<string, unknown>) {
          calls.push("update")
          updated = args
          expectFlatParams(args, ["sessionID", "title", "metadata"], ["sessionID"])
          if (input?.updateError) return { error: input.updateError }
          return { data: undefined }
        },
        async get(args: Record<string, unknown>) {
          calls.push("get")
          expectFlatParams(args, ["sessionID"], ["sessionID"])
          if (input?.missingSessions?.includes(String(args.sessionID))) {
            return { error: new Error("Session not found") }
          }
          if (input?.getSessions?.[String(args.sessionID)]) {
            return { data: input.getSessions[String(args.sessionID)] }
          }
          if (input?.currentSession) return { data: input.currentSession }
          return {
            data:
              args.sessionID === "ses_btw"
                ? { id: "ses_btw", title: "/btw session", time: { updated: 2 } }
                : { id: args.sessionID, title: "main", time: { updated: 1 } },
          }
        },
        async children(args: Record<string, unknown>) {
          calls.push("children")
          expectFlatParams(args, ["sessionID"], ["sessionID"])
          return { data: input?.childSessions ?? [] }
        },
        async prompt(args: Record<string, unknown>) {
          calls.push("prompt")
          prompted = args
          expectFlatParams(args, ["sessionID", "noReply", "parts"], ["sessionID"])
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
        async delete(args: Record<string, unknown>) {
          calls.push("delete")
          expectFlatParams(args, ["sessionID"], ["sessionID"])
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
    keymapLayers,
    kv,
    nav,
    prompted: () => prompted,
    rows() {
      return keymapLayers
        .flatMap((layer) => layer?.commands ?? [])
        .filter((row) => row?.namespace === "palette")
        .map((row) => ({
          ...row,
          hidden: typeof row.hidden === "function" ? row.hidden() : row.hidden,
          suggested: typeof row.suggested === "function" ? row.suggested() : row.suggested,
        }))
    },
    emit(type: string, properties: Record<string, unknown>) {
      for (const handler of events.get(type) ?? []) handler({ type, properties })
    },
    slot(name: string) {
      return slots.find((item) => item?.slots?.[name])
    },
    slashRows() {
      return keymapLayers
        .flatMap((layer) => layer?.commands ?? [])
        .filter((row) => row?.namespace === "palette" && typeof row.slashName === "string")
        .filter((row) => (typeof row.hidden === "function" ? !row.hidden() : row.hidden !== true))
        .map((row) => ({ display: `/${row.slashName}`, commandName: row.name, onSelect: () => dispatchCommand(row.name) }))
    },
    toasts,
    updated: () => updated,
    views,
  }
}

describe("opencode-bytheway tui plugin", () => {
  test("exports the TUI runtime plugin id", () => {
    expect(plugin.id).toBe(PLUGIN_ID)
  })

  test("registers TUI command handlers with slash autocomplete metadata", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(rows()).toHaveLength(5)
    expect(cmd(rows(), "btw.open")?.name).toBe("btw")
    expect(cmd(rows(), "btw.merge")?.name).toBe("btw-merge")
    expect(cmd(rows(), "btw.end")?.name).toBe("btw-end")
    expect(cmd(rows(), "btw.status")?.name).toBe("btw-status")
    expect(cmd(rows(), "btw.prompt")?.name).toBe("btw-prompt")
    expect(cmd(rows(), "btw.open")?.slash).toEqual({ name: "btw" })
    expect(cmd(rows(), "btw.merge")?.slash).toEqual({ name: "btw-merge" })
    expect(cmd(rows(), "btw.end")?.slash).toEqual({ name: "btw-end" })
    expect(cmd(rows(), "btw.status")?.slash).toEqual({ name: "btw-status" })
    expect(cmd(rows(), "btw.prompt")?.slash).toEqual({ name: "btw-prompt" })
    expect(cmd(rows(), "btw.popup")).toBeUndefined()
  })

  test("does not bind Enter for non-btw prompt slash commands", async () => {
    const { api, keymapLayers, slot } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    const layer = keymapLayers.find((item) => item?.bindings?.some((binding: any) => binding.key === "return"))
    expect(layer).toBeTruthy()
    expect(layer.mode).toBe("base")

    const prompt: any = {
      focused: true,
      current: { input: "/sessions", parts: [] },
      set() {},
      reset() {},
      blur() {},
      focus() {},
      submit() {},
    }
    const rendered = slot("session_prompt").slots.session_prompt({}, { session_id: "ses_main" })
    rendered.props.ref(prompt)

    expect(layer.enabled()).toBe(false)
    prompt.current.input = "/btw this is a topic"
    expect(layer.enabled()).toBe(true)
    prompt.current.input = "/btw-status"
    expect(layer.enabled()).toBe(true)
    prompt.current.input = "/btw-prompt investigate this"
    expect(layer.enabled()).toBe(true)
    prompt.current.input = "/help"
    expect(layer.enabled()).toBe(false)
    prompt.focused = false
    prompt.current.input = "/btw another topic"
    expect(layer.enabled()).toBe(false)
  })

  test("handles /btw-prompt as a TUI prompt command", async () => {
    const { api, keymapLayers, nav, prompted, slot } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    const layer = keymapLayers.find((item) => item?.bindings?.some((binding: any) => binding.key === "return"))
    expect(layer).toBeTruthy()

    let resets = 0
    const prompt: any = {
      focused: true,
      current: { input: "/btw-prompt investigate this", parts: [] },
      set() {},
      reset() {
        resets += 1
        prompt.current.input = ""
      },
      blur() {},
      focus() {},
      submit() {},
    }
    const rendered = slot("session_prompt").slots.session_prompt({}, { session_id: "ses_main" })
    rendered.props.ref(prompt)

    expect(layer.enabled()).toBe(true)
    expect(layer.commands[0].run()).toBe(true)
    for (let i = 0; i < 5; i++) await tick()

    expect(resets).toBe(1)
    expect(nav.at(-1)).toEqual({ name: "session", params: { sessionID: "ses_btw" } })
    expect(prompted()).toEqual({
      sessionID: "ses_btw",
      parts: [{ type: "text", text: "investigate this" }],
    })
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
    expect(rendered.captureCharFrame()).toContain("Run /btw-end to return to the original session as it is now")
  })

  test("only shows the indicator for the active btw temp session", () => {
    expect(indicator("ses_main", undefined)).toBeUndefined()
    expect(indicator("ses_main", { origin: "ses_root", temp: "ses_btw" } as any)).toBeUndefined()
    expect(indicator("ses_btw", { origin: "ses_main", temp: "ses_btw" } as any)).toEqual({
      title: "/btw session active",
      detail: "Run /btw-end to return to the original session as it is now",
    })
    expect(sessiontitle()).toBe("/btw session")
  })

  test("clears persisted btw state when resuming directly into a saved temp session", async () => {
    const { api, kv, rows, slashRows, slot } = setup({ sessionID: "ses_btw" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw", baseCount: 2 })

    expect(slot("sidebar_content")?.slots?.sidebar_content({}, { session_id: "ses_btw" })).toBeNull()
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
    expect(cmd(rows(), "btw.open")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.merge")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(true)
    expect(slashRows().map((row) => row.display)).not.toContain("/btw-end")
  })

  test("derives slash command names from OPENCODE_BYTHEWAY_COMMAND", async () => {
    const prev = env()[COMMAND_ENV]
    env()[COMMAND_ENV] = "aside"

    try {
      const { api, rows, views } = setup()
      await plugin.tui(api, undefined, { state: "first" } as any)

      expect(cmd(rows(), "btw.open")?.slash).toEqual({ name: "aside" })
      expect(cmd(rows(), "btw.open")?.name).toBe("aside")
      expect(cmd(rows(), "btw.merge")?.slash).toEqual({ name: "aside-merge" })
      expect(cmd(rows(), "btw.merge")?.name).toBe("aside-merge")
      expect(cmd(rows(), "btw.end")?.slash).toEqual({ name: "aside-end" })
      expect(cmd(rows(), "btw.end")?.name).toBe("aside-end")
      expect(cmd(rows(), "btw.status")?.slash).toEqual({ name: "aside-status" })
      expect(cmd(rows(), "btw.status")?.name).toBe("aside-status")
      expect(cmd(rows(), "btw.prompt")?.slash).toEqual({ name: "btw-prompt" })
      expect(cmd(rows(), "btw.prompt")?.name).toBe("btw-prompt")
      expect(indicator("ses_btw", { origin: "ses_main", temp: "ses_btw" } as any)).toEqual({
        title: "/aside session active",
        detail: "Run /aside-end to return to the original session as it is now",
      })
      expect(sessiontitle()).toBe("/aside session")

      await select(rows(), "btw.open")
      await tick()
      await tick()

      expect(views.at(-1)?.props?.title).toBe("Entered /aside Session")
      expect(views.at(-1)?.props?.message).toContain("Run /aside-end to return to your original session in its current state at return time")
    } finally {
      if (prev === undefined) delete env()[COMMAND_ENV]
      else env()[COMMAND_ENV] = prev
    }
  })

  test("registers btw.status in the TUI command palette", async () => {
    const { api, rows, toasts } = setup({ sessionID: "ses_status" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    expect(cmd(rows(), "btw.status")?.slash).toEqual({ name: "btw-status" })

    await select(rows(), "btw.status")
    await tick()
    await tick()

    expect(toasts).toEqual([
      {
        title: "opencode-bytheway",
        message: `opencode-bytheway ${version} is loaded.\nmode: TUI plugin only\nsession: ses_status`,
        variant: "info",
        duration: 6000,
      },
    ])
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

  test("shows /btw and hides /btw-end on the origin session of an active btw state", async () => {
    const { api, kv, rows } = setup({ sessionID: "ses_main" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw", baseCount: 2 })

    expect(cmd(rows(), "btw.open")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.merge")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(true)
  })

  test("resumes an existing active btw temp session from the origin", async () => {
    const { api, calls, kv, nav, rows } = setup({ sessionID: "ses_main" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw", baseCount: 2 })

    await select(rows(), "btw.open")
    await tick()

    expect(calls).toEqual(["get"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 2 })
  })

  test("clears active btw state from a different origin before opening", async () => {
    const { api, calls, fork, kv, nav, rows } = setup({ sessionID: "ses_other" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw", baseCount: 2 })

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(calls).toEqual(["fork", "update"])
    expect(fork()).toEqual({ sessionID: "ses_other", messageID: undefined })
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_other")
  })

  test("clears stale active btw state and opens a new temp session", async () => {
    const { api, calls, kv, nav, rows } = setup({ sessionID: "ses_main", missingSessions: ["ses_btw"] })
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw", baseCount: 2 })

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(calls).toEqual(["get", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
  })

  test("creates an origin session when opening /btw from home", async () => {
    const { api, calls, created, fork, kv, nav, rows, updated } = setup({ session: false, listSessions: [{ id: "ses_main" }] })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(created()).toBeUndefined()
    expect(fork()).toEqual({ sessionID: "ses_main", messageID: undefined })
    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session", metadata: tempMetadata("ses_main") })
    expect(calls).toEqual(["list", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
  })

  test("continues into /btw when session title labeling fails", async () => {
    const { api, calls, kv, nav, rows, updated } = setup({ updateError: new Error("update failed") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session", metadata: tempMetadata("ses_main") })
    expect(calls).toEqual(["list", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
  })

  test("shows an error toast when creating the origin session fails", async () => {
    const { api, nav, rows, toasts } = setup({ session: false, createError: new Error("create failed") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()

    expect(toasts.at(-1)).toEqual({ variant: "error", message: "create failed" })
    expect(nav).toEqual([])
  })

  test("bare /btw skips the source message pre-scan", async () => {
    const { api, fork, rows } = setup({ sourceTail: true })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(fork()).toEqual({ sessionID: "ses_main", messageID: undefined })
  })

  test("forks the full session when no completed boundary exists", async () => {
    const { api, calls, fork, rows } = setup({ sourceBlank: true })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(fork()).toEqual({ sessionID: "ses_main", messageID: undefined })
    expect(calls).toEqual(["list", "fork", "update"])
  })

  test("does not block large source sessions before forking", async () => {
    const sourceID = "ses_large_source"
    const { api, calls, fork, kv, nav, rows, toasts } = setup({
      sessionID: sourceID,
      originMessages: largeSourceMessages(),
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(fork()).toEqual({ sessionID: sourceID, messageID: undefined })
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), sourceID)
    expect(calls).toEqual(["list", "fork", "update"])
    expect(toasts).toEqual([])
  })

  test("shows an error toast when opening /btw fails", async () => {
    const { api, kv, nav, rows, toasts } = setup({ forkError: new Error("fork failed") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()

    expect(toasts.at(-1)).toEqual({ variant: "error", message: "fork failed" })
    expect(nav).toEqual([])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
  })

  test("uses the newest root session when fork succeeds but returns an empty response", async () => {
    const { api, calls, kv, nav, rows, updated } = setup({
      forkError: new Error("Expected object, got null"),
      listSessions: [
        { id: "ses_btw", title: "main", time: { created: Date.now() + 1000, updated: Date.now() + 1000 } },
        { id: "ses_main", title: "main", time: { updated: 1 } },
      ],
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session", metadata: tempMetadata("ses_main") })
    expect(calls).toEqual(["list", "fork", "list", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
  })

  test("opens a btw side session and records origin/temp", async () => {
    const { api, calls, kv, nav, rows, updated } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()

    expect(updated()).toEqual({ sessionID: "ses_btw", title: "/btw session", metadata: tempMetadata("ses_main") })
    expect(calls).toEqual(["list", "fork", "update"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
  })

  test("shows a btw entry message with exit instructions", async () => {
    const { api, rows, views } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(views.at(-1)?.type).toBe("alert")
    expect(views.at(-1)?.props?.title).toBe("Entered /btw Session")
    expect(views.at(-1)?.props?.message).toContain("Run /btw-end to return to your original session in its current state at return time")
  })

  test("shows /btw-merge and /btw-end while inside an active btw session", async () => {
    const { api, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(cmd(rows(), "btw.open")?.hidden).toBe(true)
    expect(cmd(rows(), "btw.merge")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.merge")?.suggested).toBe(true)
    expect(cmd(rows(), "btw.end")?.hidden).toBe(false)
    expect(cmd(rows(), "btw.end")?.suggested).toBeUndefined()
  })

  test("slash completion dispatches /btw-end instead of /btw inside an active btw session", async () => {
    const { api, kv, nav, rows, slashRows, toasts } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    expect(slashRows().map((row) => row.display)).not.toContain("/btw")
    const end = slashRows().find((row) => row.display === "/btw-end")
    expect(end?.commandName).toBe("btw-end")

    end?.onSelect()
    await tick()

    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
    expect(toasts.at(-1)).toEqual({ variant: "info", message: "Returned to the original session as it is now." })
  })

  test("warns when ending without an active btw session", async () => {
    const { api, calls, nav, rows, toasts } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.end")
    await tick()

    expect(calls).toEqual(["list"])
    expect(nav).toEqual([])
    expect(toasts.at(-1)).toEqual({ variant: "warning", message: "No active /btw session." })
  })

  test("warns when ending from outside the active btw temp session", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({ sessionID: "ses_main" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    kv.set("opencode-bytheway.active", { origin: "ses_main", temp: "ses_btw", baseCount: 2 })

    await select(rows(), "btw.end")
    await tick()

    expect(calls).toEqual([])
    expect(nav).toEqual([])
    expect(kv.get("opencode-bytheway.active")).toEqual({ origin: "ses_main", temp: "ses_btw", baseCount: 2 })
    expect(toasts.at(-1)).toEqual({
      variant: "warning",
      message: "Run /btw-end from inside the active /btw session.",
    })
  })

  test("merges btw text back into the origin session and deletes temp", async () => {
    const created = Date.now() + 60_000
    const { api, calls, kv, nav, prompted, rows, toasts } = setup({
      tempMessages: [
        textMessage("msg_user", "user", "keep this note", false, created),
        textMessage("msg_assistant", "assistant", "here is the answer", true, created + 1),
        {
          info: { id: "msg_tool", role: "assistant", parentID: "msg_user", time: { created: created + 2 } },
          parts: [{ id: "prt_tool", type: "tool", tool: "bash", state: { status: "completed" } }],
        },
      ],
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    await select(rows(), "btw.merge")
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "get", "messages", "prompt", "delete"])
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
    expect(toasts.at(-1)).toEqual({ variant: "info", message: "Merged back into the original session as it is now." })
  })

  test("confirms before merging when the origin session advanced", async () => {
    const created = Date.now() + 60_000
    const { api, calls, nav, prompted, rows, views } = setup({
      currentSession: { id: "ses_main", title: "main", time: { updated: Date.now() + 120_000 } },
      tempMessages: [
        textMessage("msg_user", "user", "keep this note", false, created),
        textMessage("msg_assistant", "assistant", "here is the answer", true, created + 1),
      ],
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    await select(rows(), "btw.merge")
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "get"])
    expect(views.at(-1)?.type).toBe("confirm")
    expect(views.at(-1)?.props?.title).toBe("Merge /btw into updated origin?")
    expect(views.at(-1)?.props?.message).toContain("The original session continued")
    expect(prompted()).toBeUndefined()
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])

    views.at(-1)?.props?.onConfirm()
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "get", "messages", "prompt", "delete"])
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
    expect(nav.at(-1)).toEqual({ name: "session", params: { sessionID: "ses_main" } })
  })

  test("returns without prompting when there is no new mergeable text", async () => {
    const created = Date.now() + 60_000
    const { api, calls, kv, nav, prompted, rows, toasts } = setup({
      tempMessages: [
        {
          info: { id: "msg_tool", role: "assistant", parentID: "msg_user", time: { created } },
          parts: [{ id: "prt_tool", type: "tool", tool: "bash", state: { status: "completed" } }],
        },
      ],
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    await select(rows(), "btw.merge")
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "get", "messages", "delete"])
    expect(prompted()).toBeUndefined()
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
    expect(toasts.at(-1)).toEqual({
      variant: "info",
      message: "No new text to merge. Returned to the original session as it is now.",
    })
  })

  test("keeps the active btw session when merge append fails", async () => {
    const created = Date.now() + 60_000
    const { api, calls, kv, nav, rows, toasts } = setup({
      tempMessages: [textMessage("msg_assistant", "assistant", "here is the answer", true, created)],
      promptError: new Error("prompt failed"),
    })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    await select(rows(), "btw.merge")
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "get", "messages", "prompt"])
    expect(nav).toEqual([{ name: "session", params: { sessionID: "ses_btw" } }])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
    expect(toasts.at(-1)).toEqual({ variant: "error", message: "prompt failed" })
  })

  test("warns when trying to open /btw from inside the active btw session", async () => {
    const { api, rows, toasts } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    await select(rows(), "btw.open")
    await tick()
    expect(toasts.at(-1)?.message).toBe("Already inside a /btw session. Run /btw-end to return to the original session as it is now.")
  })

  test("ends btw session, returns to origin, and deletes temp", async () => {
    const { api, calls, kv, nav, rows } = setup()
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    await select(rows(), "btw.end")
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
  })

  test("does not rehydrate subagent sessions as active btw state", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({ sessionID: "ses_btw" })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.end")
    await tick()

    expect(calls).toEqual(["list"])
    expect(nav).toEqual([])
    expect(kv.get("opencode-bytheway.active")).toBeUndefined()
    expect(toasts.at(-1)).toEqual({ variant: "warning", message: "No active /btw session." })
  })

  test("keeps btw state when temp-session deletion returns an error", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({ deleteError: new Error("nope") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()
    await tick()

    await select(rows(), "btw.end")
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
    expect(toasts.at(-1)).toEqual({
      variant: "error",
      message: "Returned to the original session as it is now, but failed to delete the temp session.",
    })
  })

  test("keeps btw state when temp-session deletion rejects", async () => {
    const { api, calls, kv, nav, rows, toasts } = setup({ deleteReject: new Error("boom") })
    await plugin.tui(api, undefined, { state: "first" } as any)

    await select(rows(), "btw.open")
    await tick()

    await select(rows(), "btw.end")
    await tick()

    expect(calls).toEqual(["list", "fork", "update", "delete"])
    expect(nav).toEqual([
      { name: "session", params: { sessionID: "ses_btw" } },
      { name: "session", params: { sessionID: "ses_main" } },
    ])
    expectFastState(kv.get("opencode-bytheway.active"), "ses_main")
    expect(toasts.at(-1)).toEqual({
      variant: "error",
      message: "Returned to the original session as it is now, but failed to delete the temp session.",
    })
  })
})
