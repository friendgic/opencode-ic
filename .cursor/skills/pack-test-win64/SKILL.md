---
name: pack-test-win64
description: 当用户消息包含“打包测试”时，在 packages/opencode 用 bun 仅构建 windows-x64（可设 OPENCODE_VERSION），将 dist/opencode-windows-x64/bin/opencode.exe 复制到用户 Windows 盘路径（默认 WSL /mnt/i/_Projects/opencdeIC/opencode.exe）。
---

# 打包测试（Win64）

## 触发条件

- 用户消息包含 `打包测试`。

## 执行步骤

1. 在 `packages/opencode` 目录仅执行 Windows x64 构建：
   - 需要固定运行时版本时：`OPENCODE_VERSION=<例如 1.14.46-ic> bun run build:windows-x64`
   - 否则：`bun run build:windows-x64`
2. 构建成功后，复制产物：
   - 源：`packages/opencode/dist/opencode-windows-x64/bin/opencode.exe`（绝对路径按工作区根目录解析）
   - 默认目标（WSL）：`/mnt/i/_Projects/opencdeIC/opencode.exe`（对应 `I:\_Projects\opencdeIC\opencode.exe`）
3. 返回执行结果时，明确：
   - 构建是否成功
   - 拷贝是否成功
   - 最终文件路径

## 约束

- 在 `packages/opencode` 下执行，勿在仓库根目录跑测试类命令（见 `AGENTS.md`）。
- 若目标文件被占用导致覆盖失败，提示用户关闭正在运行的 `opencode.exe` 后重试。
- 若默认目标盘符/目录不存在，先说明并让用户确认路径再继续。
