const cmd = {
  description: "Check whether the opencode-bytheway plugin is loaded",
  agent: "general",
  template: "Call the btw_status tool and return its output.",
}

export default {
  id: "opencode-bytheway",
  server: async () => ({
    tool: {
      btw_status: {
        description: "Report plugin status for local development",
        args: {},
        async execute(_, ctx) {
          return ["opencode-bytheway is loaded.", `session: ${ctx.sessionID ?? "<none>"}`].join("\n")
        },
      },
    },
    async config(cfg) {
      cfg.command = {
        "btw-status": cmd,
        ...cfg.command,
      }
    },
  }),
}
