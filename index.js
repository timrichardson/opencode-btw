import { writeFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"

const HANDOFF_FILE = "/tmp/opencode-bytheway-handoff.json"
const EXPERIMENTAL_BTW_HANDLED = "__OPENCODE_BYTHEWAY_EXPERIMENTAL_BTW_HANDLED__"

const slashbase = () => {
  const env = (globalThis.process?.env ?? {})
  const value = env.OPENCODE_BYTHEWAY_COMMAND?.trim().replace(/^\/+/, "").toLowerCase()
  if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) return "btw"
  return value
}

const openname = () => slashbase()

const statuscmd = {
  description: "Check whether the opencode-bytheway plugin is loaded",
  agent: "general",
  template: "Call the btw_status tool and return its output.",
}

const experimentalcmd = {
  description: "Experimental: open a temporary by-the-way session and hand its initial prompt to the TUI",
  template: "/experimental-btw",
}

const experimentaltitle = () => `/${openname()} experimental session`

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

const serialize = (value) => JSON.stringify(value, null, 2)

const writehandoff = async (originSessionID, tempSessionID, prompt) => {
  await writeFile(
    HANDOFF_FILE,
    `${serialize({
      type: "experimental-btw",
      version: 2,
      originSessionID: originSessionID ?? null,
      tempSessionID,
      prompt,
      time: new Date().toISOString(),
    })}\n`,
    "utf8",
  )
}

const sessionmessages = async (client, sessionID) => {
  if (!sessionID) return []
  const list = await client.session.messages({ sessionID, limit: 1000 }).catch(() => undefined)
  return list?.data ?? []
}

const enter = async (client, sessionID, prompt) => {
  const temp = (await client.session.create({})).data?.id
  if (!temp) throw new Error("Failed to create a temporary session.")

  const copied = contexttext(await sessionmessages(client, sessionID))
  if (copied) {
    const injected = await client.session.prompt({
      path: { id: temp },
      body: {
        noReply: true,
        parts: [{ type: "text", text: copied }],
      },
    })
    if (injected.error) throw injected.error
  }

  await writehandoff(sessionID, temp, typeof prompt === "string" ? prompt : "")
  await client.session.update({ sessionID: temp, title: experimentaltitle() }).catch(() => undefined)

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
          return ["opencode-bytheway is loaded.", `session: ${ctx.sessionID ?? "<none>"}`].join("\n")
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
      if (input.command !== "experimental-btw") return
      if (!client) throw new Error("OpenCode client unavailable.")
      await enter(client, input.sessionID, input.arguments)
      throw new Error(EXPERIMENTAL_BTW_HANDLED)
    },
  }),
}
