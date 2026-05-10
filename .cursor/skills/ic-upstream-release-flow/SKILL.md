---
name: ic-upstream-release-flow
description: >-
  Guides rebasing friendgic/opencode-ic onto a new upstream OpenCode git tag: fetch
  upstream, squash local commits, cherry-pick onto a branch from the official tag,
  build with OPENCODE_VERSION, pack test, then after user confirms—push and publish
  Windows GitHub Release. Use when the user names a new official version, wants to
  merge fork changes onto upstream, or says 合并官方版 / 发布 release / IC 同步上游.
---

# IC fork：对齐官方版本 → 打包测试 → 推送与 Release

本仓库默认分支为 `dev`；fork 工作常在自定义分支（如 `ic-v1.14.xx`）上完成。上游远程名以下统称 `upstream`（若未配置则先添加）。

## 1. 用户提供新的官方版本

- 向用户确认：**上游仓库 URL**、**标签或提交**（例如 `v1.14.46`）。
- 配置并拉取：
  - `git remote add upstream <官方仓库 URL>`（若尚无）
  - `git fetch upstream --tags`
  - `git show upstream/vX.Y.Z` 或 `git rev-parse upstream/vX.Y.Z` 确认存在

## 2. 拉取 Git，并把当前本地改动压成「一个提交」

在**当前承载你所有 fork 改动的分支**上操作（记为 `旧基线分支`）。

- 与远端同步：`git fetch origin`
- 确定 squash 范围：从 **fork 与上游分叉点** 或 **你已知的 fork 基线 tag/分支** 到当前 `HEAD` 的所有提交。
- 压成单提交（任选其一，保持历史干净即可）：
  - **软重置到基线再提交**：`git reset --soft <基线提交>` → `git commit -m "ic: <一句话说明所有改动>"`
  - 或使用 `git merge-base` + `git reset --soft` 得到与上游共祖之后的全部改动一次性提交
- 记录该提交的 hash：`SQUASH=<hash>`（后续 cherry-pick 用）

## 3. 从官方版本拉分支，再合并你的更改

- 基于官方标签建分支（命名示例）：  
  `git checkout -b ic-vX.Y.Z upstream/vX.Y.Z`  
  若本地要先存标签副本：`git branch upstream-vX.Y.Z upstream/vX.Y.Z`
- 应用你的单提交：  
  `git cherry-pick SQUASH`  
  若有冲突：按文件解决后 `git cherry-pick --continue`；冲突过多时可中止后改用手动挑选文件，但优先保持「一个 ic 提交」便于下次再 rebase。
- 版本号约定：
  - `packages/opencode/package.json` 的 `version` 与上游对齐或改为 `X.Y.Z-ic`（按团队约定）。
  - **运行时显示版本**：在 `packages/opencode` 构建时设置  
    `OPENCODE_VERSION=X.Y.Z-ic`（否则非 `latest` 渠道可能变成 `0.0.0-<branch>-<时间戳>`）。

## 4. 打包测试

- **禁止**在仓库根目录跑测试（见 `AGENTS.md`）；类型检查等在对应 package 内执行。
- 在 `packages/opencode` 执行完整交叉构建（含 Windows 产物）：  
  `OPENCODE_VERSION=X.Y.Z-ic bun run build`  
  构建完成后检查 `dist/opencode-windows-x64/bin/opencode.exe`（及需要时的 `baseline` / `arm64`）。
- 若用户消息含 **「打包测试」**，同时遵循同目录技能 `pack-test-win64/SKILL.md`：将 Windows x64 的 `opencode.exe` 拷贝到用户指定路径（如 WSL 下 `/mnt/i/_Projects/opencdeIC/opencode.exe`）；目标被占用时需关闭进程后再覆盖。
- 向用户说明：需在 Windows 上实际运行验证；**自动化构建成功不等于用户场景无问题**。

## 5. 测试没问题后（需用户明确反馈）— 推送 Git 并发布 Release

仅在用户确认测试 OK 后继续。

**推送**

- `git push -u origin ic-vX.Y.Z`（或约定分支名）
- 如需 PR：提示在 GitHub 上 `ic-vX.Y.Z` → 默认分支

**发布 Windows GitHub Release（friendgic/opencode-ic）**

- Tag / Release 名与版本一致，例如 `vX.Y.Z-ic`。
- 在能访问 `gh` 且已登录 `friendgic` 的环境中：
  1. 从 `packages/opencode/dist/<变体>/bin` 打 zip（无 `zip` 命令时可用 Python `zipfile` 递归打包该 `bin` 目录内容）。
  2. 与历史 release 资产命名对齐，通常包含：  
     `opencode-windows-x64.zip`、`opencode-windows-x64-baseline.zip`、`opencode-windows-arm64.zip`
  3. 创建并上传：  
     `gh release create vX.Y.Z-ic --repo friendgic/opencode-ic --title "vX.Y.Z-ic (Windows)" --notes-file <说明.md> <各 zip 路径...>`  
     若 release 已存在：`gh release upload vX.Y.Z-ic --repo friendgic/opencode-ic --clobber <zip...>`
- 说明文档中写清：**运行时版本** `X.Y.Z-ic`、相对上游 tag 的变更摘要、解压后运行 `opencode.exe`。

## 注意事项

- `packages/opencode/script/build.ts` 在 `OPENCODE_RELEASE` 模式下会调用 `gh release upload`；若启用需设置 `GH_REPO` 且确认压缩包路径与脚本一致。手动 `gh release create` + 上传 zip 更可控（尤其仅发 Windows 时）。
- 合并上游大版本时冲突多可 `git merge --abort` 后改走「新分支 + cherry-pick 单提交」路径，避免在旧分支上长期堆合并提交。
