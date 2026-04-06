# opencode-bytheway

OpenCode TUI plugin that adds temporary "by the way" side-session workflows.

A proof-of-concept plugin to implement something like Claude Code's "btw" feature, where you can branch into a temporary side session, then discard it or merge text back into the parent session when you are done.

`/btw` is queued like any other OpenCode command when the current session is busy.

Normal usage:
- run `/btw` and then type in the temp session

Experimental server-side entrypoint:
- run `/experimental-btw your prompt here` to open the temp session, seed it with that prompt, and return the reply

No nesting.

# name clash
A plugin package opencode-btw already exists. It is not an attempt to emulate Claude Code, it provides persistent steering hints. 


## Install

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

For `/btw`, `/btw_merge`, and `/btw_end`, list this package in `tui.json[c]`.
List it in `opencode.json[c]` too if you want:
- `/experimental-btw some prompt` to seed the temp session immediately
- the `btw-status` diagnostic command

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
- `/experimental-btw your prompt here`: experimental server-side entrypoint that opens a temporary session, immediately sends that prompt into it, and returns the reply

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

## Release

- CI runs from repo root
- release publishes from repo root
- tag format is `v*`
- verify both plugin halves load after install:
  - server: `btw-status`
  - TUI: `/btw`, `/btw_merge`, `/btw_end`
  - optional experimental server command: `/experimental-btw`

Example:

```bash
git tag v0.2.2
git push origin v0.2.2
```
