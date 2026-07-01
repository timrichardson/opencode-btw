// Shared TUI constants. Keep command names and storage keys aligned here.
export const PLUGIN_ID = "opencode-bytheway"
export const ACTIVE_STATE_KEY = "opencode-bytheway.active"

export const COMMAND_ENV = "OPENCODE_BYTHEWAY_COMMAND"
export const DIAGNOSTICS_ENV = "OPENCODE_BYTHEWAY_DIAGNOSTICS"

export const EXPERIMENTAL_COMMAND = "btw-prompt"
export const TUI_EVENT_LOG_FILE = "/tmp/opencode-bytheway-event.log"
export const TUI_TOAST_LOG_FILE = "/tmp/opencode-bytheway-toast.log"
export const TUI_RUNTIME_MARKER = "tui-btw-v1"

const env = () => globalThis.process?.env ?? {}

export const diagnosticsenabled = () => env()[DIAGNOSTICS_ENV] === "1"

export const slashbase = () => {
  const value = env()[COMMAND_ENV]?.trim().replace(/^\/+/, "").toLowerCase()
  if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) return "btw"
  return value
}

export const slash = (name) => `/${name}`
export const openname = () => slashbase()
export const fastname = () => `${slashbase()}-fast`
export const endname = () => `${slashbase()}-end`
export const mergename = () => `${slashbase()}-merge`
export const statusname = () => `${slashbase()}-status`
