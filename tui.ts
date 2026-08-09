import { PLUGIN_ID } from "./protocol.js";

type V1Plugin = typeof import("./v1.tsx").default.tui;
type V2Plugin = typeof import("./v2.ts").setup;

const plugin = {
  id: PLUGIN_ID,
  tui: async (...args: Parameters<V1Plugin>) => (await import("./v1.tsx")).default.tui(...args),
  setup: async (...args: Parameters<V2Plugin>) => (await import("./v2.ts")).setup(...args),
};

export default plugin;
