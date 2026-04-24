# opencode-bytheway

OpenCode TUI plugin that adds temporary "by the way" side-session workflows.

A proof-of-concept plugin to implement something like Claude Code's "btw" feature, where you can branch into a temporary side session, then discard it or merge text back into the parent session when you are done.
`/btw` does not expect a prompt, and opens a session that you can exit with `/btw-end`.
`/btw-prompt` can be used as `/btw-prompt tell me more about foo()`; it is experimental.
These commands are queued like any other OpenCode command when the current session is busy.


Normal usage:
- run `/btw` and then type in the temp session

Experimental server-side entrypoint:
- run `/btw-prompt your prompt here` to open the temp session and hand that prompt to the TUI plugin
- the server command is handled directly in a server hook without an LLM hop
- it writes a lightweight prompt handoff and triggers the existing TUI-owned `/btw` open flow
- the TUI plugin claims that handoff inside `/btw`, forks the current session, switches you into the fork in the same terminal, and sends the initial prompt there without adding it to the parent transcript

No nesting.

# name clash
A plugin package opencode-btw already exists. It is not an attempt to emulate Claude Code, it provides persistent steering hints. 


## Install

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

List the same package spec in both config files for normal usage. If you pin or bump versions, update both files together; otherwise the server slash shims and the same-window TUI session handlers can run different plugin versions.

The two entries are both required:
- the TUI plugin implements `/btw`, `/btw-merge`, and `/btw-end`
- the server plugin registers slash-command shims so typed `/btw`, `/btw-merge`, and `/btw-end` submissions dispatch to those TUI handlers in current OpenCode
- the server plugin also provides `/btw-prompt some prompt` and the `btw-status` diagnostic command

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
  "plugin": ["opencode-bytheway@0.3.8"]
}
```

`tui.jsonc`:

```jsonc
{
  "plugin": ["opencode-bytheway@0.3.8"]
}
```

Restart OpenCode after installing or updating the plugin.

Troubleshooting:
- if `btw-status` or `/btw-prompt` appears but `/btw` does not open a side session, the package is loaded in `opencode.json[c]` but missing from `tui.json[c]`
- if `/btw` appears only through autocomplete/direct selection but typed `/btw` submission does not work, the package is loaded in `tui.json[c]` but missing from `opencode.json[c]`
- if `/btw-status` reports different server and TUI versions, update both config files to the same package spec and restart OpenCode
- reload or restart OpenCode after changing either config

Optional command-family override:

```bash
OPENCODE_BYTHEWAY_COMMAND=aside
```

With that env var set, the TUI plugin exposes `/aside`, `/aside-merge`, and `/aside-end` instead of the default `/btw` family.
The server-side `/btw-prompt` command stays fixed.

## Commands

- `/btw`: open a temporary btw side session in the same terminal, preserving context from the current session
- `/btw-merge`: append plain user/assistant text from the temporary session back into the original session, then close the temporary session
- `/btw-end`: return to the original session and remove the temporary btw session without carrying text back
- `/btw-prompt your prompt here`: experimental server-side entrypoint that is dispatched directly by the server hook, writes a prompt handoff, and triggers the existing TUI-owned `/btw` open flow so the initial prompt runs inside the forked temp session

## User experience

- `/btw` is for branching off in the same terminal while keeping your main session intact
- `/btw-merge` carries back only plain user/assistant text from the temporary session; tool calls and subagent details are omitted
- `/btw-end` is the clear way back when you want to discard the temporary session without merging text back
- nested btw sessions are blocked to avoid stacked temporary contexts

## Local development

```bash
bun install --ignore-scripts
bun run build
bun run test
bun run test:server-debug
npm pack --dry-run
```

For local OpenCode testing, point both `tui.json[c]` and `opencode.json[c]` at this repository path after running `bun run build`.

After changing `tui.tsx`, run `bun run build` again before reopening or reloading OpenCode so the local plugin uses the updated `dist/tui.js`.

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

When testing locally, put the package root in `tui.json[c]` for the TUI workflow and in `opencode.json[c]` for typed slash-command dispatch, `/btw-prompt`, and `btw-status`.

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

`/btw-prompt` is intercepted in `command.execute.before`, so it does not need a model call just to forward the raw command arguments.
It writes a lightweight prompt handoff and asks the TUI to execute `btw.open`, so the initial prompt runs inside the existing fork-based `/btw` flow.

For same-process IDE debugging of the server tool, use the focused Bun harness in `server.debug.test.ts`.
This harness uses a mocked prompt result so you can step through the extraction logic in `index.js` without starting OpenCode itself.

Suggested WebStorm workflow:
1. Open `server.debug.test.ts`.
2. Set breakpoints in `index.js` inside `opencode_bytheway_plugin_open.execute` or `enter`.
3. In WebStorm, run `server.debug.test.ts` in Debug mode, or create a Bun run/debug configuration for `bun test ./server.debug.test.ts`.
4. If you want to debug the broader existing suite instead, use `tui.test.tsx` and target the `opencode_bytheway_plugin_open` tests.

## Release

- CI runs from repo root
- release publishes from repo root
- tag format is `v*`
- verify both plugin halves load after install:
  - server: `btw-status`
  - TUI: `/btw`, `/btw-merge`, `/btw-end`
  - optional experimental server command: `/btw-prompt`

Example:

```bash
git tag v0.3.8
git push origin v0.3.8
```
