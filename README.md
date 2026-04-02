# opencode-bytheway

OpenCode TUI plugin that adds temporary "by the way" side-session workflows.

A proof-of-concept plugin repository modeled after `opencode-planner`, but for the `/btw` workflow family.

## Install

Add the package to your OpenCode plugin config:

```json
{
  "plugin": ["opencode-bytheway"]
}
```

Optional version pin:

```json
{
  "plugin": ["opencode-bytheway@0.2.0"]
}
```

Restart OpenCode after installing or updating the plugin.

Optional command-family override:

```bash
OPENCODE_BYTHEWAY_COMMAND=aside
```

With that env var set, the plugin exposes `/aside` and `/aside_end` instead of the default `/btw` family.

## Commands

- `/btw`: open a temporary btw side session in the same terminal, preserving context from the current session
- `/btw_end`: return to the original session and remove the temporary btw session

## User experience

- `/btw` is for branching off in the same terminal while keeping your main session intact
- `/btw_end` is the clear way back from that temporary side session
- nested btw sessions are blocked to avoid stacked temporary contexts

## Local development

```bash
bun install --ignore-scripts
bun run build
bun run test
npm pack --dry-run
```

For local OpenCode testing, point your plugin config at this repository path after running `bun run build`.

OpenCode 1.3.x loads server plugins from `opencode.json[c]` and TUI plugins from `tui.json[c]`, so a mixed server/TUI package like this one needs the package root listed in both configs when testing locally.

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

Example:

```bash
git tag v0.2.0
git push origin v0.2.0
```
