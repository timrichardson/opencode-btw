# opencode-bytheway

OpenCode TUI plugin that adds temporary "by the way" side-session workflows.

A proof-of-concept plugin to implement something like Claude Code's "btw" feature, where you can branch into a temporary side session, then discard it or merge text back into the parent session when you are done.

`/btw` is queued like any other OpenCode command when the current session is busy.

Normal usage:
- run `/btw` and then type in the temp session

Experimental server-side entrypoint:
- run `/experimental-btw your prompt here` to open the temp session and immediately seed it with that prompt
- the server command copies plain user/assistant text context from the current session into a fresh temporary session
- the TUI plugin listens for the marked experimental session update and then switches you into that temp session in the same terminal, showing the initial reply in a dialog without adding it to the parent transcript

No nesting.

# name clash
A plugin package opencode-btw already exists. It is not an attempt to emulate Claude Code, it provides persistent steering hints. 


## Install

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

For `/btw`, `/btw_merge`, and `/btw_end`, list this package in `tui.json[c]`.
List it in `opencode.json[c]` too if you want:
- `/experimental-btw some prompt` to seed the temp session immediately
- the `btw-status` diagnostic command

For the seamless experimental handoff, load the plugin in both `opencode.json[c]` and `tui.json[c]`.

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

Optional version pin:

```jsonc
{
  "plugin": ["opencode-bytheway@0.2.2"]
}
```

Restart OpenCode after installing or updating the plugin.

Troubleshooting:
- if `btw-status` or `/experimental-btw` appears but `/btw` does not, the package is loaded in `opencode.json[c]` but missing from `tui.json[c]`
- if `/btw` works but `/experimental-btw` or `btw-status` does not, the package is loaded in `tui.json[c]` but missing from `opencode.json[c]`
- reload or restart OpenCode after changing either config

Optional command-family override:

```bash
OPENCODE_BYTHEWAY_COMMAND=aside
```

With that env var set, the TUI plugin exposes `/aside`, `/aside_merge`, and `/aside_end` instead of the default `/btw` family.
The server-side `/experimental-btw` command stays fixed.

## Commands

- `/btw`: open a temporary btw side session in the same terminal, preserving context from the current session
- `/btw_merge`: append plain user/assistant text from the temporary session back into the original session, then close the temporary session
- `/btw_end`: return to the original session and remove the temporary btw session without carrying text back
- `/experimental-btw your prompt here`: experimental server-side entrypoint that creates a fresh temporary session, copies plain-text context into it, and relies on the TUI plugin to hand you over to that session

## User experience

- `/btw` is for branching off in the same terminal while keeping your main session intact
- `/btw_merge` carries back only plain user/assistant text from the temporary session; tool calls and subagent details are omitted
- `/btw_end` is the clear way back when you want to discard the temporary session without merging text back
- nested btw sessions are blocked to avoid stacked temporary contexts

## Local development

```bash
bun install --ignore-scripts
bun run build
bun run test
bun run test:server-debug
npm pack --dry-run
```

For local OpenCode testing, point `tui.json[c]` at this repository path after running `bun run build`.
Also point `opencode.json[c]` at it if you want `/experimental-btw` support or the `btw-status` diagnostic command.

After changing `tui.tsx`, run `bun run build` again before reopening or reloading OpenCode so the local plugin uses the updated `dist/tui.js`.

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

When testing locally, put the package root in `tui.json[c]` for `/btw`, `/btw_merge`, and `/btw_end`.
Add the same package root to `opencode.json[c]` if you also want `/experimental-btw` support or the `btw-status` diagnostic command.

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

## Investigating `/experimental-btw`

`/experimental-btw` now copies plain user/assistant text context from the current session into a fresh temporary session without mutating the original conversation.
The TUI plugin reacts to the marked session via `session.updated`/`session.created` events, so this handoff does not rely on polling.

For prompt-payload debugging, use the detached fresh-session probe:

```text
/experimental-btw-fresh-debug-json your prompt here
```

Then inspect:

```text
.opencode/bytheway-debug.json
```

For this temporary investigation path, the plugin also mirrors the same payload to:

```text
/tmp/opencode-bytheway-debug.json
```

That file includes:
- `file`: the exact path that the debug command wrote
- `tempDebugFile`: the fixed `/tmp` mirror path
- `ctx`: the tool context values used to choose the write location
- `processCwd`: the process working directory seen by the plugin
- `extracted`: the plain-text value the current extractor returned
- `seeded`: an inspected view of the full `client.session.prompt(...)` result
- `data`: an inspected view of `seeded.data`

`/experimental-btw-fresh-debug-json` creates a brand new detached session, prompts it directly, and returns the debug payload as JSON text.

The detached debug command writes an initial marker payload before any session creation or prompt work starts.
If neither debug file appears after invoking it, that strongly suggests the live host is not reaching the updated file-writing path at all.

Debug phases you may see in the files:
- `start`: the command started and wrote its first marker
- `before-prompt`: the command is about to call `client.session.prompt(...)`
- `prompt-error`: `client.session.prompt(...)` threw or returned an error-shaped result

For same-process IDE debugging of the server tool, use the focused Bun harness in `server.debug.test.ts`.
This harness uses a mocked prompt result so you can step through the extraction logic in `index.js` without starting OpenCode itself.

Suggested WebStorm workflow:
1. Open `server.debug.test.ts`.
2. Set breakpoints in `index.js` inside `opencode_bytheway_plugin_open.execute`, `enter`, `promptwithdebug`, or `promptresult`.
3. In WebStorm, run `server.debug.test.ts` in Debug mode, or create a Bun run/debug configuration for `bun test ./server.debug.test.ts`.
4. If you want to debug the broader existing suite instead, use `tui.test.tsx` and target the `opencode_bytheway_plugin_open` tests.

The focused harness is for stepping through extraction logic only.
Use `/experimental-btw-fresh-debug-json` when you need the real runtime payload shape from OpenCode without temp-session or current-session reentrancy effects.

## Release

- CI runs from repo root
- release publishes from repo root
- tag format is `v*`
- verify both plugin halves load after install:
  - server: `btw-status`
  - TUI: `/btw`, `/btw_merge`, `/btw_end`
  - optional experimental server command: `/experimental-btw`
  - optional detached debug command: `/experimental-btw-fresh-debug-json`

Example:

```bash
git tag v0.2.2
git push origin v0.2.2
```
