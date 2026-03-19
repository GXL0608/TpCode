# Build 运行时可执行与可见性 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让会话页 Build 模式在 Windows 环境下稳定执行改码，并且把改码、编译、打包全过程实时展示给前端用户。

**Architecture:** 后端先修复只读 bash overlay 沙盒在 Windows 上因 `symlink/junction` 权限失败导致的改码前置探测崩溃，保证模型能够继续读代码并完成真实改码。前端继续复用现有 build job 轮询和 handoff 机制，但把阶段实时明细、最近活动、最后心跳和错误原因完整抬升到会话页，并把状态卡片布局固定为“头部摘要 + 内容区内部滚动”。

**Tech Stack:** Bun、SolidJS、TypeScript、Hono、现有 BuildJobService / SessionBuildStatus / BashTool

---

## Chunk 1: Windows 只读 bash 沙盒降级

### Task 1: 为 Windows 只读 bash sandbox 建立失败测试

**Files:**
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/test/tool/bash.test.ts`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/tool/bash.ts`

- [ ] **Step 1: 写失败测试**

新增一个测试，模拟 `fs.symlink` 在只读 overlay 场景抛出 `EPERM`。
期望行为：
- bash 工具不抛异常
- 自动回退到 merged sandbox
- 命令仍然成功执行

- [ ] **Step 2: 运行单测，确认当前失败**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode && bun test ./test/tool/bash.test.ts -t "readonly bash sandbox falls back when symlink is denied on windows"`

Expected: FAIL，说明当前遇到 `EPERM` 时不会自动降级。

- [ ] **Step 3: 实现最小修复**

在 `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/tool/bash.ts`：
- 为 `readonlySandbox` 增加容错
- 当 `fs.symlink(..., "junction")` 失败时返回 `undefined`
- 让 `overlaySandbox` 自动退回现有 merged sandbox 分支
- 保留原有只读快速路径，避免非 Windows 或有权限环境性能回退

- [ ] **Step 4: 重新运行单测，确认通过**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode && bun test ./test/tool/bash.test.ts -t "readonly bash sandbox falls back when symlink is denied on windows"`

Expected: PASS

## Chunk 2: 会话页 Build 过程可见

### Task 2: 为会话页 Build 状态面板建立失败测试

**Files:**
- Create: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/session/session-build-status-detail.test.ts`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/session/session-build-status.tsx`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/settings-build-center-detail.ts`

- [ ] **Step 1: 写失败测试**

覆盖以下展示契约：
- 状态面板应显示“当前状态 / 当前步骤 / 最近活动 / 最后更新时间”
- 错误区域支持长文本折行
- 明细区域必须可滚动，不能继续撑爆整个会话页

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app && bun test ./src/components/session/session-build-status-detail.test.ts`

Expected: FAIL，说明当前状态面板没有这些字段或没有稳定布局契约。

- [ ] **Step 3: 实现最小修复**

在 `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/session/session-build-status.tsx`：
- 提炼 `buildStageGroups(stage)` 的展示数据
- 把 coding / compile / package 的 `current_status`、`current_step`、`recent_activity`、`logs`、`compile_sandbox_directory` 等内容直接渲染出来
- 增加“最后更新于”文案，使用 handoff 时间戳
- 错误信息用 `break-all` + `whitespace-pre-wrap`
- 卡片主体保持最大高度，细节区内部滚动

必要时在 `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/settings-build-center-detail.ts` 增补一个小型格式化 helper，复用已有 stage 明细逻辑，避免复制转换规则。

- [ ] **Step 4: 重新运行测试，确认通过**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app && bun test ./src/components/session/session-build-status.test.ts ./src/components/session/session-build-status-detail.test.ts`

Expected: PASS

## Chunk 3: 轮询期间的实时反馈补强

### Task 3: 提升构建轮询的前端可感知度

**Files:**
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.ts`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/context/layout.tsx`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：
- build job 每轮轮询都会刷新 handoff `at`
- running 状态下会持续回写最新阶段信息
- failed 状态下保留最近一次阶段详情和错误，不会被空数据覆盖

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app && bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts -t "updates build handoff timestamp while polling"`

Expected: FAIL

- [ ] **Step 3: 实现最小修复**

在 `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.ts`：
- 每次 `syncBuildJobHandoff` 都带上最新 `at`
- polling 期间如果当前阶段和状态变化，立刻写回 handoff
- 构建失败时保留最近成功拉到的阶段明细，不要只剩 toast

- [ ] **Step 4: 重新运行测试，确认通过**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app && bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts`

Expected: PASS

## Chunk 4: 整体验证

### Task 4: 回归验证

**Files:**
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/tool/bash.ts`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/test/tool/bash.test.ts`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/session/session-build-status.tsx`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.ts`

- [ ] **Step 1: 跑后端相关测试**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode && bun test ./test/tool/bash.test.ts`

- [ ] **Step 2: 跑前端相关测试**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app && bun test --preload ./happydom.ts ./src/components/session/session-build-status.test.ts ./src/components/session/session-build-status-detail.test.ts ./src/components/prompt-input/submit.test.ts`

- [ ] **Step 3: 跑前端类型检查**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app && bun run typecheck`

- [ ] **Step 4: 跑 diff 检查**

Run: `cd /Users/tphymini/.codex/worktrees/7dfe/TpCode && git diff --check`

- [ ] **Step 5: 总结结果**

输出：
- Windows `symlink/junction` 权限失败已如何降级
- 会话页现在能看到哪些实时状态
- 仍未覆盖的边界问题（如果有）
