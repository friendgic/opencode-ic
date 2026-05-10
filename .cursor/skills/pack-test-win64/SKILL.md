---
name: pack-test-win64
description: 当用户消息包含“打包测试”时，执行 Windows x64 打包并拷贝产物。只运行 packages/opencode 的 build:windows-x64，随后将 packages/opencode/dist/opencode-windows-x64/bin/opencode.exe 复制到 I:\\_Projects\\opencdeIC\\opencode.exe。
---

# 打包测试（Win64）

## 触发条件

- 用户消息包含 `打包测试`。

## 执行步骤

1. 在 `packages/opencode` 目录执行：
   - `bun run build:windows-x64`
2. 构建成功后，复制产物：
   - 源：`/home/aixi/projects/opencode/packages/opencode/dist/opencode-windows-x64/bin/opencode.exe`
   - 目标：`/mnt/i/_Projects/opencdeIC/opencode.exe`
3. 返回执行结果时，明确：
   - 构建是否成功
   - 拷贝是否成功
   - 最终文件路径

## 约束

- 不运行全平台构建，不运行 `build` 或 `build:windows`。
- 仅使用 `build:windows-x64`。
- 如果目标目录不存在，先提示并等待用户确认目标路径后再继续。
