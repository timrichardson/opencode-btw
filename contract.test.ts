import { expect, test } from "bun:test";
import source from "./tui";

test("exports one dual-runtime plugin module", () => {
  expect(source.id).toBe("opencode-bytheway");
  expect(source.tui).toBeFunction();
  expect(source.setup).toBeFunction();
});

test("built package preserves both runtime entrypoints", async () => {
  const built = (await import(`./dist/tui.js?test=${Date.now()}`)).default;
  const v1Layers: Array<{ commands?: Array<{ name: string }> }> = [];
  const v2Layers: Array<() => { commands: Array<{ id: string }> }> = [];
  const v2Slots: string[] = [];
  const v2Disposed = { value: false };

  expect(built.id).toBe("opencode-bytheway");
  await built.tui({
    route: { current: { name: "home" } },
    kv: { ready: true, get: () => undefined, set: () => undefined },
    keymap: {
      registerLayer(layer: { commands?: Array<{ name: string }> }) {
        v1Layers.push(layer);
        return () => undefined;
      },
    },
    slots: { register: () => undefined },
  });
  const dispose = await built.setup({
    storage: {
      store: () => [{ active: null }, async () => undefined],
    },
    keymap: {
      layer: (layer: () => { commands: Array<{ id: string }> }) => v2Layers.push(layer),
    },
    ui: {
      router: { current: () => ({ type: "home" }) },
      slot: (claim: { append: string; render: () => unknown }) => {
        v2Slots.push(claim.append);
        if (claim.append === "app") claim.render();
        return () => {
          v2Disposed.value = true;
        };
      },
    },
  });

  expect(v1Layers.flatMap((layer) => layer.commands ?? []).some((command) => command.name === "btw-status")).toBe(true);
  expect(v2Layers.flatMap((layer) => layer().commands).some((command) => command.id === "btw.status")).toBe(true);
  expect(v2Slots).toContain("sidebar.content");
  expect(dispose).toBeFunction();
  dispose();
  expect(v2Disposed.value).toBe(true);
});
