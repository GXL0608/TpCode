# Build 会话模式 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让会话页的 `build` 模式复用构建中心的完整执行器，并把同一个 build 会话稳定绑定到同一个沙盒。

**Architecture:** 前端 `build` 提交仍然走 `/build/job`，但把当前 `session_id` 一起传给后端；后端 `BuildJobService` 在 job 绑定现有会话时复用该会话和其 overlay workspace，继续沿用现有 `coding -> compile -> package` 闭环。

**Tech Stack:** Bun、Solid、Hono、Drizzle、现有 Session/Workspace/BuildJobService

---

## Chunk 1: 会话复用建单

### Task 1: 为 build job 增加 session 绑定输入

**Files:**
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/build/service.ts`
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/server/routes/build.ts`
- Test: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/test/build/job-service.test.ts`

- [ ] **Step 1: 先写失败测试**
- [ ] **Step 2: 运行失败测试，确认当前 job 不会绑定现有会话**
- [ ] **Step 3: 给 `BuildJobService.create` 和 `/build/job` 增加 `session_id`**
- [ ] **Step 4: 运行测试，确认建单已绑定现有会话**

## Chunk 2: 会话复用执行器

### Task 2: 执行 build job 时复用当前会话和 workspace

**Files:**
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/build/service.ts`
- Test: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/test/build/job-service.test.ts`

- [ ] **Step 1: 先写失败测试**
- [ ] **Step 2: 运行失败测试，确认当前会创建新会话**
- [ ] **Step 3: 实现“有 `session_id` 时复用会话与 overlay workspace”**
- [ ] **Step 4: 运行测试，确认不会新建会话，且编译打包仍通过**

## Chunk 3: 前端 build 提交改走当前会话

### Task 3: prompt 提交携带当前 session_id

**Files:**
- Modify: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.ts`
- Test: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.test.ts`

- [ ] **Step 1: 先写失败测试**
- [ ] **Step 2: 运行失败测试，确认 build 提交没有带 `session_id`**
- [ ] **Step 3: 修改前端 build 请求体并调整成功后的导航行为**
- [ ] **Step 4: 运行测试，确认 build 会话留在当前会话上**

## Chunk 4: 回归验证

### Task 4: 跑通核心回归

**Files:**
- Test: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/test/build/job-service.test.ts`
- Test: `/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.test.ts`

- [ ] **Step 1: 跑后端 build job 相关测试**
- [ ] **Step 2: 跑前端 prompt submit 相关测试**
- [ ] **Step 3: 跑 typecheck**
- [ ] **Step 4: 跑 `git diff --check`**
