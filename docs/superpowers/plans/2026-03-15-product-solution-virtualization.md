# 产品虚拟组合与解决方案复用 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让产品从源码目录拥有者升级为虚拟组合，让解决方案成为可复用代码单元，并打通“产品默认携带全部启用解决方案”的 build 闭环。

**Architecture:** 保留 `tp_product` 作为产品入口，但把其 `project_id` 语义改为默认上下文项目；新增产品与解决方案的绑定关系，把解决方案从产品私有配置提升为可复用资源；build 执行从“单 solution job”升级为“产品级运行 + solution 级编译打包”。

**Tech Stack:** Bun、TypeScript、Drizzle ORM、Hono、SolidJS、PostgreSQL

---

## 预备条件

- [x] 正式设计稿已保存到 [2026-03-15-product-solution-virtualization-design.md](/Users/tphymini/.codex/worktrees/5346/TpCode/docs/superpowers/specs/2026-03-15-product-solution-virtualization-design.md)
- [x] git 备份分支：`codex/backup-product-solution-20260315-221101`
- [x] git 备份 tag：`backup/pre-product-solution-20260315-221101`
- [x] 正式库完整备份：`/tmp/tpcode-prod-backups/20260315-221101/opencode-20260315-221101.dump`
- [x] 正式库 schema 备份：`/tmp/tpcode-prod-backups/20260315-221101/opencode-20260315-221101-schema.sql`

## Chunk 1: 解决方案绑定模型

### Task 1: 新增产品与解决方案绑定表

**Files:**
- Create: `packages/opencode/src/user/product-solution-binding.sql.ts`
- Modify: `packages/opencode/src/storage/schema.ts`
- Modify: `packages/opencode/src/storage/db.ts`
- Create: `packages/opencode/migration/<timestamp>_product_solution_binding/migration.sql`

- [ ] **Step 1: 写失败测试，覆盖产品绑定多个解决方案**

Create or update:
- `packages/opencode/test/user/product-solution-service.test.ts`

Case:
- 一个产品可绑定两个解决方案
- 两个产品可绑定同一个解决方案
- 绑定顺序按 `sort_order` 返回

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd /Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode
bun test test/user/product-solution-service.test.ts
```

Expected:
- FAIL，提示缺少绑定表或绑定查询行为不正确

- [ ] **Step 3: 新增绑定表 schema 与 migration**

Implement:
- `tp_product_solution_binding`
- 中文表注释与字段注释写入 migration
- 主索引、唯一约束、排序索引补齐

- [ ] **Step 4: 重新跑测试确认基础结构通过**

Run:
```bash
cd /Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode
bun test test/user/product-solution-service.test.ts
```

- [ ] **Step 5: 提交当前 chunk**

```bash
git add packages/opencode/src/user/product-solution-binding.sql.ts packages/opencode/src/storage/schema.ts packages/opencode/src/storage/db.ts packages/opencode/migration
git commit -m "feat: add product solution binding model"
```

### Task 2: 给解决方案根目录新增 `mount_name`

**Files:**
- Modify: `packages/opencode/src/user/product-solution-root.sql.ts`
- Modify: `packages/opencode/src/user/product-solution.ts`
- Modify: `packages/opencode/test/user/product-solution-service.test.ts`
- Modify: `packages/opencode/migration/<timestamp>_product_solution_binding/migration.sql`

- [ ] **Step 1: 为 root 输入校验补充 `mount_name` 失败测试**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 增加字段、解析、默认值与路径唯一性校验**
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交当前 chunk**

## Chunk 2: 产品与解决方案服务改造

### Task 3: 把解决方案从“产品私有”改成“可复用库”

**Files:**
- Modify: `packages/opencode/src/user/product-solution.sql.ts`
- Modify: `packages/opencode/src/user/product-solution.ts`
- Modify: `packages/opencode/src/server/routes/account.ts`
- Modify: `packages/opencode/test/user/product-solution-service.test.ts`

- [ ] **Step 1: 写失败测试，覆盖“同一 solution 被多个产品绑定”**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 改造 service 层，新增 `bind/unbind/listBindings/listLibrary`**
- [ ] **Step 4: 调整管理接口，把“产品页查询 solution”改成“查询产品绑定关系”**
- [ ] **Step 5: 跑测试**
- [ ] **Step 6: 提交当前 chunk**

### Task 4: 保持产品上下文兼容

**Files:**
- Modify: `packages/opencode/src/user/product.sql.ts`
- Modify: `packages/opencode/src/user/product.ts`
- Modify: `packages/opencode/src/user/context.ts`
- Modify: `packages/opencode/src/server/routes/build.ts`
- Test: `packages/opencode/test/server/account-saved-plans.test.ts`

- [ ] **Step 1: 写失败测试，验证产品仍能参与上下文与权限链路**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 把 `project_id` 的语义调整为默认上下文项目**
- [ ] **Step 4: 保证产品列表、权限过滤、构建中心按产品过滤仍可工作**
- [ ] **Step 5: 跑测试**
- [ ] **Step 6: 提交当前 chunk**

## Chunk 3: Build 主链升级为产品级运行

### Task 5: 引入产品级运行模型

**Files:**
- Create: `packages/opencode/src/build/run.sql.ts`
- Create: `packages/opencode/src/build/run-solution.sql.ts`
- Modify: `packages/opencode/src/build/service.ts`
- Modify: `packages/opencode/src/build/job.sql.ts`
- Modify: `packages/opencode/src/build/job-stage.sql.ts`
- Modify: `packages/opencode/src/build/artifact.sql.ts`
- Create: `packages/opencode/migration/<timestamp>_build_run_refactor/migration.sql`
- Test: `packages/opencode/test/build/job-service.test.ts`

- [ ] **Step 1: 写失败测试，覆盖“一个产品一次 build 同时带上多个 solution”**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 在 build service 中引入产品级运行实体**
- [ ] **Step 4: 让 `plan/coding` 变成产品级，`compile/package` 变成 solution 级**
- [ ] **Step 5: 跑测试**
- [ ] **Step 6: 提交当前 chunk**

### Task 6: 聚合多解决方案 roots 生成统一沙盒

**Files:**
- Modify: `packages/opencode/src/build/service.ts`
- Modify: `packages/opencode/src/control-plane/workspace.ts`
- Modify: `packages/opencode/src/control-plane/workspace-meta.ts`
- Modify: `packages/opencode/src/session/build-protection.ts`
- Test: `packages/opencode/test/build/job-service.test.ts`
- Test: `packages/opencode/test/project/project.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 `A目录 + API目录` 聚合进一个 workspace**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 通过 `mount_name` 稳定挂载目录，避免同名冲突**
- [ ] **Step 4: 对重复真实路径去重，避免共享 API 被重复挂载**
- [ ] **Step 5: 跑测试**
- [ ] **Step 6: 提交当前 chunk**

### Task 7: 按解决方案分别编译与打包

**Files:**
- Modify: `packages/opencode/src/build/service.ts`
- Modify: `packages/opencode/src/util/archive.ts`
- Test: `packages/opencode/test/build/job-service.test.ts`

- [ ] **Step 1: 写失败测试，验证同一产品运行产出多个 solution 包**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 让编译与打包循环按 solution 执行**
- [ ] **Step 4: 校验产物记录与下载接口**
- [ ] **Step 5: 跑测试**
- [ ] **Step 6: 提交当前 chunk**

## Chunk 4: 管理后台与用户侧界面

### Task 8: 把产品页改造成“产品组合管理”

**Files:**
- Modify: `packages/app/src/components/settings-projects.tsx`
- Modify: `packages/app/src/components/settings-projects-view.ts`
- Modify: `packages/app/src/components/dialog-settings.tsx`
- Test: `packages/app/src/components/settings-projects-view.test.ts`

- [ ] **Step 1: 写失败测试，覆盖“产品页只展示绑定的 solution，而不是直接编辑私有 solution”**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 页面改为产品绑定关系管理**
- [ ] **Step 4: 跑测试**
- [ ] **Step 5: 提交当前 chunk**

### Task 9: 新增解决方案库管理页

**Files:**
- Create: `packages/app/src/components/settings-solution-library.tsx`
- Create: `packages/app/src/components/settings-solution-library-view.ts`
- Create: `packages/app/src/components/settings-solution-library-view.test.ts`
- Modify: `packages/app/src/components/dialog-settings.tsx`
- Modify: `packages/opencode/src/server/routes/account.ts`

- [ ] **Step 1: 写失败测试，覆盖全局 solution 库列表与编辑**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 新增解决方案库页面与接口**
- [ ] **Step 4: 跑测试**
- [ ] **Step 5: 提交当前 chunk**

### Task 10: 调整构建中心与用户侧 build 摘要

**Files:**
- Modify: `packages/app/src/components/settings-build-center.tsx`
- Modify: `packages/app/src/components/settings-build-center-view.ts`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Test: `packages/app/src/components/settings-build-center-view.test.ts`
- Modify: `packages/opencode/src/server/routes/build.ts`

- [ ] **Step 1: 写失败测试，覆盖产品级运行显示多个 solution 摘要**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 把前端 build 提交改成产品级运行**
- [ ] **Step 4: 构建中心展示产品级运行和 solution 级状态**
- [ ] **Step 5: 跑测试**
- [ ] **Step 6: 提交当前 chunk**

## Chunk 5: 数据回填与验证

### Task 11: 回填绑定关系并保持旧数据可用

**Files:**
- Create: `packages/opencode/script/backfill-product-solution-binding.ts`
- Modify: `packages/opencode/src/user/product-solution.ts`
- Test: `packages/opencode/test/user/product-solution-service.test.ts`

- [ ] **Step 1: 写失败测试，覆盖旧数据自动生成 binding**
- [ ] **Step 2: 跑失败测试**
- [ ] **Step 3: 实现回填脚本与兼容读取**
- [ ] **Step 4: 跑测试**
- [ ] **Step 5: 提交当前 chunk**

### Task 12: 完整回归与手工烟测

**Files:**
- Modify: `docs/superpowers/specs/2026-03-15-product-solution-virtualization-design.md`
- Modify: `docs/superpowers/plans/2026-03-15-product-solution-virtualization.md`

- [ ] **Step 1: 运行后端测试**

Run:
```bash
cd /Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode
bun test test/user/product-solution-service.test.ts test/build/job-service.test.ts test/server/account-saved-plans.test.ts
bun run typecheck
```

- [ ] **Step 2: 运行前端测试**

Run:
```bash
cd /Users/tphymini/.codex/worktrees/5346/TpCode/packages/app
bun test --preload ./happydom.ts ./src/components/settings-projects-view.test.ts ./src/components/settings-build-center-view.test.ts ./src/components/settings-solution-library-view.test.ts
bun run typecheck
```

- [ ] **Step 3: 做共享 API 场景烟测**

Case:
- 产品 A 绑定 `A前端 + 共享API`
- 产品 B 绑定 `B前端 + 共享API`
- 用户选择产品 A 发起 build
- 验证聚合沙盒、统一改码、多包产出

- [ ] **Step 4: 记录验证结果与残留风险**

- [ ] **Step 5: 提交最终 chunk**

