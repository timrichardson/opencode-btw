import { appendFile, writeFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"

const EXPERIMENTAL_BTW_HANDLED = "__OPENCODE_BYTHEWAY_EXPERIMENTAL_BTW_HANDLED__"
const BTW_STATUS_HANDLED = "__OPENCODE_BYTHEWAY_BTW_STATUS_HANDLED__"
const HANDOFF_FILE = "/tmp/opencode-bytheway-handoff.json"
const SERVER_LOG_FILE = "/tmp/opencode-bytheway-server.log"
const RUNTIME_MARKER = "server-file-handoff-prompt-v1"

const slashbase = () => {
  const env = (globalThis.process?.env ?? {})
  const value = env.OPENCODE_BYTHEWAY_COMMAND?.trim().replace(/^\/+/, "").toLowerCase()
  if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) return "btw"
  return value
}

const openname = () => slashbase()

const statuscmd = {
  description: "Check whether the opencode-bytheway plugin is loaded",
  template: "/btw-status",
}

const experimentalcmd = {
  description: "Experimental: open a temporary by-the-way session and hand its initial prompt to the TUI",
  template: "/experimental-btw",
}

const experimentaltitle = () => `/${openname()} experimental session`

const statustext = (sessionID) => ["opencode-bytheway is loaded.", `session: ${sessionID ?? "<none>"}`].join("\n")

const collecttext = (parts = []) =>
  parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")

const contexttext = (items = []) => {
  const turns = items
    .map((item) => {
      const text = collecttext(item.parts)
      if (!text) return
      const role = item.info?.role === "assistant" ? "Assistant" : "User"
      return `${role}:\n${text}`
    })
    .filter(Boolean)

  if (!turns.length) return ""
  return [
    "Copied plain-text context from the original session.",
    "Only user and assistant text is included below. Tool calls and hidden reasoning are omitted.",
    "Use it as conversation context for the next prompt.",
    "",
    turns.join("\n\n"),
  ].join("\n")
}

const logserver = (stage, data = {}) => {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    runtimeMarker: RUNTIME_MARKER,
    stage,
    ...data,
  })
  return appendFile(SERVER_LOG_FILE, `${line}\n`, "utf8").catch(() => undefined)
}

const serialize = (value) => JSON.stringify(value, null, 2)

const writehandoff = async (originSessionID, tempSessionID, prompt) => {
  const payload = {
    type: "experimental-btw",
    version: 2,
    originSessionID: originSessionID ?? null,
    tempSessionID,
    prompt,
    time: new Date().toISOString(),
  }
  await writeFile(HANDOFF_FILE, `${serialize(payload)}\n`, "utf8")
  await logserver("handoff.write", {
    originSessionID: payload.originSessionID,
    tempSessionID,
    promptLength: prompt.length,
  })
}

const sessionmessages = async (client, sessionID) => {
  if (!sessionID) return []
  const list = await client.session.messages({ sessionID, limit: 1000 }).catch(() => undefined)
  return list?.data ?? []
}

const enter = async (client, sessionID, prompt) => {
  await logserver("experimental.enter:start", {
    originSessionID: sessionID ?? null,
    promptLength: typeof prompt === "string" ? prompt.length : 0,
  })
  const created = await client.session.create({})
  const temp = created.data?.id
  if (created.error || !temp) throw created.error ?? new Error("Failed to create a temporary session.")
  await logserver("experimental.enter:created", {
    originSessionID: sessionID ?? null,
    tempSessionID: temp,
  })

  const copied = contexttext(await sessionmessages(client, sessionID))
  await logserver("experimental.enter:context", {
    tempSessionID: temp,
    copiedLength: copied.length,
    copiedPreview: copied.slice(0, 120),
  })
  if (copied) {
    const injected = await client.session.prompt({
      path: { id: temp },
      body: {
        noReply: true,
        parts: [{ type: "text", text: copied }],
      },
    })
    if (injected.error) throw injected.error
    await logserver("experimental.enter:context_injected", { tempSessionID: temp })
  }

  const text = typeof prompt === "string" ? prompt : ""
  await writehandoff(sessionID, temp, text)
  await client.session.update({ sessionID: temp, title: experimentaltitle() }).catch(() => undefined)
  await logserver("experimental.enter:labeled", { tempSessionID: temp, title: experimentaltitle() })

  await logserver("experimental.enter:done", {
    originSessionID: sessionID ?? null,
    tempSessionID: temp,
    promptLength: text.length,
  })

  return ""
}

export default {
  id: "opencode-bytheway",
  server: async ({ client } = {}) => ({
    tool: {
      btw_status: tool({
        description: "Report plugin status for local development",
        args: {},
        async execute(_, ctx) {
          return statustext(ctx.sessionID)
        },
      }),
      opencode_bytheway_plugin_open: tool({
        description: "Open a temporary by-the-way session and hand its initial prompt to the TUI",
        args: {
          prompt: tool.schema.string().optional(),
        },
        async execute(args, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await enter(client, ctx.sessionID, args.prompt ?? "")
        },
      }),
      opencode_bytheway_plugin_select_temp: tool({
        description: "Select an existing temporary by-the-way session in the TUI",
        args: {
          sessionID: tool.schema.string(),
        },
        async execute(args) {
          if (!client) throw new Error("OpenCode client unavailable.")
          const selected = await client.tui.selectSession({ sessionID: args.sessionID })
          if (selected?.error) throw selected.error
          return ""
        },
      }),
    },
    async config(cfg) {
      cfg.command = {
        "experimental-btw": experimentalcmd,
        "btw-status": statuscmd,
        ...cfg.command,
      }
    },
    "command.execute.before": async (input) => {
      if (input.command === "btw-status") {
        if (!client) throw new Error("OpenCode client unavailable.")
        const message = statustext(input.sessionID)
        await client.tui.showToast({
          title: "opencode-bytheway",
          message,
          variant: "info",
          duration: 6000,
        }).catch(() => undefined)
        throw new Error(BTW_STATUS_HANDLED)
      }
      if (input.command !== "experimental-btw") return
      if (!client) throw new Error("OpenCode client unavailable.")
      await logserver("command.execute.before", {
        command: input.command,
        originSessionID: input.sessionID ?? null,
        promptLength: typeof input.arguments === "string" ? input.arguments.length : 0,
      })
      await enter(client, input.sessionID, input.arguments)
      throw new Error(EXPERIMENTAL_BTW_HANDLED)
    },
  }),
}
