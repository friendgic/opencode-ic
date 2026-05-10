import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"
import "opentui-spinner/solid"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: {
  children?: JSX.Element
  color?: RGBA | ColorGenerator
  frames?: string[]
  interval?: number
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  const textFg = () => {
    const c = props.color
    if (c === undefined) return theme.textMuted
    if (typeof c === "function") return theme.textMuted
    return c
  }
  const frames = () => props.frames ?? SPINNER_FRAMES
  const interval = () => props.interval ?? 80
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={frames()} interval={interval()} color={color()} />
        <Show when={props.children}>
          <text fg={textFg()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
