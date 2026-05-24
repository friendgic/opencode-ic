import { EventV2 } from "@opencode-ai/core/event"
import { SessionID } from "./schema"
import { Schema } from "effect"

export const LLMRequestEvent = {
  Summary: EventV2.define({
    type: "session.llm.request",
    schema: {
      sessionID: SessionID,
      assistantMessageID: Schema.String,
      approxTotalChars: Schema.Number,
      messagesTotalChars: Schema.Number,
      toolsTotalChars: Schema.Number,
      messageCount: Schema.Number,
      toolCount: Schema.Number,
    },
  }),
}
