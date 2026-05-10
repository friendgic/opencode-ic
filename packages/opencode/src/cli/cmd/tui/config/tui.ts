export * as TuiConfig from "./tui"

import z from "zod"
import path from "path"
import { mergeDeep, unique } from "remeda"
import { Context, Effect, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { isRecord } from "@/util/record"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CurrentWorkingDirectory } from "./cwd"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/config/keybinds"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { Filesystem } from "@/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@opencode-ai/core/npm"
import bundledMsgPs1 from "./msg.ps1" with { type: "file" }

const log = Log.create({ service: "tui.config" })

/** Same as `tui-migrate.ts` — default schema URL for new tui.json files. */
const TUI_SCHEMA_URL = "https://opencode.ai/tui.json"

export const Info = TuiInfo

type Acc = {
  result: Info
}

type State = {
  config: Info
  deps: Array<Fiber.Fiber<void, AppFileSystem.Error>>
}

export type Info = z.output<typeof Info> & {
  // Internal resolved plugin list used by runtime loading.
  plugin_origins?: ConfigPlugin.Origin[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TuiConfig") {}

function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
  if (Filesystem.contains(ctx.directory, file)) return "local"
  // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
  return "global"
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return data
  if (!isRecord(data.tui)) {
    delete data.tui
    return data
  }

  const tui = data.tui
  delete data.tui
  return {
    ...tui,
    ...data,
  }
}

async function resolvePlugins(config: Info, configFilepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], configFilepath)
  }
  return config
}

async function createGlobalDefaultTuiWhenNoTuiExists(projectFiles: string[], opencodeDirs: string[]) {
  if (Flag.OPENCODE_TUI_CONFIG) return
  const existing = await existingTuiConfigFilePaths(projectFiles, opencodeDirs)
  if (existing.length > 0) return
  const target = path.join(Global.Path.config, "tui.json")
  if (await Filesystem.exists(target)) return

  if (process.platform === "win32") {
    const msgPath = path.join(Global.Path.config, "msg.ps1")
    const payload = {
      $schema: TUI_SCHEMA_URL,
      notify_on_idle: true,
      notify_on_question: true,
      notify_on_idle_command: `powershell.exe -NoProfile -File ${msgPath}`,
    }
    await Filesystem.write(target, `${JSON.stringify(payload, null, 2)}\n`).catch((error) => {
      log.debug("failed to create default global tui.json", { path: target, error })
    })
    return
  }

  await Filesystem.write(target, `${JSON.stringify({ $schema: TUI_SCHEMA_URL }, null, 2)}\n`).catch((error) => {
    log.debug("failed to create default global tui.json", { path: target, error })
  })
}

async function existingTuiConfigFilePaths(projectFiles: string[], opencodeDirs: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  const add = async (files: string[]) => {
    for (const file of files) {
      if (seen.has(file)) continue
      if (!(await Filesystem.exists(file))) continue
      seen.add(file)
      out.push(file)
    }
  }
  await add(ConfigPaths.fileInDirectory(Global.Path.config, "tui"))
  if (Flag.OPENCODE_TUI_CONFIG) await add([Flag.OPENCODE_TUI_CONFIG])
  await add(projectFiles)
  for (const dir of opencodeDirs) {
    if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
    await add(ConfigPaths.fileInDirectory(dir, "tui"))
  }
  return out
}

function flattenedTuiForNotifyCheck(raw: Record<string, unknown>) {
  return normalize({ ...raw }) as Record<string, unknown>
}

function anyNotifyKeyConfigured(raw: Record<string, unknown>) {
  const flat = flattenedTuiForNotifyCheck(raw)
  return (
    "notify_on_idle" in flat ||
    "notify_on_question" in flat ||
    "notify_on_idle_command" in flat ||
    "notify_on_question_command" in flat
  )
}

async function ensureDefaultNotifyInTuiJson(filepath: string) {
  if (process.platform !== "win32") return
  const text = await Filesystem.readText(filepath).catch(() => undefined)
  if (!text) return
  let data: unknown
  try {
    data = ConfigParse.jsonc(text, filepath)
  } catch {
    return
  }
  if (!isRecord(data)) return
  if (anyNotifyKeyConfigured(data)) return
  const msgPath = path.join(path.dirname(filepath), "msg.ps1")
  const command = `powershell.exe -NoProfile -File ${msgPath}`
  const next = {
    ...data,
    notify_on_idle: true,
    notify_on_question: true,
    notify_on_idle_command: command,
  }
  await Filesystem.write(filepath, `${JSON.stringify(next, null, 2)}\n`).catch((error) => {
    log.debug("failed to write default notify keys into tui config", { path: filepath, error })
  })
}

async function parentDirsOfExistingTuiConfigs(projectFiles: string[], opencodeDirs: string[]) {
  const out = new Set<string>()
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    if (await Filesystem.exists(file)) out.add(path.dirname(file))
  }
  if (Flag.OPENCODE_TUI_CONFIG && (await Filesystem.exists(Flag.OPENCODE_TUI_CONFIG))) {
    out.add(path.dirname(Flag.OPENCODE_TUI_CONFIG))
  }
  for (const file of projectFiles) {
    out.add(path.dirname(file))
  }
  for (const dir of opencodeDirs) {
    if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      if (await Filesystem.exists(file)) out.add(path.dirname(file))
    }
  }
  return [...out]
}

async function seedBundledMsgPs1(parentDirs: string[]) {
  if (process.platform !== "win32") return
  const text = await Bun.file(bundledMsgPs1).text().catch(() => undefined)
  if (text === undefined) return
  for (const dir of parentDirs) {
    const dest = path.join(dir, "msg.ps1")
    if (await Filesystem.exists(dest)) continue
    await Filesystem.write(dest, text).catch((error) => {
      log.debug("failed to seed msg.ps1", { dir, error })
    })
  }
}

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  const afs = yield* AppFileSystem.Service

  const resolvePlugins = (config: Info, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const plugins = config.plugin
      if (!plugins) return config
      for (let i = 0; i < plugins.length; i++) {
        plugins[i] = yield* Effect.promise(() => ConfigPlugin.resolvePluginSpec(plugins[i], configFilepath))
      }
      return config
    })

  const load = (text: string, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" }),
      )
      const data = ConfigParse.jsonc(expanded, configFilepath)
      if (!isRecord(data)) return {} as Info
      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old opencode.json shape) still get their settings applied.
      const validated = ConfigParse.schema(Info, normalize(data), configFilepath)
      return yield* resolvePlugins(validated, configFilepath)
    }).pipe(
      // catchCause (not tapErrorCause + orElseSucceed) because ConfigParse.jsonc/.schema
      // can sync-throw — those become defects, which orElseSucceed wouldn't catch.
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          log.warn("invalid tui config", { path: configFilepath, cause })
          return {} as Info
        }),
      ),
    )

  const loadFile = (filepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      // Silent-swallow non-NotFound read errors (perms, EISDIR, IO) → log + skip.
      // Matches how parse/schema/plugin failures in load() are handled — every
      // broken-config path degrades gracefully rather than crashing TUI startup.
      const text = yield* afs.readFileStringSafe(filepath).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log.warn("failed to read tui config", { path: filepath, cause })
            return undefined
          }),
        ),
      )
      if (!text) return {} as Info
      return yield* load(text, filepath)
    })

  const mergeFile = (acc: Acc, file: string) =>
    Effect.gen(function* () {
      const data = yield* loadFile(file)
      acc.result = mergeDeep(acc.result, data)
      if (!data.plugin?.length) return

      const scope = pluginScope(file, ctx)
      const plugins = ConfigPlugin.deduplicatePluginOrigins([
        ...(acc.result.plugin_origins ?? []),
        ...data.plugin.map((spec) => ({ spec, scope, source: file })),
      ])
      acc.result.plugin = plugins.map((item) => item.spec)
      acc.result.plugin_origins = plugins
    })

  // Every config dir we may read from: global config dir, any `.opencode`
  // folders between cwd and home, and OPENCODE_CONFIG_DIR.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  yield* Effect.promise(() => migrateTuiConfig({ directories, cwd: ctx.directory }))

  const projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  const opencodeDirs = unique(directories).filter((dir) => dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)
  yield* Effect.promise(async () => {
    await createGlobalDefaultTuiWhenNoTuiExists(projectFiles, opencodeDirs)
    const parentDirs = await parentDirsOfExistingTuiConfigs(projectFiles, opencodeDirs)
    await seedBundledMsgPs1(parentDirs)
    const tuiFiles = await existingTuiConfigFilePaths(projectFiles, opencodeDirs)
    for (const file of tuiFiles) {
      await ensureDefaultNotifyInTuiJson(file)
    }
  }).pipe(Effect.ignore)

  const acc: Acc = {
    result: {},
  }

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* mergeFile(acc, file)
  }

  // 2. Explicit OPENCODE_TUI_CONFIG override, if set.
  if (Flag.OPENCODE_TUI_CONFIG) {
    const configFile = Flag.OPENCODE_TUI_CONFIG
    yield* mergeFile(acc, configFile)
    log.debug("loaded custom tui config", { path: configFile })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* mergeFile(acc, file)
  }

  // 4. `.opencode` directories (and OPENCODE_CONFIG_DIR) discovered while
  // walking up the tree. Also returned below so callers can install plugin
  // dependencies from each location.
  const dirs = opencodeDirs

  for (const dir of dirs) {
    if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      yield* mergeFile(acc, file)
    }
  }

  const keybinds = { ...(acc.result.keybinds ?? {}) }
  if (process.platform === "win32") {
    // Native Windows terminals do not support POSIX suspend, so prefer prompt undo.
    keybinds.terminal_suspend = "none"
    keybinds.input_undo ??= unique([
      "ctrl+z",
      ...ConfigKeybinds.Keybinds.shape.input_undo.parse(undefined).split(","),
    ]).join(",")
  }
  acc.result.keybinds = ConfigKeybinds.Keybinds.parse(keybinds)

  return {
    config: acc.result,
    dirs: acc.result.plugin?.length ? dirs : [],
  }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const npm = yield* Npm.Service
    const data = yield* loadState({ directory })
    const deps = yield* Effect.forEach(
      data.dirs,
      (dir) =>
        npm
          .install(dir, {
            add: [
              {
                name: "@opencode-ai/plugin",
                version: InstallationLocal ? undefined : InstallationVersion,
              },
            ],
          })
          .pipe(Effect.forkScoped),
      {
        concurrency: "unbounded",
      },
    )

    const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))

    const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
      Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
    )
    return Service.of({ get, waitForDependencies })
  }).pipe(Effect.withSpan("TuiConfig.layer")),
)

export const defaultLayer = layer.pipe(Layer.provide(Npm.defaultLayer), Layer.provide(AppFileSystem.defaultLayer))

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function waitForDependencies() {
  await runPromise((svc) => svc.waitForDependencies())
}

export async function get() {
  return runPromise((svc) => svc.get())
}
