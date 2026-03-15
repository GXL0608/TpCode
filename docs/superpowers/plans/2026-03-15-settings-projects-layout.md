# 产品解决方案页布局优化 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把产品解决方案页改成左右结构，并补齐产品与解决方案的选中切换交互。

**Architecture:** 保持现有后端接口不变，只在前端 `settings-projects` 页面内重构布局与状态同步。新增少量纯函数帮助管理产品/解决方案选中态，并通过单元测试先锁定行为，再改页面渲染。

**Tech Stack:** SolidJS、Bun Test、Tailwind CSS

---

## Chunk 1: 选中态帮助函数

### Task 1: 为产品和解决方案选中逻辑补测试与帮助函数

**Files:**
- Create: `packages/app/src/components/settings-projects-view.test.ts`
- Create: `packages/app/src/components/settings-projects-view.ts`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：
- 产品选中项不存在时回退到首个产品
- 解决方案选中项不存在时回退到首个方案
- 选中态样式类名包含高亮标记

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test --preload ./happydom.ts ./src/components/settings-projects-view.test.ts`

- [ ] **Step 3: 写最小实现**

补充选中态帮助函数和样式类名生成函数。

- [ ] **Step 4: 再次运行测试确认通过**

Run: `bun test --preload ./happydom.ts ./src/components/settings-projects-view.test.ts`

## Chunk 2: 页面布局重构

### Task 2: 把项目管理页面改成左右结构

**Files:**
- Modify: `packages/app/src/components/settings-projects.tsx`
- Modify: `packages/app/src/components/settings-projects-view.ts`

- [ ] **Step 1: 调整状态**

新增 `selectedSolutionID`，并补齐产品切换后的方案选中同步。

- [ ] **Step 2: 改布局**

把页面改成左侧产品导航、右侧详情区的主从布局。

- [ ] **Step 3: 改解决方案交互**

把解决方案新增/编辑改为右侧内嵌面板，并保留删除确认。

- [ ] **Step 4: 验证空状态和选中态**

确认无产品、无解决方案、切换产品等场景都能正常展示。

## Chunk 3: 验证

### Task 3: 跑测试和类型检查

**Files:**
- Test: `packages/app/src/components/settings-projects-view.test.ts`

- [ ] **Step 1: 运行页面相关测试**

Run: `bun test --preload ./happydom.ts ./src/components/settings-projects-view.test.ts`

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
