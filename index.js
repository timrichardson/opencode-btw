import { appendFile, writeFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"
import packageJson from "./package.json" assert { type: "json" }
import {
  PLUGIN_ID,
  SERVER_LOG_FILE,
  SERVER_RUNTIME_MARKER,
  diagnosticsenabled,
  handofffile,
  makeprompthandoff,
} from "./protocol.js"

const statustext = (sessionID) => [
  `opencode-bytheway ${packageJson.version} is loaded.`,
  `session: ${sessionID ?? "<none>"}`,
].join("\n")

const logserver = (stage, data = {}) => {
  if (!diagnosticsenabled()) return Promise.resolve()
  const line = JSON.stringify({
    time: new Date().toISOString(),
    runtimeMarker: SERVER_RUNTIME_MARKER,
    stage,
    ...data,
  })
  return appendFile(SERVER_LOG_FILE, `${line}\n`, "utf8").catch(() => undefined)
}

const serialize = (value) => JSON.stringify(value, null, 2)

const writehandoff = async (originSessionID, prompt) => {
  const payload = makeprompthandoff(originSessionID, prompt)
  const file = handofffile(originSessionID)
  await writeFile(file, `${serialize(payload)}\n`, { encoding: "utf8", mode: 0o600 })
  await logserver("handoff.write", {
    file,
    originSessionID: payload.originSessionID,
    promptLength: prompt.length,
  })
}

const triggertuicommand = async (client, command, logstage = "tui.command") => {
  await logserver(`${logstage}:start`, { command, mode: "publish" })

  if (typeof client.tui?.publish === "function") {
    const published = await client.tui.publish({
      body: {
        type: "tui.command.execute",
        properties: { command },
      },
    })
    if (published?.error) throw published.error
    await logserver(`${logstage}:done`, { command, mode: "publish" })
    return
  }

  if (typeof client.tui?.executeCommand === "function") {
    const executed = await client.tui.executeCommand({ command })
    if (executed?.error) throw executed.error
    await logserver(`${logstage}:done`, { command, mode: "executeCommand" })
    return
  }

  throw new Error("OpenCode TUI command execution is unavailable.")
}

const triggerbtwopen = (client) => triggertuicommand(client, "btw.open", "experimental.enter:trigger_btw_open")

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
  id: PLUGIN_ID,
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
  }),
}
