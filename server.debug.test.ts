import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import serverPlugin from "./index.js"

const handoffFile = "/tmp/opencode-bytheway-handoff.json"

function createClient(promptData: unknown) {
  const calls: string[] = []

  return {
    calls,
    client: {
      session: {
        async messages() {
          calls.push("messages")
          return {
            data: [
              { info: { role: "user" }, parts: [{ type: "text", text: "Context question" }] },
              { info: { role: "assistant" }, parts: [{ type: "text", text: "Context answer" }] },
            ],
          }
        },
        async create() {
          calls.push("create")
          return { data: { id: "ses_btw" } }
        },
        async update(args: Record<string, unknown>) {
          calls.push("update")
          expect(args).toEqual({ sessionID: "ses_btw", title: "/btw experimental session" })
          return { data: undefined }
        },
        async prompt(args: Record<string, unknown>) {
          calls.push("prompt")
          expect(args).toEqual({
            path: { id: "ses_btw" },
            body: {
              noReply: true,
              parts: [{ type: "text", text: [
                "Copied plain-text context from the original session.",
                "Only user and assistant text is included below. Tool calls and hidden reasoning are omitted.",
                "Use it as conversation context for the next prompt.",
                "",
                "User:\nContext question\n\nAssistant:\nContext answer",
              ].join("\n") }],
            },
          })
          return { data: promptData }
        },
      },
    },
  }
}

describe("experimental-btw server debug harness", () => {
  test("steps through opencode_bytheway_plugin_open and writes a prompt-based handoff", async () => {
    rmSync(handoffFile, { force: true })
    const { client, calls } = createClient({
      info: { id: "msg_ctx", role: "user" },
      parts: [],
    })

    const server = await serverPlugin.server({ client } as any)
    const result = await server.tool.opencode_bytheway_plugin_open.execute(
      { prompt: "investigate this" },
      { sessionID: "ses_main" },
    )

    expect(result).toBe("")
    expect(calls).toEqual(["create", "messages", "prompt", "update"])
    expect(JSON.parse(readFileSync(handoffFile, "utf8"))).toMatchObject({
      type: "experimental-btw",
      version: 2,
      originSessionID: "ses_main",
      tempSessionID: "ses_btw",
      prompt: "investigate this",
    })
    rmSync(handoffFile, { force: true })
  })
})
