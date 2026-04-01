import { fileURLToPath } from "url"

const root = fileURLToPath(new URL("..", import.meta.url))
const entry = fileURLToPath(new URL("../tui.tsx", import.meta.url))
const outdir = fileURLToPath(new URL("../dist", import.meta.url))

const result = await Bun.build({
  entrypoints: [entry],
  outdir,
  naming: "[name].js",
  format: "esm",
  target: "bun",
  packages: "external",
  external: ["solid-js", "solid-js/h"],
})

if (!result.success) {
  for (const item of result.logs) console.error(item)
  process.exit(1)
}

await Bun.write(new URL("../dist/package.json", import.meta.url), '{"type":"module"}\n')

console.log(`built opencode-bytheway in ${root}`)
