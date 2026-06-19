// Shared server/TUI protocol. Keep command names, temp-file names, and
// handoff payload versions here so both plugin halves evolve together.
export const PLUGIN_ID = "opencode-bytheway"
export const ACTIVE_STATE_KEY = "opencode-bytheway.active"

export const COMMAND_ENV = "OPENCODE_BYTHEWAY_COMMAND"
export const HANDOFF_NAMESPACE_ENV = "OPENCODE_BYTHEWAY_HANDOFF_NAMESPACE"
export const DIAGNOSTICS_ENV = "OPENCODE_BYTHEWAY_DIAGNOSTICS"

export const PROMPT_HANDOFF_TYPE = "experimental-btw"
export const PROMPT_HANDOFF_VERSION = 3
export const PROMPT_HANDOFF_MODE = "btw.open"
export const STATUS_HANDOFF_TYPE = "opencode-bytheway-status"
export const STATUS_HANDOFF_VERSION = 1

export const EXPERIMENTAL_COMMAND = "btw-prompt"
export const SERVER_LOG_FILE = "/tmp/opencode-bytheway-server.log"
export const TUI_EVENT_LOG_FILE = "/tmp/opencode-bytheway-event.log"
export const TUI_TOAST_LOG_FILE = "/tmp/opencode-bytheway-toast.log"
export const SERVER_RUNTIME_MARKER = "server-btw-open-handoff-v1"
export const TUI_RUNTIME_MARKER = "tui-file-handoff-prompt-v1"

const env = () => globalThis.process?.env ?? {}

export const diagnosticsenabled = () => env()[DIAGNOSTICS_ENV] === "1"

export const slashbase = () => {
  const value = env()[COMMAND_ENV]?.trim().replace(/^\/+/, "").toLowerCase()
  if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) return "btw"
  return value
}

export const slash = (name) => `/${name}`
export const openname = () => slashbase()
export const endname = () => `${slashbase()}-end`
export const mergename = () => `${slashbase()}-merge`
export const statusname = () => `${slashbase()}-status`

export const handoffnamespace = () => {
  const value = env()[HANDOFF_NAMESPACE_ENV]?.trim()
  if (!value) return
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

export const safetoken = (value) => (value ?? "none").replace(/[^a-zA-Z0-9_-]/g, "_")

export const handofffile = (originSessionID) => {
  const namespace = handoffnamespace()
  const token = safetoken(originSessionID)
  return namespace
    ? `/tmp/opencode-bytheway-handoff-${namespace}-${token}.json`
    : `/tmp/opencode-bytheway-handoff-${token}.json`
}

export const statusfile = (sessionID) => {
  const namespace = handoffnamespace()
  const token = safetoken(sessionID)
  return namespace
    ? `/tmp/opencode-bytheway-status-${namespace}-${token}.json`
    : `/tmp/opencode-bytheway-status-${token}.json`
}

export const makeprompthandoff = (originSessionID, prompt) => ({
  type: PROMPT_HANDOFF_TYPE,
  version: PROMPT_HANDOFF_VERSION,
  mode: PROMPT_HANDOFF_MODE,
  originSessionID: originSessionID ?? null,
  prompt,
  time: new Date().toISOString(),
})

export const isprompthandoff = (value) =>
  Boolean(
    value &&
      typeof value === "object" &&
      value.type === PROMPT_HANDOFF_TYPE &&
      value.version === PROMPT_HANDOFF_VERSION &&
      value.mode === PROMPT_HANDOFF_MODE &&
      (value.originSessionID === null || typeof value.originSessionID === "string") &&
      typeof value.prompt === "string",
  )

export const isstatushandoff = (value, sessionID) =>
  Boolean(
    value &&
      typeof value === "object" &&
      value.type === STATUS_HANDOFF_TYPE &&
      value.version === STATUS_HANDOFF_VERSION &&
      (value.sessionID === null || typeof value.sessionID === "string") &&
      value.sessionID === (sessionID ?? null) &&
      typeof value.serverVersion === "string",
  )
