import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "./schema"
import { Schema } from "effect"

/** Emitted immediately before each `streamText` call (client payload ≈ chars, not vendor tokens). */
export const LLMRequestEvent = {
  Summary: BusEvent.define(
    "session.llm.request",
    Schema.Struct({
      sessionID: SessionID,
      assistantMessageID: Schema.String,
      approxTotalChars: Schema.Number,
      messagesTotalChars: Schema.Number,
      toolsTotalChars: Schema.Number,
      messageCount: Schema.Number,
      toolCount: Schema.Number,
    }),
  ),
}
