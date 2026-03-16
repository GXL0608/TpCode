# Overlay Coding + 独立 Compile Sandbox 分阶段实施计划

## 1. 目标

把当前“完整 worktree 批量沙盒”升级成：

- `Coding` 阶段只保留变更文件
- `Compile` 阶段按解决方案创建独立编译沙盒
- 保持产品级默认全带方案、方案级独立编译和并发安全

## 2. 总体原则

1. 先兼容，后切换  
   在新链路稳定前，不直接删除旧的完整 worktree 路径。

2. 先控范围，后做覆盖层  
   先把“搜索范围、路径边界、成功判定”收紧，再做 overlay。

3. 编码和编译分治  
   Coding 和 Compile 使用不同的工作目录策略，不再共用一个完整沙盒。

4. Windows 优先  
   每个阶段都要保证 Windows 正式环境可运行。

## 3. 阶段划分

### 阶段一：范围收紧与基础元数据

#### 目标

- 不改核心沙盒模型，先把现有 build 范围和结果判定收紧。
- 为 overlay 改造准备元数据结构。

#### 任务

1. 限制源码可见范围  
   只允许当前 job 参与的解决方案挂载路径进入搜索、读写、目录浏览。

2. 统一挂载路径  
   强制所有 root 使用稳定 `mount_name`，前端和日志统一展示挂载路径。

3. 新增变更清单抽象  
   在现有完整沙盒模式下，先提取“changed files collector”。

4. 提升详情展示  
   构建中心优先展示修改文件清单，不再只展示完整沙盒路径。

#### 主要改动文件

- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/build/service.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/session/build-protection.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/control-plane/workspace.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/app/src/components/settings-build-center.tsx`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/app/src/components/settings-build-center-detail.ts`

#### 验收标准

- AI 无法越过参与解决方案路径访问无关目录。
- 构建中心可直接看到本次修改的文件列表。
- 现有完整 worktree 模式仍然可用。

---

### 阶段二：Overlay Coding MVP

#### 目标

- Coding 阶段不再依赖完整 worktree 持久化结果。
- 只保存修改文件、新增文件和删除标记。

#### 任务

1. 新增 Overlay Store  
   新建：
   - `packages/opencode/src/build/overlay.ts`
   - `packages/opencode/src/build/overlay-manifest.ts`

2. 新增 Overlay Resolver  
   负责合并视图读取和只写 overlay。

3. 改造工具层  
   优先改造：
   - `read`
   - `edit`
   - `apply_patch`
   - `grep`
   - `ls/glob`

4. Coding 成功判定切换  
   从“看 git diff”改成“看 overlay manifest”。

5. 允许保守 fallback  
   若某些工具尚未完成 overlay 化，可在配置开关下回退到旧 worktree 模式。

#### 主要改动文件

- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/build/service.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/build/overlay.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/build/overlay-manifest.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/tool/edit.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/tool/apply_patch.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/tool/grep.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/tool/read.ts`

#### 风险点

1. `bash` 仍然会天然倾向真实文件系统。
2. 某些 AI 工具组合可能依赖完整目录遍历行为。

#### 缓解策略

- Coding 阶段先限制 `bash` 的默认工作目录到 overlay 根目录。
- 对未完成 overlay 兼容的路径保留特性开关。

#### 验收标准

- 一个 job 改完后，overlay 目录只包含实际修改文件。
- 原始源码目录无变更。
- 构建中心可以展示 overlay manifest。

---

### 阶段三：独立 Compile Sandbox

#### 目标

- Compile 和 Package 不再复用 coding 沙盒。
- 每个 solution 使用独立 compile sandbox。

#### 任务

1. 新增 CompileSandboxBuilder  
   新建：
   - `packages/opencode/src/build/compile-sandbox.ts`

2. 以 solution 为单位创建 compile sandbox  
   可以先复用现有 Git worktree 创建逻辑。

3. 把 overlay manifest 应用到 compile sandbox  
   按 solution 分组应用变更。

4. 切换编译流程  
   `install -> compile -> package` 全部在 compile sandbox 内执行。

5. 编译完成后清理目录  
   保留：
   - 编译日志
   - 产物
   - manifest
   清理：
   - compile sandbox 目录

#### 主要改动文件

- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/build/service.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/build/compile-sandbox.ts`
- `/Users/tphymini/.codex/worktrees/5346/TpCode/packages/opencode/src/control-plane/workspace.ts`

#### 验收标准

- 编译阶段可以只基于 overlay 结果生成完整 solution 编译副本。
- 多 solution 会生成多个独立编译目录。
- 编译结束后 compile sandbox 被自动清理。

---

### 阶段四：Bash 与可观测性增强

#### 目标

- 让 overlay 模式下的工具体验更稳定。
- 提升任务排查效率。

#### 任务

1. 增强 `bash` 策略  
   评估引入临时 merged view 执行模式。

2. 增强日志  
   显示：
   - overlay 根目录
   - compile sandbox 根目录
   - applied files 数
   - solution 级产物清单

3. 可选持久化变更文件表  
   若前端展示和统计需求增长，再新增 `tp_build_job_change`。

#### 验收标准

- 管理端能完整查看修改文件、应用文件和方案级编译结果。
- 常见调试不再需要去服务器手工翻目录。

## 4. 任务拆解建议

### 后端优先级

1. `build/service.ts`
2. `tool/edit.ts`
3. `tool/apply_patch.ts`
4. `tool/read.ts`
5. `tool/grep.ts`
6. `build/compile-sandbox.ts`

### 前端优先级

1. 构建中心详情补修改文件展示
2. 方案级 applied files 展示
3. compile sandbox 阶段状态展示

## 5. 数据与兼容策略

### 第一阶段

- 尽量不加表，优先利用 `tp_build_job_stage.detail_json`

### 第二阶段

- 如需更强查询能力，再补 `tp_build_job_change`

### 兼容策略

- 增加 `build.overlay_coding_enabled` 特性开关
- 新老链路可并行存在
- 正式环境先灰度到单产品、单 solution 场景

## 6. 测试计划

### 单元测试

- OverlayResolver 读写覆盖
- manifest 生成与删除
- solution 路径越界拦截
- compile sandbox 变更应用

### 集成测试

- 单 solution 改码与编译
- 多 solution 改码与分方案编译
- 两个 job 并发修改同一 solution 同一文件
- Windows 路径和 PowerShell 编译命令

### 回归测试

- 现有完整 worktree 模式在开关关闭时仍可运行
- 构建中心原有任务详情不回退

## 7. 实施顺序建议

1. 阶段一上线  
   先收紧范围和展示，几乎无破坏性。

2. 阶段二灰度  
   先在少量产品上启用 overlay coding。

3. 阶段三切 compile  
   确认 overlay manifest 稳定后，再切到 compile sandbox。

4. 阶段四优化  
   再逐步增强 bash 和可观测性。

## 8. 里程碑定义

### M1

- 修改文件清单可准确展示
- 搜索和写入范围已受控

### M2

- Coding 阶段只保留 overlay 变更文件

### M3

- Compile 阶段完全切到独立 compile sandbox

### M4

- 构建中心可完整查看 overlay 与 compile 细节

## 9. 风险与回退

### 风险

1. 工具层对 overlay 适配不完整，导致 AI 行为异常。
2. `bash` 在 overlay 模式下出现不可预期文件路径问题。
3. compile sandbox 应用 patch 后与真实 Git 状态不一致。

### 回退策略

- 保留旧 worktree build 逻辑
- 通过特性开关切回旧链路
- compile sandbox 失败时允许 fallback 到旧 compile 模式做临时兜底

## 10. 落地结论

推荐按四阶段实施：

1. 先控范围与补展示
2. 再上 overlay coding
3. 再切独立 compile sandbox
4. 最后增强 bash 和观测能力

这样既能解决磁盘压力，也能保住当前 build 闭环的稳定性。
