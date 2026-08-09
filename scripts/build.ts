import { fileURLToPath, URL } from "node:url"
import { rm } from "node:fs/promises"
import solidPlugin from "@opentui/solid/bun-plugin"

const root = fileURLToPath(new URL("..", import.meta.url))
const entry = fileURLToPath(new URL("../tui.ts", import.meta.url))
const outdir = fileURLToPath(new URL("../dist", import.meta.url))

await rm(outdir, { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [entry],
  outdir,
  naming: {
    entry: "[name].js",
    chunk: "chunks/[name]-[hash].[ext]",
  },
  format: "esm",
  target: "bun",
  splitting: true,
  packages: "external",
  external: ["solid-js"],
  plugins: [solidPlugin],
})

if (!result.success) {
  for (const item of result.logs) console.error(item)
  process.exit(1)
}

await Bun.write(fileURLToPath(new URL("../dist/package.json", import.meta.url)), '{"type":"module"}\n')

console.log(`built opencode-bytheway in ${root}`)
