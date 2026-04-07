# Changelog

## 0.3.5

- refine the published package metadata description to better describe the Claude Code-inspired btw workflow
- include the plugin version in `/btw-status` output so loaded builds are easier to identify in TUI

## 0.3.4

- refine the published package metadata description to better describe the Claude Code-inspired btw workflow

## 0.3.3

- rename the remaining `/btw` slash-command family members to hyphenated forms: `/btw-merge` and `/btw-end`
- keep command-family overrides consistent with the same hyphenated naming, such as `/aside-merge` and `/aside-end`

## 0.3.2

- rename the experimental server-side prompt command to `/btw-prompt`
- route `/btw-prompt` through the existing TUI-owned `/btw` open flow so the initial prompt runs inside the forked session
- namespace and scope prompt handoff files to the origin session to avoid cross-session collisions during local testing

## 0.3.1

- scope `/btw` command visibility to the current session so unrelated sessions do not incorrectly show `/btw-end`
- handle `/btw-status` directly in the TUI with a toast instead of sending it through the agent loop

## 0.3.0

- add direct non-LLM dispatch for `/btw-prompt` while keeping the proven TUI handoff flow
- remove temporary debug slash commands and trim unused server helpers
- improve experimental runtime logging for live debugging and restore the file-based prompt handoff after the parent-linked refactor failed in the live host

## 0.2.3

- add direct non-LLM dispatch for `/btw-prompt` while keeping the proven TUI handoff flow
- remove temporary debug slash commands and trim unused server helpers
- improve experimental runtime logging for live debugging and restore the file-based prompt handoff after the parent-linked refactor failed in the live host

## 0.2.2

- restore `/btw` to TUI-only ownership and move the seeded server-side entrypoint to `/btw-prompt`

## 0.2.1

- publish the side-session-only release from the OIDC trusted publishing workflow

## 0.2.0

- remove `/btw_popup` and its popup-dialog runtime so the plugin focuses on temporary side sessions
- load active bytheway sessions cleanly, keep the sidebar indicator aligned with the active temp session, and improve command-family overrides for local installs

## 0.1.5

- align the runtime plugin id with the published package name and add direct server-entry coverage
- harden popup and temp-session cleanup for canceled runs and failed `/btw-end` deletes
- add an optional `OPENCODE_BYTHEWAY_COMMAND` env var to rename the `/btw` slash-command family
- pin Bun in CI and release workflows and document local `file://` plugin development setup

## 0.1.4

- publish a clean release from the planner-aligned workflow after the earlier workflow-only tags failed before matching package metadata

## 0.1.2

- align the standalone release workflow more closely with `opencode-planner` before the next publish attempt

## 0.1.1

- rename the npm package to `opencode-bytheway` so the standalone repo can publish under a clean available name

## 0.1.0

- add `/btw` for same-terminal temporary side sessions
- add `/btw-end` to return to the original session and close the temp session
- add `/btw_popup` for one-off popup questions that preserve the current screen
- improve popup rendering, copy feedback, and streaming stability
- publish from the standalone `opencode-btw` repository using a root package and root release workflow
