# Build 会话模式设计

**日期：** 2026-03-18

## 背景

当前仓库里存在两套相邻但没有完全打通的能力：

1. 普通 `build` 会话
   - 通过 [`Session.prepareBuild`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/session/index.ts) 给会话准备沙盒。
   - 后续仍然走普通 [`SessionPrompt.prompt`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/session/prompt.ts)。
   - 这条链路保证了“写主工作区保护”，但没有复用构建中心的“改码 -> 编译 -> 打包”闭环。

2. 构建中心 `build job`
   - 通过 [`BuildJobService.run`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/build/service.ts) 串行执行 `plan / coding / compile / package`。
   - `coding` 阶段使用 overlay 工作区。
   - `compile` 阶段再为每个解决方案创建独立 compile sandbox。
   - 这条链路是完整闭环，但默认会自己创建新会话，和“持续在同一个会话里迭代”的体验不一致。

## 现状问题

1. `build` 会话和构建中心执行器重复建设。
2. 同一个用户在会话页用 `build` 模式连续提需求时，容易不断新开构建会话，缺少“一个会话就是一个构建沙盒”的稳定心智模型。
3. 多人协作时，隔离边界不够清晰。

## 目标

1. 把 `build` 会话模式跑通为完整闭环：改码、编译、打包都走统一执行器。
2. 保留会话产品体验：同一个 `build` 会话持续迭代同一个沙盒。
3. 保证隔离：一个 `build` 会话绑定一个沙盒，默认不直接改主工作区。
4. 尽量复用现有构建中心实现，避免复制第二套“改码/编译/打包”逻辑。

## 核心结论

### 1. 一个 build 会话就是一个编码沙盒

- 会话级别只绑定一个“编码沙盒工作区”。
- 这个工作区优先使用构建中心同款 overlay workspace，而不是普通 `single_worktree`。
- 这样可以统一：
  - 工具写入保护
  - 变更扫描
  - compile sandbox 的输入
  - 构建详情展示

### 2. 编译仍然按解决方案拆独立 compile sandbox

- 编码阶段复用会话绑定的 overlay workspace。
- 编译阶段继续沿用 [`BuildCompileSandbox.create`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/build/compile-sandbox.ts)。
- 这样多人不会互相影响，因为：
  - 会话 A 的 overlay workspace 不会写到会话 B
  - compile sandbox 也按 job/solution 临时创建

### 3. 复用构建中心执行器，而不是在 SessionPrompt 里再造一套

- 会话页的 `build` 模式提交，不再直接用 `SessionPrompt.prompt` 做“只改码”。
- 改为创建并同步执行一个 `build job`。
- 但这个 `build job` 可以显式挂到“当前会话”上，而不是总是新建会话。

## 目标数据流

### 会话 build 提交

1. 前端识别当前是 `build` 模式。
2. 如果当前已经有会话 ID，就把该 `session_id` 一起提交到 `/build/job`。
3. 后端创建 `build job` 时记录 `session_id`。
4. `BuildJobService.run` 检测到当前 job 已绑定会话：
   - 复用该会话
   - 复用或准备该会话的 overlay workspace
   - 在该会话里执行 coding
   - 之后继续 compile 和 package
5. 前端仍然停留在当前会话，只刷新消息和构建结果。

### 新会话首次 build 提交

1. 前端先像现在一样拿到会话 ID。
2. 再把这个会话 ID 传给 `/build/job`。
3. 后端首次为这个会话准备 overlay workspace。
4. 以后同一会话再次 build，继续复用这套 workspace。

## 后端改造点

### BuildJob 创建

[`BuildJobService.create`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/build/service.ts) 增加可选字段：

- `session_id?: string`

规则：

- 有 `session_id` 时，把 job 显式绑定到现有会话。
- `prompt` 来源的 build job 不再默认强制新开会话。

### Build 路由

[`BuildRoutes`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/server/routes/build.ts) 的建单接口增加：

- `session_id?: string`

校验：

- 会话必须存在
- 当前用户对该会话有可写权限

### BuildJob 执行

[`BuildJobService.run`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/opencode/src/build/service.ts) 新增一层“会话上下文解析”：

- 若 job 已绑定 `session_id`
  - 优先复用这个 session
  - 优先复用其 `workspace_id`
  - 若当前 workspace 不是 overlay workspace，则升级为 overlay workspace 并回写 session/workspace 元数据
- 若 job 未绑定 `session_id`
  - 保持原有构建中心逻辑

### 会话/工作区兼容策略

- 旧的 `Session.prepareBuild` 保持不删，继续作为普通 build 工具链和非账号模式兜底。
- 新的“会话式 build 闭环”不直接依赖 `prepareBuild` 的 `single_worktree` 结果，而是优先落到 overlay workspace。

## 前端改造点

### prompt 提交

[`submit.ts`](/Users/tphymini/.codex/worktrees/7dfe/TpCode/packages/app/src/components/prompt-input/submit.ts) 中：

- 当前是 `build` 模式时，继续走 `/build/job`
- 但请求体要补上当前 `session_id`
- 成功后不再把用户强制导航到新的 build 会话
- 如果服务端返回的仍是当前会话，则只刷新当前会话消息/状态

## 隔离语义

### 不会互相影响的部分

- 每个 build 会话的 overlay workspace 独立
- 每个编译阶段的 compile sandbox 独立
- 默认不会直接写产品主工作区

### 仍可能互相影响的部分

- 多个会话最终都要推送到同一个远程分支
- 多个会话使用同一正式数据库或同一发布目录
- 外部共享缓存/依赖源

这部分不属于“沙盒隔离”本身，需要后续再做发布策略和外部资源隔离。

## 测试策略

### 后端

- `BuildJobService.create` 绑定现有会话
- `BuildJobService.run` 复用已有会话而不是创建新会话
- 同一会话连续两次 build 复用同一个 workspace
- coding/compile/package 仍可完整跑通

### 前端

- `build` 模式提交时，请求 `/build/job` 会携带当前 `session_id`
- 已有会话 build 不再走 `promptAsync`
- 已有会话 build 成功后不强制跳新会话

## 非目标

- 这次不处理“多会话并发抢占同一远端分支”的锁
- 这次不处理“build 会话内再次细分多轮 job 历史 UI”
- 这次不重写构建中心详情页
