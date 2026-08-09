import { TextAttributes } from "@opentui/core";
import type { Plugin } from "@opencode-ai/plugin/tui";
import { Show } from "solid-js";
import { endname, openname, slash } from "./protocol.js";

export function BtwIndicator(props: { context: Plugin.Context; active: boolean }) {
  const theme = props.context.theme;

  return (
    <Show when={props.active}>
      <box
        border
        borderColor={theme.text.feedback.info.default}
        backgroundColor={theme.background.feedback.info.default}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.text.feedback.info.default} attributes={TextAttributes.BOLD}>
          {slash(openname())} session active
        </text>
        <text fg={theme.text.subdued} wrapMode="word">
          Run {slash(endname())} to return to the original session as it is now
        </text>
      </box>
    </Show>
  );
}
