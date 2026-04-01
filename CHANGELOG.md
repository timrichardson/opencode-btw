# Changelog

## 0.4.2

- switch package publishing to GitHub OIDC trusted publishing so releases can deploy without an npm token secret

## 0.4.1

- add `/btw` for same-terminal temporary side sessions
- add `/btw_end` to return to the original session and close the temp session
- add `/btw_popup` for one-off popup questions that preserve the current screen
- improve popup rendering, copy feedback, and streaming stability
