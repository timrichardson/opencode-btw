import clipboardy from "clipboardy"

function osc(text: string) {
  if (!process.stdout.isTTY) return
  const data = Buffer.from(text).toString("base64")
  const osc = `\x1b]52;c;${data}\x07`
  const wrap = process.env["TMUX"] || process.env["STY"]
  process.stdout.write(wrap ? `\x1bPtmux;\x1b${osc}\x1b\\` : osc)
}

export async function copy(text: string) {
  osc(text)
  await clipboardy.write(text)
}
