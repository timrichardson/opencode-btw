import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"

const TEMP_DEBUG_FILE = "/tmp/opencode-bytheway-debug.json"
const HANDOFF_FILE = "/tmp/opencode-bytheway-handoff.json"

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
    "After the tool call, do not add any extra text.",
  ].join(" "),
}

const experimentaldbgfreshjsoncmd = {
  description: "Debug: create a fresh session, prompt it directly, and return diagnostics as JSON text",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_debug_open_fresh_json tool.",
    "Pass the full command arguments as the prompt field exactly as written.",
    "If there are no arguments, pass an empty string.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const experimentalprobecmd = {
  description: "Debug: return a fixed string through the server tool bridge",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_probe_string tool.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const experimentalprobeforkcmd = {
  description: "Debug: fork a temp session and return a fixed string",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_probe_fork_string tool.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const experimentalprobemessagescmd = {
  description: "Debug: read session messages and return a fixed string",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_probe_messages_string tool.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const experimentalprobeforkonlycmd = {
  description: "Debug: fork a temp session without updating it and return a fixed string",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_probe_fork_only_string tool.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const experimentalprobeforkupdatecmd = {
  description: "Debug: fork and update a temp session and return a fixed string",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_probe_fork_update_string tool.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const experimentalprobepromptcmd = {
  description: "Debug: fork a temp session, prompt it, and return a fixed string",
  agent: "general",
  subtask: false,
  template: [
    "Call the opencode_bytheway_plugin_probe_prompt_string tool.",
    "Pass the full command arguments as the prompt field exactly as written.",
    "If there are no arguments, pass an empty string.",
    "Return the exact tool output verbatim.",
  ].join(" "),
}

const sessiontitle = () => `/${openname()} session`
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

const stringify = (value) => {
  const seen = new WeakSet()
  return JSON.stringify(value, (_, item) => {
    if (!item || typeof item !== "object") return item
    if (seen.has(item)) return "[Circular]"
    seen.add(item)
    return item
  })
}

const fallbacktext = (value) => {
  if (typeof value === "string") return value.trim()
  if (value == null) return ""
  if (typeof value !== "object") return String(value)
  try {
    return stringify(value)
  } catch {
    return String(value)
  }
}

const promptmessage = (seeded) => {
  const data = seeded?.data
  if (!data || typeof data !== "object") return
  if (!data.info || typeof data.info !== "object") return
  if (!Array.isArray(data.parts)) return
  return data
}

// The SDK contract for session.prompt() is an assistant-message envelope:
// { info: AssistantMessage, parts: Part[] }.
const promptresult = (seeded) => {
  const message = promptmessage(seeded)
  if (!message) return fallbacktext(seeded?.data)

  const text = collecttext(message.parts)
  if (text) return text

  const structured = message.info?.structured_output
  if (structured !== undefined) return fallbacktext(structured)

  return fallbacktext(message)
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

const builddebugreport = (ctx, seeded, file) => ({
  debug: "opencode-bytheway.prompt",
  file,
  tempDebugFile: TEMP_DEBUG_FILE,
  ctx: {
    sessionID: ctx.sessionID ?? null,
    worktree: ctx.worktree ?? null,
    directory: ctx.directory ?? null,
  },
  processCwd: process.cwd(),
  extracted: promptresult(seeded),
  seeded: inspect(seeded),
  data: inspect(seeded?.data),
})

const serialize = (value) => JSON.stringify(value, null, 2)

const writehandoff = async (originSessionID, tempSessionID, reply) => {
  const payload = {
    type: "experimental-btw",
    originSessionID: originSessionID ?? null,
    tempSessionID,
    reply,
    time: new Date().toISOString(),
  }
  await writeFile(HANDOFF_FILE, `${serialize(payload)}\n`, "utf8")
  return payload
}

const writepromptdebug = async (ctx, seeded) => {
  const root = ctx.worktree || ctx.directory || process.cwd()
  const dir = join(root, ".opencode")
  const file = join(dir, "bytheway-debug.json")
  const report = builddebugreport(ctx, seeded, file)
  const text = serialize(report)
  await mkdir(dir, { recursive: true })
  await writeFile(file, `${text}\n`, "utf8")
  await writeFile(TEMP_DEBUG_FILE, `${text}\n`, "utf8")
  return { file, report, text }
}

const writedebugstart = async (ctx, mode, sessionID, prompt) =>
  writepromptdebug(ctx, {
    data: {
      debugPhase: "start",
      mode,
      sessionID: sessionID ?? null,
      prompt,
      note: "Initial marker before session/prompt work.",
    },
  })

const errordata = (error) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    }
  }
  return { value: error }
}

const writebeforeprompt = async (ctx, mode, sessionID, targetSessionID, prompt) =>
  writepromptdebug(ctx, {
    data: {
      debugPhase: "before-prompt",
      mode,
      sessionID: sessionID ?? null,
      targetSessionID,
      prompt,
      note: "About to call client.session.prompt(...).",
    },
  })

const writeprompterror = async (ctx, mode, sessionID, targetSessionID, prompt, error) =>
  writepromptdebug(ctx, {
    data: {
      debugPhase: "prompt-error",
      mode,
      sessionID: sessionID ?? null,
      targetSessionID,
      prompt,
      error: errordata(error),
    },
  })

const promptwithdebug = async (client, ctx, mode, sessionID, targetSessionID, text) => {
  await writebeforeprompt(ctx, mode, sessionID, targetSessionID, text)

  try {
    const seeded = await client.session.prompt({
      path: { id: targetSessionID },
      body: {
        parts: [{ type: "text", text }],
      },
    })
    if (seeded.error) throw seeded.error
    return seeded
  } catch (error) {
    await writeprompterror(ctx, mode, sessionID, targetSessionID, text, error)
    throw error
  }
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

const sourceid = async (client, sessionID) => {
  const source = sessionID || (await client.session.create({})).data?.id
  if (!source) throw new Error("Failed to create a new session.")
  return source
}

const sessionmessages = async (client, sessionID) => {
  if (!sessionID) return []
  const list = await client.session.messages({ sessionID, limit: 1000 }).catch(() => undefined)
  return list?.data ?? []
}

const forktemp = async (client, sessionID) => {
  const source = await sourceid(client, sessionID)
  const cut = await cutoff(client, source)
  const next = await client.session.fork({
    sessionID: source,
    ...(cut.mode === "cut" ? { messageID: cut.messageID } : {}),
  })
  if (next.error || !next.data?.id)
    throw next.error ?? new Error("Failed to create temporary session.")
  return next.data.id
}

const opentemp = async (client, sessionID) => {
  const temp = await forktemp(client, sessionID)
  await client.session.update({ sessionID: temp, title: sessiontitle() }).catch(() => undefined)

  return temp
}

const selecttemp = async (client, sessionID) => {
  const selected = await client.tui.selectSession({ sessionID })
  if (selected?.error) throw selected.error
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

  const text = prompt.trim()
  if (!text) {
    await writehandoff(sessionID, temp, "")
    await client.session.update({ sessionID: temp, title: experimentaltitle() }).catch(() => undefined)
    return ""
  }

  const seeded = await client.session.prompt({
    path: { id: temp },
    body: {
      parts: [{ type: "text", text }],
    },
  })
  if (seeded.error) throw seeded.error

  await writehandoff(sessionID, temp, promptresult(seeded))
  await client.session.update({ sessionID: temp, title: experimentaltitle() }).catch(() => undefined)

  return ""
}

const probefork = async (client, sessionID) => {
  await opentemp(client, sessionID)
  return "FORK_OK"
}

const probemessages = async (client, sessionID) => {
  const source = await sourceid(client, sessionID)
  await cutoff(client, source)
  return "MESSAGES_OK"
}

const probeforkonly = async (client, sessionID) => {
  await forktemp(client, sessionID)
  return "FORK_ONLY_OK"
}

const probeforkupdate = async (client, sessionID) => {
  const temp = await forktemp(client, sessionID)
  await client.session.update({ sessionID: temp, title: sessiontitle() }).catch(() => undefined)
  return "FORK_UPDATE_OK"
}

const probeprompt = async (client, sessionID, prompt) => {
  const temp = await opentemp(client, sessionID)
  const text = prompt.trim() || "noop"

  const seeded = await client.session.prompt({
    path: { id: temp },
    body: {
      parts: [{ type: "text", text }],
    },
  })
  if (seeded.error) throw seeded.error

  return "PROMPT_OK"
}

const enterfreshdebugjson = async (client, ctx, sessionID, prompt) => {
  const text = prompt.trim()
  await writedebugstart(ctx, "fresh-json", sessionID, text)

  const created = await client.session.create({})
  if (created.error || !created.data?.id) {
    const error = created.error ?? new Error("Failed to create debug session.")
    await writeprompterror(ctx, "fresh-json", sessionID, null, text, error)
    throw error
  }

  const fresh = created.data.id
  if (!text) {
    const written = await writepromptdebug(ctx, { data: { note: "No prompt provided.", sessionID: fresh } })
    return written.text
  }

  const seeded = await promptwithdebug(client, ctx, "fresh-json", sessionID, fresh, text)

  const written = await writepromptdebug(ctx, seeded)
  return written.text
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
          await selecttemp(client, args.sessionID)
          return ""
        },
      }),
      opencode_bytheway_plugin_probe_string: tool({
        description: "Return a fixed probe string for bridge debugging",
        args: {},
        async execute() {
          return "OPEN_OK"
        },
      }),
      opencode_bytheway_plugin_probe_fork_string: tool({
        description: "Fork a temporary session and return a fixed probe string",
        args: {},
        async execute(_, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await probefork(client, ctx.sessionID)
        },
      }),
      opencode_bytheway_plugin_probe_messages_string: tool({
        description: "Read session messages and return a fixed probe string",
        args: {},
        async execute(_, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await probemessages(client, ctx.sessionID)
        },
      }),
      opencode_bytheway_plugin_probe_fork_only_string: tool({
        description: "Fork a temporary session without updating it and return a fixed probe string",
        args: {},
        async execute(_, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await probeforkonly(client, ctx.sessionID)
        },
      }),
      opencode_bytheway_plugin_probe_fork_update_string: tool({
        description: "Fork and update a temporary session and return a fixed probe string",
        args: {},
        async execute(_, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await probeforkupdate(client, ctx.sessionID)
        },
      }),
      opencode_bytheway_plugin_probe_prompt_string: tool({
        description: "Fork a temporary session, prompt it, and return a fixed probe string",
        args: {
          prompt: tool.schema.string().optional(),
        },
        async execute(args, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await probeprompt(client, ctx.sessionID, args.prompt ?? "")
        },
      }),
      opencode_bytheway_plugin_debug_open_fresh_json: tool({
        description: "Create a fresh session, write prompt diagnostics, and return them as JSON text",
        args: {
          prompt: tool.schema.string().optional(),
        },
        async execute(args, ctx) {
          if (!client) throw new Error("OpenCode client unavailable.")
          return await enterfreshdebugjson(client, ctx, ctx.sessionID, args.prompt ?? "")
        },
      }),
    },
    async config(cfg) {
      cfg.command = {
        "experimental-btw": experimentalcmd,
        "experimental-btw-probe-string": experimentalprobecmd,
        "experimental-btw-probe-messages-string": experimentalprobemessagescmd,
        "experimental-btw-probe-fork-only-string": experimentalprobeforkonlycmd,
        "experimental-btw-probe-fork-update-string": experimentalprobeforkupdatecmd,
        "experimental-btw-probe-fork-string": experimentalprobeforkcmd,
        "experimental-btw-probe-prompt-string": experimentalprobepromptcmd,
        "experimental-btw-fresh-debug-json": experimentaldbgfreshjsoncmd,
        "btw-status": statuscmd,
        ...cfg.command,
      }
    },
  }),
}
