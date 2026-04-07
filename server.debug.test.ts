import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import serverPlugin from "./index.js"

;(globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env && (((globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process!.env!)["OPENCODE_BYTHEWAY_HANDOFF_NAMESPACE"] = "test")

const handoffFile = (originSessionID = "none") => `/tmp/opencode-bytheway-handoff-test-${originSessionID.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`

function createClient() {
  const calls: string[] = []

  return {
    calls,
    client: {
      tui: {
        async publish(args: Record<string, unknown>) {
          calls.push("publish")
          expect(args).toEqual({
            body: {
              type: "tui.command.execute",
              properties: { command: "btw.open" },
            },
          })
          return { data: true }
        },
      },
    },
  }
}

describe("experimental-btw server debug harness", () => {
  test("steps through opencode_bytheway_plugin_open and triggers btw.open with a prompt handoff", async () => {
    rmSync(handoffFile("ses_exp_server_debug"), { force: true })
    const { client, calls } = createClient()

    const server = await serverPlugin.server({ client } as any)
    const result = await server.tool.opencode_bytheway_plugin_open.execute(
      { prompt: "investigate this" },
      { sessionID: "ses_exp_server_debug" },
    )

    expect(result).toBe("")
    expect(calls).toEqual(["publish"])
    expect(JSON.parse(readFileSync(handoffFile("ses_exp_server_debug"), "utf8"))).toMatchObject({
      type: "experimental-btw",
      version: 3,
      mode: "btw.open",
      originSessionID: "ses_exp_server_debug",
      prompt: "investigate this",
    })
    rmSync(handoffFile("ses_exp_server_debug"), { force: true })
  })
})
