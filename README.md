# opencode-bytheway

OpenCode plugin that adds temporary "by the way" side-session workflows.

A proof-of-concept plugin to implement something like Claude Code's "btw" feature, where you can branch into a temporary side session, then discard it or merge text back into the parent session when you are done.
`/btw` opens a session that you can exit with `/btw-end`.
`/btw your prompt here` opens the temp session and sends that prompt there without adding it to the parent transcript.
`/btw-prompt` can also be used as `/btw-prompt tell me more about foo()`; it is experimental.
Typed `/btw`, `/btw-merge`, `/btw-end`, `/btw-status`, and `/btw-prompt` commands are handled by the TUI plugin instead of requiring a model call just to dispatch.


Normal usage:
- run `/btw` and then type in the temp session
- run `/btw your prompt here` to open the temp session and send an initial prompt there

Experimental prompt entrypoint:
- run `/btw-prompt your prompt here` to open the temp session and hand that prompt to the TUI plugin
- the command is handled in the TUI without an LLM hop
- the TUI plugin forks the current session, switches you into the fork in the same terminal, and sends the initial prompt there without adding it to the parent transcript

No nesting.

# name clash
A plugin package opencode-btw already exists. It is not an attempt to emulate Claude Code, it provides persistent steering hints. 


## Install

Use OpenCode's plugin installer:

```bash
opencode plugin opencode-bytheway --global
```

The installer detects that this package has both server and TUI targets and updates both global config files:

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/tui.json`

Use `--force` if you need to replace an existing pinned version:

```bash
opencode plugin opencode-bytheway@0.5.0 --global --force
```

OpenCode 1.17.8 loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

If installing manually instead of using `opencode plugin`, list the package spec in `tui.json[c]` for slash-command support. Add the same package spec to `opencode.json[c]` only if you also want the server-side helper tools available.

The plugin parts are split this way:
- the TUI plugin implements `/btw`, `/btw-merge`, `/btw-end`, `/btw-status`, and `/btw-prompt`
- the server plugin exposes helper tools for local development and model/tool-triggered TUI handoffs

For normal interactive `/btw` usage, the `opencode.json[c]` entry is no longer required; keep it only if you want the server helper tools.

Example `opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-bytheway"]
}
```

Example `tui.jsonc`:

```jsonc
{
  "plugin": ["opencode-bytheway"]
}
```

Optional version pin, shown in both files:

`opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-bytheway@0.5.0"]
}
```

`tui.jsonc`:

```jsonc
{
  "plugin": ["opencode-bytheway@0.5.0"]
}
```

Restart OpenCode after installing or updating the plugin.

Troubleshooting:
- if `/btw` does not appear or does not open a side session, confirm the package is loaded in `tui.json[c]`
- if server-side helper tools are unavailable, confirm the package is loaded in `opencode.json[c]`
- reload or restart OpenCode after changing either config

Optional command-family override:

```bash
OPENCODE_BYTHEWAY_COMMAND=aside
```

With that env var set, the plugin exposes `/aside`, `/aside-merge`, `/aside-end`, and `/aside-status` instead of the default `/btw` command family.
The experimental `/btw-prompt` command stays fixed.
Set the same env var for both the server and TUI plugin processes.

Optional diagnostic logging:

```bash
OPENCODE_BYTHEWAY_DIAGNOSTICS=1
```

When enabled, the plugin writes JSONL diagnostic logs to `/tmp/opencode-bytheway-server.log`, `/tmp/opencode-bytheway-event.log`, and `/tmp/opencode-bytheway-toast.log`.
These logs are disabled by default.

## Commands

- `/btw`: open a temporary btw side session in the same terminal, preserving context from the current session
- `/btw your prompt here`: open the temporary side session and send that prompt inside the forked temp session
- `/btw-merge`: append plain user/assistant text from the temporary session into the original session as it exists when merge runs, then close the temporary session
- `/btw-end`: return to the original session as it exists now and remove the temporary btw session without carrying text back
- `/btw-status`: show whether the TUI plugin is loaded
- `/btw-prompt your prompt here`: experimental TUI-owned entrypoint that opens a forked temp session and sends the initial prompt there

## User experience

- `/btw` is for branching off in the same terminal while keeping your main session intact
- `/btw-merge` carries back only plain user/assistant text from the temporary session; tool calls and subagent details are omitted
- `/btw-merge` asks for confirmation first if the original session continued while the temporary session was active
- `/btw-end` is the clear way back when you want to discard the temporary session without merging text back
- nested btw sessions are blocked to avoid stacked temporary contexts

## Local development

```bash
bun install --ignore-scripts
bun run build
bun run test
bun run test:server-debug
bun run test:integration
npm pack --dry-run
```

For local OpenCode testing, point both `tui.json[c]` and `opencode.json[c]` at this repository path after running `bun run build`.

After changing `tui.tsx`, run `bun run build` again before reopening or reloading OpenCode so the local plugin uses the updated `dist/tui.js`.

`bun run test:integration` launches the real installed `opencode` TUI inside a pseudo-terminal and drives `/btw` from an isolated temporary config. Use it when developing TUI/session behavior; it is intentionally separate from `bun run test` because it depends on the local OpenCode binary and runtime environment.
Set `OPENCODE_BTW_OPENCODE_BIN=/absolute/path/to/opencode` to run the integration suite against a specific OpenCode binary.

OpenCode 1.17.8 loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

When testing locally, put the package root in `tui.json[c]` for the slash-command workflow. Add it to `opencode.json[c]` only when testing server helper tools.

Example `opencode.json` entry when the repository lives at `~/projects/opencode-btw-plugin`:

```json
{
  "plugin": [
    "file:///home/{USER}/projects/opencode-btw-plugin"
  ]
}
```

Use an absolute `file://` path in the config. Do not rely on `~` or `$USER` expansion inside `opencode.json`, since config values are not shell-expanded.

Example `tui.json` entry for the slash commands:

```json
{
  "plugin": [
    "file:///home/{USER}/projects/opencode-btw-plugin"
  ]
}
```

Point at the package root, not `index.js` or `dist/tui.js` directly.

These local `opencode.json[c]` and `tui.json[c]` files are convenient for faster iteration, but keep them untracked in your clone.
Their absolute `file://` paths are machine-specific and should not be committed to the package repo.

## Investigating `/btw-prompt`

`/btw-prompt` is intercepted by the TUI prompt layer, so it does not need a model call just to forward the raw command arguments.
The server-side `opencode_bytheway_plugin_open` tool still writes a lightweight prompt handoff and asks the TUI to execute `btw.open`, so tool-triggered prompts use the same fork-based `/btw` flow.

For same-process IDE debugging of the server tool, use the focused Bun harness in `server.debug.test.ts`.
This harness uses a mocked prompt result so you can step through the extraction logic in `index.js` without starting OpenCode itself.

Suggested WebStorm workflow:
1. Open `server.debug.test.ts`.
2. Set breakpoints in `index.js` inside `opencode_bytheway_plugin_open.execute` or `enter`.
3. In WebStorm, run `server.debug.test.ts` in Debug mode, or create a Bun run/debug configuration for `bun test ./server.debug.test.ts`.
4. If you want to debug the broader existing suite instead, use `tui.test.tsx` and target the `opencode_bytheway_plugin_open` tests.

## Changelog

### 0.5.1

- Built against OpenCode 1.17.8.
- Speed up bare `/btw` opens by skipping the source-message pre-scan.
- Clarify that `/btw-end` returns to the original session as it exists at return time.
- Ask for confirmation before `/btw-merge` when the original session advanced while the temporary session was active.
- Add real-TUI integration coverage for bare `/btw` merge boundaries.

### 0.5.0

- Built against OpenCode 1.17.8.
- Target OpenCode 1.17.8 command behavior by moving `/btw` slash dispatch fully into the TUI plugin.
- Stop registering server prompt-command shims for the `/btw` command family, avoiding duplicate slash autocomplete entries and unsafe display-only server command handling.
- Add real-TUI integration coverage for typed bare `/btw`.

### 0.4.1

- Built against OpenCode 1.17.7.
- modernize TUI slash-command registration onto the current keymap layer API
- update session list, fork fallback, temp-session rehydration, and merge tracking for current OpenCode SDK shapes
- tag temporary sessions with plugin metadata and harden prompt/status handoff files
- add TypeScript typecheck coverage and update OpenCode/OpenTUI plugin dependencies

### 0.4.0

- Built against OpenCode 1.17.7.
- show changelog details in `README.md` so npmjs.com displays release notes
- clarify documented `/btw <prompt>` support and plugin-hook dispatch behavior

### 0.3.16

- Built against OpenCode 1.17.7.
- fix typed `/btw <prompt>` on OpenCode 1.17.7 without runtime exception flashes or origin transcript pollution
- avoid intercepting Enter for unrelated prompt slash commands such as `/sessions`
- add regression coverage for real TUI prompt handoff and keybinding behavior

### 0.3.15

- support OpenCode command hooks that mark slash commands handled through the hook output object

### 0.3.14

- add regression coverage that `/btw` continues to fork large source sessions without a fork guard

### 0.3.13

- share bytheway protocol helpers between the server and TUI plugin halves

### 0.3.12

- clear stale active `/btw` state from another origin session before opening a new side session
- add opt-in diagnostics and integration coverage for typed `/btw <prompt>` handoff flow

### 0.3.11

- update the TUI command and session flow to work with OpenCode 1.14.48
- add an opt-in integration test that launches a real OpenCode TUI session for `/btw` coverage

### 0.3.10

- align CI and release workflows with Bun 1.3.13 to match local verification
- make command-handler tests await command completion instead of depending on scheduler timing

### 0.3.9

- document `opencode plugin opencode-bytheway --global` as the primary install path because it updates both server and TUI config files
- keep manual dual-file config instructions as a fallback for users not using the plugin installer

### 0.3.8

- report both server and TUI plugin versions from `/btw-status` so mismatched OpenCode config entries are easier to diagnose
- document keeping `opencode.jsonc` and `tui.jsonc` pinned to the same plugin version

### 0.3.7

- restore typed `/btw`, `/btw-merge`, and `/btw-end` dispatch for current OpenCode by routing server slash shims into the TUI command handlers
- avoid duplicate slash autocomplete entries by keeping slash metadata on the server shims only
- make `/btw-status` use the current TUI toast event path
- resume or clear stale `/btw` state instead of refusing to open a side session after restart
- support `/btw <prompt>` by handing the inline prompt to the new temporary session

### 0.3.6

- keep `/btw` and `/btw-prompt` visible on the origin session even while a temporary `/btw` session is active
- continue to restrict `/btw-merge` and `/btw-end` to the active temp session where they actually work

### 0.3.5

- refine the published package metadata description to better describe the Claude Code-inspired btw workflow
- include the plugin version in `/btw-status` output so loaded builds are easier to identify in TUI

### 0.3.4

- refine the published package metadata description to better describe the Claude Code-inspired btw workflow

### 0.3.3

- rename the remaining `/btw` slash-command family members to hyphenated forms: `/btw-merge` and `/btw-end`
- keep command-family overrides consistent with the same hyphenated naming, such as `/aside-merge` and `/aside-end`

### 0.3.2

- rename the experimental server-side prompt command to `/btw-prompt`
- route `/btw-prompt` through the existing TUI-owned `/btw` open flow so the initial prompt runs inside the forked session
- namespace and scope prompt handoff files to the origin session to avoid cross-session collisions during local testing

### 0.3.1

- scope `/btw` command visibility to the current session so unrelated sessions do not incorrectly show `/btw-end`
- handle `/btw-status` directly in the TUI with a toast instead of sending it through the agent loop

### 0.3.0

- add direct non-LLM dispatch for `/btw-prompt` while keeping the proven TUI handoff flow
- remove temporary debug slash commands and trim unused server helpers
- improve experimental runtime logging for live debugging and restore the file-based prompt handoff after the parent-linked refactor failed in the live host

### 0.2.3

- add direct non-LLM dispatch for `/btw-prompt` while keeping the proven TUI handoff flow
- remove temporary debug slash commands and trim unused server helpers
- improve experimental runtime logging for live debugging and restore the file-based prompt handoff after the parent-linked refactor failed in the live host

### 0.2.2

- restore `/btw` to TUI-only ownership and move the seeded server-side entrypoint to `/btw-prompt`

### 0.2.1

- publish the side-session-only release from the OIDC trusted publishing workflow

### 0.2.0

- remove `/btw_popup` and its popup-dialog runtime so the plugin focuses on temporary side sessions
- load active bytheway sessions cleanly, keep the sidebar indicator aligned with the active temp session, and improve command-family overrides for local installs

### 0.1.5

- align the runtime plugin id with the published package name and add direct server-entry coverage
- harden popup and temp-session cleanup for canceled runs and failed `/btw-end` deletes
- add an optional `OPENCODE_BYTHEWAY_COMMAND` env var to rename the `/btw` slash-command family
- pin Bun in CI and release workflows and document local `file://` plugin development setup

### 0.1.4

- publish a clean release from the planner-aligned workflow after the earlier workflow-only tags failed before matching package metadata

### 0.1.2

- align the standalone release workflow more closely with `opencode-planner` before the next publish attempt

### 0.1.1

- rename the npm package to `opencode-bytheway` so the standalone repo can publish under a clean available name

### 0.1.0

- add `/btw` for same-terminal temporary side sessions
- add `/btw-end` to return to the original session and close the temp session
- add `/btw_popup` for one-off popup questions that preserve the current screen
- improve popup rendering, copy feedback, and streaming stability
- publish from the standalone `opencode-btw` repository using a root package and root release workflow

## Release

- CI and release publish from repo root.
- The release workflow does not bump `package.json`; bump the version and commit it before tagging.
- Stable release tags only. Tag format is `v*`, and the tag version must match `package.json` exactly.
- The workflow runs `bun run test`, `bun run build`, publishes to npm, and creates the GitHub release.

Before tagging:

```bash
bun run build
bun run test
bun run test:integration
npm pack --dry-run
```

Release checklist:

```bash
# update package.json version, for example x.y.z
# update CHANGELOG.md, including the OpenCode version the plugin was built against
# update the README.md changelog section with the same release details for npmjs.com
git add package.json CHANGELOG.md README.md
git commit -m "chore: release x.y.z"
git tag vx.y.z
git push origin main
git push origin vx.y.z
```

After install, verify the TUI plugin commands load:

- `/btw`, `/btw-merge`, `/btw-end`, `/btw-status`, `/btw-prompt`

If the optional server entry is installed in `opencode.json[c]`, verify the server helper tools are available:

- `btw_status`
- `opencode_bytheway_plugin_open`
- `opencode_bytheway_plugin_select_temp`
