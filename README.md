# opencode-bytheway

OpenCode TUI plugin that adds side-session and popup "by the way" workflows.

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
  "plugin": ["opencode-bytheway@0.1.1"]
}
```

Restart OpenCode after installing or updating the plugin.

## Commands

- `/btw`: open a temporary btw side session in the same terminal, preserving context from the current session
- `/btw_end`: return to the original session and remove the temporary btw session
- `/btw_popup`: ask a one-off popup question without navigating away from the current session

## User experience

- `/btw` is for branching off in the same terminal while keeping your main session intact
- `/btw_end` is the clear way back from that temporary side session
- `/btw_popup` is the fast one-off alternative when you do not want navigation
- nested btw sessions are blocked to avoid stacked temporary contexts

## Local development

```bash
bun install --ignore-scripts
bun test ./tui.test.tsx
bun run build
npm pack --dry-run
```

For local OpenCode testing, point your plugin config at this repository path.

## Release

- CI runs from repo root
- release publishes from repo root
- tag format is `v*`

Example:

```bash
git tag v0.1.1
git push origin v0.1.1
```
