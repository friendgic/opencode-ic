import z from "zod"
import { ConfigPlugin } from "@/config/plugin"
import { TuiKeybind } from "./keybind"

export const KeymapLeaderTimeoutDefault = 2000
const KeymapLeaderTimeout = z.number().int().positive().describe("Leader key timeout in milliseconds")

export const TuiOptions = z.object({
  leader_timeout: KeymapLeaderTimeout.optional(),
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  mouse: z.boolean().optional().describe("Enable or disable mouse capture (default: true)"),
  notify_on_idle: z
    .boolean()
    .optional()
    .describe(
      "When true, run notify_on_idle_command once per reply when session status goes from busy/retry to idle (use for system notifications)",
    ),
  notify_on_idle_command: z
    .string()
    .optional()
    .describe(
      "Shell command executed on idle (non-blocking). Use $SESSION_ID and $WORKSPACE_ID placeholders. Also set in env: OPENCODE_SESSION_ID, OPENCODE_WORKSPACE_ID, OPENCODE_NOTIFY_KIND=idle. On Unix sh -c is used; on Windows cmd /c.",
    ),
  notify_on_question: z
    .boolean()
    .optional()
    .describe(
      "When true, run notify_on_question_command (or notify_on_idle_command if unset) when the question tool presents choices and input is needed",
    ),
  notify_on_question_command: z
    .string()
    .optional()
    .describe(
      "Optional shell command for question prompts; defaults to notify_on_idle_command. Placeholders: $SESSION_ID, $WORKSPACE_ID, $QUESTION_ID, $QUESTION_PREVIEW. Env: OPENCODE_NOTIFY_KIND=question, OPENCODE_QUESTION_ID, OPENCODE_QUESTION_PREVIEW.",
    ),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: TuiKeybind.KeybindOverrides.optional(),
    plugin: ConfigPlugin.Spec.zod.array().optional(),
    plugin_enabled: z.record(z.string(), z.boolean()).optional(),
  })
  .extend(TuiOptions.shape)
  .strict()

export const TuiJsonSchemaInfo = TuiInfo
