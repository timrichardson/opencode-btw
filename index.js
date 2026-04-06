import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
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

const experimentalcmd = {
  description: "Experimental: open a temporary by-the-way session and optionally seed it with an initial prompt",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_open tool.",
    "Pass the full command arguments as the prompt field exactly as written.",
    "If there are no arguments, pass an empty string.",
    "Then return only the plain text content from the tool result.",
    "Do not return an object, JSON, markdown fencing, or text like [object Object].",
  ].join(" "),
}

const experimentaldbgcmd = {
  description: "Debug: open a temporary by-the-way session and write prompt diagnostics to a file",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_debug_open tool.",
    "Pass the full command arguments as the prompt field exactly as written.",
    "If there are no arguments, pass an empty string.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const sessiontitle = () => `/${openname()} session`

const collecttext = (parts = []) =>
  parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")

const stringify = (value) => {
  const seen = new WeakSet()
  return JSON.stringify(value, (_, item) => {
    if (!item || typeof item !== "object") return item
    if (seen.has(item)) return "[Circular]"
    seen.add(item)
    return item
  })
}

const inspect = (value, depth = 0, seen = new WeakSet()) => {
  if (value == null) return value
  if (typeof value === "string") return { type: "string", value: value.slice(0, 400) }
  if (typeof value !== "object") return { type: typeof value, value }
  if (seen.has(value)) return { type: "circular" }
  seen.add(value)
  if (Array.isArray(value)) {
    if (depth >= 3) return { type: "array", length: value.length }
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, 3).map((item) => inspect(item, depth + 1, seen)),
    }
  }
  const keys = Object.keys(value)
  if (depth >= 3) return { type: "object", keys }
  return {
    type: "object",
    keys,
    sample: Object.fromEntries(keys.slice(0, 8).map((key) => [key, inspect(value[key], depth + 1, seen)])),
  }
}

const extracttext = (value, seen = new WeakSet()) => {
  if (typeof value === "string") return value.trim()
  if (!value || typeof value !== "object") return ""
  if (seen.has(value)) return ""
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => extracttext(item, seen)).filter(Boolean).join("\n\n")
  }

  if (typeof value.type === "string") {
    if (value.type === "text" && typeof value.text === "string") return value.text.trim()
    if (value.type !== "text") return ""
  }

  const fromparts = Array.isArray(value.parts) ? collecttext(value.parts) : ""
  if (fromparts) return fromparts

  for (const key of ["text", "content", "output", "message", "result", "response", "data"]) {
    const next = extracttext(value[key], seen)
    if (next) return next
  }

  for (const item of Object.values(value)) {
    const next = extracttext(item, seen)
    if (next) return next
  }

  return ""
}

const plain = (value) => {
  if (typeof value === "string") return value
  if (value == null) return ""
  if (typeof value !== "object") return String(value)
  const extracted = extracttext(value)
  if (extracted) return extracted
  try {
    return stringify(value)
  } catch {
    return String(value)
  }
}

const debugprompt = (seeded) =>
  JSON.stringify(
    {
      debug: "opencode-bytheway.prompt",
      extracted: plain(collecttext(seeded?.data?.parts) || seeded?.data),
      seeded: inspect(seeded),
      data: inspect(seeded?.data),
    },
    null,
    2,
  )

const writepromptdebug = async (ctx, seeded) => {
  const root = ctx.worktree || ctx.directory || process.cwd()
  const dir = join(root, ".opencode")
  const file = join(dir, "bytheway-debug.json")
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${debugprompt(seeded)}\n`, "utf8")
  return file
}

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

const opentemp = async (client, sessionID) => {
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

  const selected = await client.tui.selectSession({ sessionID: temp })
  if (selected?.error) throw selected.error

  return temp
}

const enter = async (client, sessionID, prompt) => {
  const temp = await opentemp(client, sessionID)

  const text = prompt.trim()
  if (!text) return ""

  const seeded = await client.session.prompt({
    sessionID: temp,
    parts: [{ type: "text", text }],
  })
  if (seeded.error) throw seeded.error

  return plain(collecttext(seeded.data?.parts) || seeded.data)
}

const enterdebug = async (client, ctx, sessionID, prompt) => {
  const temp = await opentemp(client, sessionID)

  const text = prompt.trim()
  if (!text) {
    const file = await writepromptdebug(ctx, { note: "No prompt provided." })
    return `Wrote debug payload to ${file}`
  }

  const seeded = await client.session.prompt({
    sessionID: temp,
    parts: [{ type: "text", text }],
  })
  if (seeded.error) throw seeded.error

  const file = await writepromptdebug(ctx, seeded)
  return `Wrote debug payload to ${file}`
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
        description: "Open a temporary by-the-way session and optionally seed it with a prompt",
        args: {
          prompt: tool.schema.string().optional(),
        },
        async execute(args, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return plain(await enter(client, ctx.sessionID, args.prompt ?? ""))
        },
      }),
      opencode_bytheway_plugin_debug_open: tool({
        description: "Open a temporary by-the-way session and write prompt diagnostics to a file",
        args: {
          prompt: tool.schema.string().optional(),
        },
        async execute(args, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await enterdebug(client, ctx, ctx.sessionID, args.prompt ?? "")
        },
      }),
    },
    async config(cfg) {
      cfg.command = {
        "experimental-btw": experimentalcmd,
        "experimental-btw-debug": experimentaldbgcmd,
        "btw-status": statuscmd,
        ...cfg.command,
      }
    },
  }),
}
