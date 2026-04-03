import { tool } from "@opencode-ai/plugin"

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

const opencmd = {
  description: "Open a temporary by-the-way session, optionally with an initial prompt",
  agent: "general",
  template: [
    "Call the btw_open tool.",
    "Pass the full command arguments as the prompt field exactly as written.",
    "If there are no arguments, pass an empty string.",
    "After the tool call, do not add any extra text.",
  ].join(" "),
}

const sessiontitle = () => `/${openname()} session`

const cutoff = async (client, sessionID) => {
  const list = await client.session.messages({ sessionID, limit: 1000 }).catch(() => undefined)
  if (!list?.data?.length) return { mode: "all", count: 0 }

  let last = -1
  for (let i = list.data.length - 1; i >= 0; i--) {
    const item = list.data[i].info
    if (item.role !== "assistant") continue
    if (!item.time.completed) continue
    if (!item.finish || ["tool-calls", "unknown"].includes(item.finish)) continue
    last = i
    break
  }

  if (last < 0) return { mode: "all", count: list.data.length }
  const next = list.data[last + 1]?.info.id
  if (!next) return { mode: "all", count: list.data.length }
  return { mode: "cut", count: list.data.length, messageID: next }
}

const enter = async (client, sessionID, prompt) => {
  const source = sessionID || (await client.session.create({})).data?.id
  if (!source) throw new Error("Failed to create a new session.")

  const cut = await cutoff(client, source)
  const next = await client.session.fork({
    sessionID: source,
    ...(cut.mode === "cut" ? { messageID: cut.messageID } : {}),
  })
  if (next.error || !next.data?.id)
    throw next.error ?? new Error("Failed to create temporary session.")

  const temp = next.data.id
  await client.session.update({ sessionID: temp, title: sessiontitle() }).catch(() => undefined)

  const text = prompt.trim()
  if (text) {
    const seeded = await client.session.promptAsync({
      sessionID: temp,
      parts: [{ type: "text", text }],
    })
    if (seeded.error) throw seeded.error
  }

  const selected = await client.tui.selectSession({ sessionID: temp })
  if (selected?.error) throw selected.error

  return temp
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
      btw_open: tool({
        description: "Open a temporary by-the-way session and optionally seed it with a prompt",
        args: {
          prompt: tool.schema.string().optional(),
        },
        async execute(args, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          await enter(client, ctx.sessionID, args.prompt ?? "")
          return ""
        },
      }),
    },
    async config(cfg) {
      cfg.command = {
        [openname()]: opencmd,
        "btw-status": statuscmd,
        ...cfg.command,
      }
    },
  }),
}
