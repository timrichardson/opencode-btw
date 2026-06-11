import { appendFile, writeFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"
import packageJson from "./package.json" assert { type: "json" }
import {
  EXPERIMENTAL_COMMAND,
  PLUGIN_ID,
  SERVER_LOG_FILE,
  SERVER_RUNTIME_MARKER,
  commandhandled,
  diagnosticsenabled,
  endname,
  handofffile,
  makeprompthandoff,
  makestatushandoff,
  mergename,
  openname,
  statusfile,
  statusname,
} from "./protocol.js"

const slashcmd = (name, description) => ({
  description,
  template: `/${name}`,
})

const statuscmd = () => slashcmd(statusname(), "Check whether the opencode-bytheway plugin is loaded")

const experimentalcmd = {
  description: "Experimental: open a temporary by-the-way session and hand its initial prompt to the TUI",
  template: "/btw-prompt",
}

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
  await writeFile(file, `${serialize(payload)}\n`, "utf8")
  await logserver("handoff.write", {
    file,
    originSessionID: payload.originSessionID,
    promptLength: prompt.length,
  })
}

const writestatushandoff = async (sessionID) => {
  const payload = makestatushandoff(sessionID, packageJson.version)
  const file = statusfile(sessionID)
  await writeFile(file, `${serialize(payload)}\n`, "utf8")
  await logserver("status_handoff.write", {
    file,
    sessionID: payload.sessionID,
    serverVersion: payload.serverVersion,
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
    async config(cfg) {
      cfg.command = {
        [openname()]: slashcmd(openname(), "Open a by-the-way side session in this terminal"),
        [mergename()]: slashcmd(mergename(), "Append by-the-way text back to the original session and close it"),
        [endname()]: slashcmd(endname(), "Return to the original session and close by-the-way"),
        [EXPERIMENTAL_COMMAND]: experimentalcmd,
        [statusname()]: statuscmd(),
        ...cfg.command,
      }
    },
    "command.execute.before": async (input, output = {}) => {
      const markhandled = (command) => {
        if ("handled" in output) {
          output.handled = true
          return
        }
        throw new Error(commandhandled(command))
      }
      if (input.command === statusname()) {
        if (!client) throw new Error("OpenCode client unavailable.")
        await logserver("command.execute.before", {
          command: input.command,
          originSessionID: input.sessionID ?? null,
        })
        await writestatushandoff(input.sessionID)
        await triggertuicommand(client, "btw.status", "command.execute.before:show_status")
        markhandled(input.command)
        return
      }
      const tuiCommands = new Map([
        [openname(), "btw.open"],
        [mergename(), "btw.merge"],
        [endname(), "btw.end"],
      ])
      const tuiCommand = tuiCommands.get(input.command)
      if (tuiCommand) {
        if (!client) throw new Error("OpenCode client unavailable.")
        const prompt = typeof input.arguments === "string" ? input.arguments.trim() : ""
        await logserver("command.execute.before", {
          command: input.command,
          tuiCommand,
          originSessionID: input.sessionID ?? null,
          promptLength: prompt.length,
        })
        if (input.command === openname() && prompt) {
          await enter(client, input.sessionID, prompt)
          markhandled(input.command)
          return
        }
        await triggertuicommand(client, tuiCommand, "command.execute.before:trigger_tui_command")
        markhandled(input.command)
        return
      }
      if (input.command !== EXPERIMENTAL_COMMAND) return
      if (!client) throw new Error("OpenCode client unavailable.")
      await logserver("command.execute.before", {
        command: input.command,
        originSessionID: input.sessionID ?? null,
        promptLength: typeof input.arguments === "string" ? input.arguments.length : 0,
      })
      await enter(client, input.sessionID, input.arguments)
      markhandled(input.command)
    },
  }),
}
