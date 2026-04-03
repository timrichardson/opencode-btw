# opencode-bytheway

OpenCode TUI plugin that adds temporary "by the way" side-session workflows.

A proof-of-concept plugin to implement something like Claude Code's "btw" feature, where you can branch into a temporary side session, then discard it or merge text back into the parent session when you are done.

`/btw` is queued like any other OpenCode command when the current session is busy.

You can either:
- run `/btw` and then type in the temp session
- run `/btw your prompt here` to open the temp session and immediately seed it with that prompt

No nesting.

# name clash
A plugin package opencode-btw already exists. It is not an attempt to emulate Claude Code, it provides persistent steering hints. 


## Install

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

For `/btw`, `/btw_merge`, and `/btw_end`, list this package in `tui.json[c]`.
List it in `opencode.json[c]` too if you want:
- `/btw some prompt` to seed the temp session immediately
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
  "plugin": ["opencode-bytheway@0.2.1"]
}
```

Restart OpenCode after installing or updating the plugin.

Troubleshooting:
- if `btw-status` appears but `/btw` does not, the package is loaded in `opencode.json[c]` but missing from `tui.json[c]`
- if `/btw` works but `/btw some prompt` or `btw-status` does not, the package is loaded in `tui.json[c]` but missing from `opencode.json[c]`
- reload or restart OpenCode after changing either config

Optional command-family override:

```bash
OPENCODE_BYTHEWAY_COMMAND=aside
```

With that env var set, the plugin exposes `/aside`, `/aside_merge`, and `/aside_end` instead of the default `/btw` family.

## Commands

- `/btw`: open a temporary btw side session in the same terminal, preserving context from the current session
- `/btw your prompt here`: open the temporary session and immediately send that prompt into it
- `/btw_merge`: append plain user/assistant text from the temporary session back into the original session, then close the temporary session
- `/btw_end`: return to the original session and remove the temporary btw session without carrying text back

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
Also point `opencode.json[c]` at it if you want `/btw some prompt` support or the `btw-status` diagnostic command.

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`.

When testing locally, put the package root in `tui.json[c]` for `/btw`, `/btw_merge`, and `/btw_end`.
Add the same package root to `opencode.json[c]` if you also want `/btw some prompt` support or the `btw-status` diagnostic command.

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

## Release

- CI runs from repo root
- release publishes from repo root
- tag format is `v*`
- verify both plugin halves load after install:
  - server: `btw-status`
  - TUI: `/btw`, `/btw_merge`, `/btw_end`

Example:

```bash
git tag v0.2.1
git push origin v0.2.1
```
