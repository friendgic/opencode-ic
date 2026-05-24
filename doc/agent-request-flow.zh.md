# 向 Agent 提问时：端到端发生了什么

本文说明在 OpenCode（`packages/opencode`）里，当你在会话中向 Agent 发送一条消息后，服务端大致做了哪些事情：**消息如何落库并转成发给模型的格式**、**如何调用 LLM**、**工具如何被执行**、**回复如何写回并让前端刷新**。

下文以 HTTP 上的会话接口与桌面/Web 客户端为典型路径；核心逻辑在 `SessionPrompt` → `SessionProcessor` → `LLM`（Vercel AI SDK `streamText`）。

---

## 1. 总览：一条调用链

1. **客户端**把用户输入（文本、文件引用、子任务等）发到实例的会话 API（例如 `POST …/session/:sessionID/message`），或经 SDK 等价路径。
2. **`SessionPrompt.prompt`**：清理 revert 状态、**创建并保存用户消息**（含 `parts`）、可选更新会话级工具权限；若需要模型回复则进入 **`loop`**。
3. **`runLoop`（在 `state.ensureRunning` 里跑）**：根据当前会话历史决定是继续对话、处理子任务、触发压缩，还是再开一轮 **assistant 消息**。
4. 每一轮模型调用：**`SessionProcessor`** 为新的 assistant 消息建一个 handle，然后 **`LLM.stream`** 用 **AI SDK `streamText`** 向具体 Provider 发流式请求；流上的事件被 processor 转成 **Session 中的 part 更新**（文本增量、工具块、步骤、用量等）。
5. **工具**：在 `streamText` 里注册的 `tools` 带有 `execute`；模型发出 tool call 时由 **AI SDK 调用 `execute`**，执行路径里跑 OpenCode 的 Effect/tool 逻辑，并把结果再通过 SDK 送回模型（可能多轮），直到 **`finish`** 满足退出条件。
6. **`runLoop`** 根据 assistant 的 `finish reason`、是否还有待处理的 tool、`SessionProcessor.process` 的返回值（`continue` / `stop` / 触发 compact）决定是否再跑一轮 **`handle.process`**。
7. **前端**：通过 SSE/事件流订阅 `message.part.updated` 等事件，把会话 store 对齐到服务端持久化状态，从而在 UI 上看到流式输出与工具结果。

---

## 2. 入口：会话上发一条「prompt」

路由层（例如 `packages/opencode/src/server/routes/instance/session.ts`）收到 JSON body 后，会调用 **`SessionPrompt.Service.prompt`**（Effect），把结果流式或通过异步任务返回客户端。

核心是 **`SessionPrompt.prompt`**（`packages/opencode/src/session/prompt.ts`）：

- 调用 **`createUserMessage`**：把 `parts`（文本、`file`、`agent`、`subtask` 等）解析成最终写入 DB 的用户消息与各 part；触发插件钩子 `chat.message`；**`sessions.updateMessage` / `updatePart`**。
- 若 `noReply` 为 true，只保存用户消息并返回。
- 否则 **`loop({ sessionID })`** → 内部 **`state.ensureRunning(..., runLoop(sessionID))`**，保证同一 session 不会并发乱跑。

---

## 3. 主循环 `runLoop`：什么时候再问一次模型？

`runLoop`（同文件）是一个 **`while (true)`**，每一轮通常会：

1. 拉取 **`MessageV2.filterCompactedEffect`** 后的消息列表。
2. 从尾部向前找 **`lastUser` / `lastAssistant` / `lastFinished`**，并收集 compaction / subtask 等任务。
3. **退出条件**（简化）：若最近一次 assistant **已结束**（`finish` 存在且不是需要继续 tool 链路的情况）、**当前轮没有未完成的本工具调用**（`hasToolCalls` 为假），且用户消息在时间序上早于该 assistant → 认为这轮对话对用户的问题已有完整答复，**`break`**。
4. 否则 **`step++`**，可能：**生成标题**（后台 fork）、处理 **subtask**、执行 **compaction**、检查 overflow 是否要自动压缩。
5. 加载 **Agent** 与 **Model**，构造新的 **`MessageV2.Assistant`** 消息并落库。
6. **`processor.create`** 得到本轮的 handle，再在内部 **`resolveTools`** + **`handle.process(streamInput)`**。

`handle.process` 返回 **`"continue"` | `"stop"` | `"compact"`**：

- **`stop`**：权限拒绝等导致 **`ctx.blocked`** 或出错 → **`runLoop`** 里 **`break`**。
- **`compact`** → 触发压缩逻辑后 **`continue`** 下一轮。
- **`continue`** → 循环继续（通常因为还有 tool 回合或 streaming 语义上还要继续）。

另外在 **`structured output`**（JSON Schema）模式下，模型必须调用合成的 `StructuredOutput` 工具；成功后会把结构化结果写到 assistant message 并 **`break`**。

---

## 4. 单轮：`SessionProcessor.process` —— 把 LLM 流变成 Session Part

**`SessionProcessor.create`**（`packages/opencode/src/session/processor.ts`）为当前 assistant 初始化上下文（含快照，用于 afterward 的 patch）。

**`process`**：

1. 调用 **`llm.stream(streamInput)`**，得到 **`Stream<Event>`**（来自 AI SDK `fullStream` 的事件类型）。
2. 对每一条事件 **`handleEvent`**：
   - **`start`**：会话 busy。
   - **`text-start` / `text-delta` / `text-end`**：写入或增量更新 **`text` part**；结束时触发 `experimental.text.complete` 插件。
   - **`reasoning-*`**：推理文本块。
   - **`tool-input-*` / `tool-call`**：创建或更新 **`tool` part**（pending → running）；含 **doom loop** 检测与权限询问。
   - **`tool-result` / `tool-error`**： **`completeToolCall`** 或 **`failToolCall`**（失败时可能 **`Permission.RejectedError` / `Question.RejectedError`** → **`blocked`**）。
   - **`start-step` / `finish-step`**：步骤边界、用量、费用、快照 patch、异步 summary。
   - **`finish`**：本轮流结束。
3. **`cleanup`**：收尾未完成文本/推理/tool、flush patch、更新 assistant **`time.completed`**。

若流被中断，会标记 abort 并报错事件。

---

## 5. `LLM.stream` —— 消息如何组装并发给 Provider

**`LLM.run`**（`packages/opencode/src/session/llm.ts`）在 Effect 里：

1. 取 **语言模型句柄**（`provider.getLanguage`）、**配置**、**Provider 元数据**、**认证**。
2. 拼 **system**：
   - Agent 自带的 `prompt`，否则 **`SystemPrompt.provider(model)`**；
   - 外加本轮传入的 **`system`** 数组与用户信息里的 **`user.system`**；
   - 插件 **`experimental.chat.system.transform`** 可改写 system。
3. 把 **`StreamInput.messages`**（已是 AI SDK **`ModelMessage[]`**）与 system 合成最终 **`messages`**（OpenAI OAuth 与 GitLab Workflow 等特殊路径略有分支）。
4. 插件钩子 **`chat.params`**、**`chat.headers`** 可改温度、max tokens、自定义头等。
5. **`resolveTools(input)`**：按 **Agent + 会话权限 + `user.tools` 勾选**过滤掉禁用工具；必要时注入 LiteLLM / Copilot 兼容用的 **`_noop`** 占位工具。
6. 调用 **`streamText({ model, messages, tools, … })`**：
   - `model` 经 **`wrapLanguageModel`** + **`ProviderTransform.message`** 等中间层处理；
   - **`abortSignal`** 来自 **`LLM.stream` 创建的 `AbortController`**；
   - 返回对象的 **`fullStream`** 被包成 **`Stream.fromAsyncIterable`** 供 Effect 消费。

因此：**发往 LLM 的「聊天记录」不是原始 UI 对象，而是经 `MessageV2.toModelMessagesEffect`（在 `prompt.ts` 里与 skills/env/instruction 一并准备）转成 SDK 可用的多轮对话结构**；system 与用户消息上的附加提示也在这一层一并进入请求。

---

## 6. 工具如何被调用、结果如何回去

### 6.1 工具从哪里来

**`resolveTools`**（`prompt.ts`）构建传给 `streamText` 的 **`Record<string, Tool>`**：

1. **`ToolRegistry.tools(...)`**：内置工具（read、grep、bash、task……），每个落成 AI SDK **`tool({ description, inputSchema, execute })`**。
2. **MCP**：`mcp.tools()` 里的每项同样包一层 **权限 `ask`** 与输出截断等。
3. 若用户请求 **结构化输出**，额外注册 **`StructuredOutput`**。

**`execute` 签名**里是 **`run.promise(Effect.gen(...))`**：在 OpenCode 的 Effect 运行时里执行真正的 **`item.execute(args, ctx)`**，其中 **`ctx`** 含 **`sessionID`、`messageID`、`abortSignal`、`promptOps`、`permission.ask`、以及 **`processor.updateToolCall`** 用作进度/元数据回写。

### 6.2 与 Processor 事件的配合

模型侧流出 tool call 时，AI SDK 会先推 **`tool-input-*` / `tool-call`** 等事件 → **processor** 先把 UI/DB 里的 tool part 建好并标为 running。

 **`execute`** 跑完后，SDK 会继续生成 **`tool-result`** 类事件 → **processor** **`completeToolCall`**，会话里能看到最终 output/title/metadata/attachments。

若执行抛错或未授权，则会走 **`tool-error`** / **`failToolCall`**。

### 6.3 特殊路径：Provider 内执行的工具

某些 Provider（例如 DWS/GitLab Workflow）可能在服务端已执行工具；对应 part 会带 **`metadata.providerExecuted`**。**`runLoop`** 对这种 tool **不会**因「还有待送回模型的 tool」而强行多轮，避免重复执行。

---

## 7. 回复如何回到你眼里

1. **持久化**：上述 **`session.updatePart` / `updateMessage`** 把 assistant 文本块、工具块、步骤、错误等写入实例 DB。
2. **事件总线**：错误等会 **`bus.publish(Session.Event.Error, …)`** 等（与权限/提问事件一起支撑 UI 通知）。
3. **App**：`global-sdk` 订阅服务端 **SSE 事件流**，例如 **`message.part.updated`**，合并 delta 后更新各目录下的 session store（见 `packages/app/src/context/global-sdk.tsx`、`global-sync.tsx`）。

因此：**模型 token 流**在服务端先被落实为 **part 级更新**；客户端主要是 **跟着事件同步会话状态**，而不是浏览器直接连 OpenAI。

---

## 8. 相关源码索引（便于顺藤摸瓜）

| 主题 | 主要位置 |
|------|----------|
| 发消息入口、用户消息落库 | `packages/opencode/src/session/prompt.ts`（`prompt`, `createUserMessage`） |
| 多轮调度、压缩、子任务 | `prompt.ts`（`runLoop`, `loop`, `handleSubtask`） |
| 流事件 → 会话 part | `packages/opencode/src/session/processor.ts` |
| `streamText`、system、tools | `packages/opencode/src/session/llm.ts` |
| HTTP 路由 | `packages/opencode/src/server/routes/instance/session.ts` |
| 历史 → `ModelMessage[]` | `packages/opencode/src/session/message-v2.ts`（`toModelMessagesEffect` 等） |
| 前端事件 | `packages/app/src/context/global-sdk.tsx` |

---

## 9. 小结

- **消息给 LLM**：用户 `parts` → 存成 `MessageV2` → **`toModelMessagesEffect`** 转成 AI SDK 的 **`messages`**，再与 **system**（agent、环境、技能、指令等）一起在 **`streamText`** 里发出。
- **工具**：在 **`streamText` 的 `tools` 表**里注册；模型 tool call → **AI SDK 调 `execute`** → OpenCode Effect 里跑具体工具 + 权限 → 结果经 SDK 回到模型，可循环多步。
- **回复**：**processor** 把流事件写成 **session parts**；客户端通过 **SSE 事件**订阅这些更新，完成「流式」展示。

若你需要英文版或和 `packages/opencode/specs/effect/*.md` 对齐的更细 Effect 分层说明，可以单独再加一篇。
