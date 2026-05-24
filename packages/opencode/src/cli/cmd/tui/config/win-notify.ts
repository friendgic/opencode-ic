import path from "path"
import { mkdir } from "node:fs/promises"
import { Global } from "@opencode-ai/core/global"
import template from "./msg.ps1" with { type: "text" }

const SCRIPT = "msg.ps1"
let scriptPath = ""
let ready: Promise<void> | undefined

export function winNotifyScriptPath() {
  return path.join(Global.Path.config, SCRIPT)
}

export async function ensureWinNotifyScript() {
  if (process.platform !== "win32") return
  const target = winNotifyScriptPath()
  if (await Bun.file(target).exists()) return
  await mkdir(Global.Path.config, { recursive: true })
  await Bun.write(target, template)
}

export async function initWinNotify() {
  if (process.platform !== "win32") return
  await ensureWinNotifyScript()
  scriptPath = winNotifyScriptPath()
}

function ensureReady() {
  if (!ready) ready = initWinNotify()
  return ready
}

export async function runWinNotify(extraEnv: Record<string, string>) {
  if (process.platform !== "win32") return
  await ensureReady()
  if (!scriptPath) return
  try {
    Bun.spawn(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
      env: { ...process.env, ...extraEnv },
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    })
  } catch {
    // External notify must not break the TUI
  }
}

export function winNotifyCommand() {
  if (!scriptPath) return ""
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath.replace(/"/g, '""')}"`
}
