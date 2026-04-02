function osc(text: string) {
  if (!process.stdout.isTTY) return false
  const data = Buffer.from(text).toString("base64")
  const osc = `\x1b]52;c;${data}\x07`
  const wrap = process.env["TMUX"] || process.env["STY"]
  process.stdout.write(wrap ? `\x1bPtmux;\x1b${osc}\x1b\\` : osc)
  return true
}

async function native(text: string) {
  try {
    const mod = await import("clipboardy")
    await mod.default.write(text)
    return true
  } catch {
    return false
  }
}

export async function copy(text: string) {
  const oscok = osc(text)
  const nativeok = await native(text)
  if (oscok || nativeok) return
  throw new Error("Failed to copy to clipboard")
}
