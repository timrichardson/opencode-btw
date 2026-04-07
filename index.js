import { appendFile, writeFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"
import packageJson from "./package.json" assert { type: "json" }

const EXPERIMENTAL_BTW_HANDLED = "__OPENCODE_BYTHEWAY_EXPERIMENTAL_BTW_HANDLED__"
const BTW_STATUS_HANDLED = "__OPENCODE_BYTHEWAY_BTW_STATUS_HANDLED__"
const SERVER_LOG_FILE = "/tmp/opencode-bytheway-server.log"
const RUNTIME_MARKER = "server-btw-open-handoff-v1"

const slashbase = () => {
  const env = (globalThis.process?.env ?? {})
  const value = env.OPENCODE_BYTHEWAY_COMMAND?.trim().replace(/^\/+/, "").toLowerCase()
  if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) return "btw"
  return value
}

const handoffnamespace = () => {
  const value = (globalThis.process?.env ?? {}).OPENCODE_BYTHEWAY_HANDOFF_NAMESPACE?.trim()
  if (!value) return
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

const openname = () => slashbase()

const statuscmd = {
  description: "Check whether the opencode-bytheway plugin is loaded",
  template: "/btw-status",
}

const experimentalcmd = {
  description: "Experimental: open a temporary by-the-way session and hand its initial prompt to the TUI",
  template: "/btw-prompt",
}

const statustext = (sessionID) => [
  `opencode-bytheway ${packageJson.version} is loaded.`,
  `session: ${sessionID ?? "<none>"}`,
].join("\n")

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

const handofffile = (originSessionID) => {
  const namespace = handoffnamespace()
  const token = (originSessionID ?? "none").replace(/[^a-zA-Z0-9_-]/g, "_")
  return namespace
    ? `/tmp/opencode-bytheway-handoff-${namespace}-${token}.json`
    : `/tmp/opencode-bytheway-handoff-${token}.json`
}

const writehandoff = async (originSessionID, prompt) => {
  const payload = {
    type: "experimental-btw",
    version: 3,
    mode: "btw.open",
    originSessionID: originSessionID ?? null,
    prompt,
    time: new Date().toISOString(),
  }
  const file = handofffile(originSessionID)
  await writeFile(file, `${serialize(payload)}\n`, "utf8")
  await logserver("handoff.write", {
    file,
    originSessionID: payload.originSessionID,
    promptLength: prompt.length,
  })
}

const triggerbtwopen = async (client) => {
  await logserver("experimental.enter:trigger_btw_open:start", { mode: "publish" })

  if (typeof client.tui?.publish === "function") {
    const published = await client.tui.publish({
      body: {
        type: "tui.command.execute",
        properties: { command: "btw.open" },
      },
    })
    if (published?.error) throw published.error
    await logserver("experimental.enter:trigger_btw_open:done", { mode: "publish" })
    return
  }

  if (typeof client.tui?.executeCommand === "function") {
    const executed = await client.tui.executeCommand({ command: "btw.open" })
    if (executed?.error) throw executed.error
    await logserver("experimental.enter:trigger_btw_open:done", { mode: "executeCommand" })
    return
  }

  throw new Error("OpenCode TUI command execution is unavailable.")
}

const enter = async (client, sessionID, prompt) => {
  await logserver("experimental.enter:start", {
    originSessionID: sessionID ?? null,
    promptLength: typeof prompt === "string" ? prompt.length : 0,
  })
  const text = typeof prompt === "string" ? prompt : ""
  await writehandoff(sessionID, text)
  await logserver("experimental.enter:handoff_ready", {
    originSessionID: sessionID ?? null,
    promptLength: text.length,
  })

  await triggerbtwopen(client)
  await logserver("experimental.enter:triggered_btw_open", {
    originSessionID: sessionID ?? null,
    promptLength: text.length,
  })

  await logserver("experimental.enter:done", {
    originSessionID: sessionID ?? null,
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
        "btw-prompt": experimentalcmd,
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
      if (input.command !== "btw-prompt") return
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
