import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import serverPlugin from "./index.js"

const handoffFile = "/tmp/opencode-bytheway-handoff.json"

function createClient(promptData: unknown) {
  const calls: string[] = []
  let promptCount = 0

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
          promptCount += 1
          if (promptCount === 1) {
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
            return { data: { info: { id: "msg_ctx", role: "user" }, parts: [] } }
          }
          expect(args).toEqual({
            path: { id: "ses_btw" },
            body: {
              parts: [{ type: "text", text: "investigate this" }],
            },
          })
          return { data: promptData }
        },
      },
    },
  }
}

describe("experimental-btw server debug harness", () => {
  test("steps through opencode_bytheway_plugin_open and returns no origin-session text", async () => {
    rmSync(handoffFile, { force: true })
    const { client, calls } = createClient({
      info: { id: "msg_reply", role: "assistant" },
      parts: [
        { type: "reasoning", text: "hidden" },
        { type: "text", text: "  ANZAC stands for Australian and New Zealand Army Corps.  " },
      ],
    })

    const server = await serverPlugin.server({ client } as any)
    const result = await server.tool.opencode_bytheway_plugin_open.execute(
      { prompt: "investigate this" },
      { sessionID: "ses_main" },
    )

    expect(result).toBe("")
    expect(calls).toEqual(["create", "messages", "prompt", "prompt", "update"])
    expect(JSON.parse(readFileSync(handoffFile, "utf8"))).toMatchObject({
      type: "experimental-btw",
      originSessionID: "ses_main",
      tempSessionID: "ses_btw",
      reply: "ANZAC stands for Australian and New Zealand Army Corps.",
    })
    rmSync(handoffFile, { force: true })
  })
})
