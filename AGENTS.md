# AGENTS.md

## Purpose

This repository contains the standalone `opencode-bytheway` OpenCode plugin.

It provides the `/btw`, `/btw_end`, and `/btw_popup` workflows for temporary side sessions and one-off popup questions.

## Important Files

- `index.js`: server-side plugin entry. Defines the plugin `id` and the local `btw_status` development tool.
- `tui.tsx`: TUI plugin implementation. This is where slash commands, session state, navigation, and popup flow live.
- `tui.test.tsx`: Bun test coverage for the TUI behavior.
- `scripts/build.ts`: builds `tui.tsx` into `dist/tui.js`.
- `dist/tui.js`: built artifact published by the package. Rebuild it after changing `tui.tsx`.

## Runtime Invariants

- Keep the runtime plugin id aligned with the published package name: `opencode-bytheway`.
- Keep the session storage key aligned too: `opencode-bytheway.active`.
- If either value changes in `index.js` or `tui.tsx`, update tests and rebuild `dist/tui.js` in the same change.
- Avoid changing slash command names unless the user explicitly asks for a behavior change.

## Local Development

Use Bun for local work.

```bash
bun install --ignore-scripts
bun run build
bun run test
```

Useful extra check before release work:

```bash
npm pack --dry-run
```

## Editing Guidance

- Prefer small changes in `tui.tsx`; most behavior is intentionally kept in one file.
- Do not add compatibility aliases for old plugin ids or state keys unless there is a concrete migration requirement.
- Preserve the existing command behavior around blocked nested `/btw` sessions and cleanup of temporary sessions.
- When changing user-visible copy, update tests if they assert the string.

## Verification Expectations

After code changes:

1. Run `bun run build` if `tui.tsx` changed.
2. Run `bun run test` for behavioral changes.
3. Confirm generated `dist/tui.js` reflects any runtime identifier or command changes.

## Config Notes

Example OpenCode config entry:

```json
{
  "plugin": ["opencode-bytheway@latest"]
}
```

If OpenCode still reports the old plugin after a rename or rebuild, the user may need to restart or reload plugins so the new module instance is picked up.
