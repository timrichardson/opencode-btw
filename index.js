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
const endname = () => `${slashbase()}-end`
const mergename = () => `${slashbase()}-merge`

const commandhandled = (name) => `__OPENCODE_BYTHEWAY_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_HANDLED__`

const slashcmd = (name, description) => ({
  description,
  template: `/${name}`,
})

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

const showtuitoast = async (client, input, logstage = "tui.toast") => {
  await logserver(`${logstage}:start`, { title: input.title ?? null, mode: "publish" })

  if (typeof client.tui?.publish === "function") {
    const published = await client.tui.publish({
      body: {
        type: "tui.toast.show",
        properties: input,
      },
    })
    if (published?.error) throw published.error
    await logserver(`${logstage}:done`, { title: input.title ?? null, mode: "publish" })
    return
  }

  if (typeof client.tui?.showToast === "function") {
    const shown = await client.tui.showToast(input)
    if (shown?.error) throw shown.error
    await logserver(`${logstage}:done`, { title: input.title ?? null, mode: "showToast" })
    return
  }

  throw new Error("OpenCode TUI toast notifications are unavailable.")
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
        [openname()]: slashcmd(openname(), "Open a by-the-way side session in this terminal"),
        [mergename()]: slashcmd(mergename(), "Append by-the-way text back to the original session and close it"),
        [endname()]: slashcmd(endname(), "Return to the original session and close by-the-way"),
        "btw-prompt": experimentalcmd,
        "btw-status": statuscmd,
        ...cfg.command,
      }
    },
    "command.execute.before": async (input) => {
      if (input.command === "btw-status") {
        if (!client) throw new Error("OpenCode client unavailable.")
        const message = statustext(input.sessionID)
        await logserver("command.execute.before", {
          command: input.command,
          originSessionID: input.sessionID ?? null,
        })
        await showtuitoast(client, {
          title: "opencode-bytheway",
          message,
          variant: "info",
          duration: 6000,
        }, "command.execute.before:show_status")
        throw new Error(BTW_STATUS_HANDLED)
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
          throw new Error(commandhandled(input.command))
        }
        await triggertuicommand(client, tuiCommand, "command.execute.before:trigger_tui_command")
        throw new Error(commandhandled(input.command))
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
