# TpCode 项目解析（根目录）

## 1. 项目概览

- 仓库类型：Bun + Turborepo Monorepo
- 根包名：`opencode`
- 主要技术栈：TypeScript、Bun、Drizzle ORM、Vite、Solid/SolidStart、SST、Cloudflare、PlanetScale
- 默认分支（按仓库规范）：`dev`

## 2. 根目录结构（摘要）

- `packages/`: 核心业务包（CLI/Server、Web App、Console、Desktop、SDK、UI、Util 等）
- `infra/`: SST 基础设施定义（Cloudflare + PlanetScale + Stripe）
- `script/`: 工程脚本（构建、发布、迁移、Windows 脚本等）
- `sdks/`: SDK 与编辑器扩展相关目录
- `docs/`: 文档与方案说明
- `package.json`: Monorepo 根脚本入口
- `turbo.json`: Turborepo 任务编排配置
- `sst.config.ts`: SST 应用入口

## 3. 关键包职责（摘要）

- `packages/opencode`: CLI 与核心服务端逻辑（根 `dev` 默认启动目标）
- `packages/app`: 前端应用（`dev:web` 对应）
- `packages/console/app`: Console Web 端（SST/Cloudflare 生态）
- `packages/console/core`: Console 业务核心与数据库访问层
- `packages/desktop`: 桌面端（Tauri）
- `packages/sdk/js`: JS SDK
- `packages/ui`, `packages/util`, `packages/plugin`: 公共组件与工具库

## 4. 启动与开发脚本（根目录）

`package.json` 中关键脚本：

- `dev`: `bun run --cwd packages/opencode --conditions=browser src/index.ts`
- `dev:web`: `bun --cwd packages/app dev`
- `dev:desktop`: `bun --cwd packages/desktop tauri dev`
- `typecheck`: `bun turbo typecheck`

结论：根目录默认 `dev` 是启动 `packages/opencode`（CLI/服务端能力）。

## 5. 数据库连接清单

### 5.1 PostgreSQL（opencode 主运行链路）

- 使用位置：
  - `packages/opencode/src/storage/pg-url.ts`
  - `packages/opencode/src/storage/db.ts`
  - `packages/opencode/drizzle.config.ts`
- 连接优先级：
  1. `OPENCODE_DATABASE_URL`
  2. `OPENCODE_PG_URL`
  3. 默认内置地址（`pgDefault`）
- 默认地址（代码内）：
  - `postgres://opencode:opencode@182.92.74.187:9124/opencode_dev`（local）
  - `postgres://opencode:opencode@182.92.74.187:9124/opencode`（non-local）
- 说明：`drizzle.config.ts` 的 `dialect` 为 `postgresql`，迁移目录在 `packages/opencode/migration`。

### 5.2 MySQL / PlanetScale（console 链路）

- 使用位置：
  - `packages/console/core/src/drizzle/index.ts`
  - `packages/console/core/drizzle.config.ts`
  - `infra/console.ts`
- 连接方式：
  - 通过 `@planetscale/database` `Client` + `drizzle-orm/planetscale-serverless`
  - 凭据由 SST `Resource.Database` 注入（host / username / password / database / port）
- 说明：`drizzle.config.ts` 的 `dialect` 为 `mysql`。

### 5.3 Oracle（任务反馈回写，条件启用）

- 使用位置：
  - `packages/opencode/src/plan/task-feedback.ts`
  - `packages/opencode/vendor/oracle/TaskFeedbackUpdate.java`
- 关键环境变量：
  - `OPENCODE_TASK_FEEDBACK_ORACLE_USER`
  - `OPENCODE_TASK_FEEDBACK_ORACLE_PASSWORD`
  - `OPENCODE_ORACLE_CLIENT_LIB_DIR` 或 `ORACLE_CLIENT_LIB_DIR`
- 说明：用于特定“任务反馈回写”流程，不是默认主库。

### 5.4 SQLite（历史/迁移痕迹）

- 根目录存在本地文件：`opencode.db`
- 桌面端存在 SQLite 迁移与等待逻辑（`packages/desktop/src-tauri/src/lib.rs`）
- 说明：当前主运行链路配置已迁移到 PostgreSQL/MySQL；SQLite 主要体现为历史资产与桌面迁移兼容逻辑。

## 6. 基础设施与部署关系（摘要）

- `sst.config.ts` 同时加载：
  - `infra/app.ts`
  - `infra/console.ts`
  - `infra/enterprise.ts`
- `infra/console.ts` 明确声明 PlanetScale 分支与密码资源，以及 Console/Auth/Stripe 等服务。

## 7. 当前机器执行结果（本次）

- 初始状态：系统未安装 `bun`，无法直接运行项目
- 已执行：通过 `winget` 安装 Bun `1.3.10`
- 已执行：在仓库根目录完成依赖安装（`bun install --frozen-lockfile`）
- 已执行：`packages/app` 构建成功（`bun --bun --cwd packages/app build`）
- 已执行：`opencode serve` 可拉起并监听 `127.0.0.1:4096`（已通过 `netstat` 验证）
- 观察到：直接执行根脚本 `dev:web` 时会触发系统 Node `18.17.1` 检查报错（Vite 7 需要 Node 20.19+ 或 22.12+），建议用 Bun runtime 方式运行前端脚本

## 8. 建议启动顺序（本地）

1. 根服务：`bun run --cwd packages/opencode --conditions=browser src/index.ts serve --hostname 127.0.0.1 --port 4096`
2. 前端（可选，Bun runtime）：`bun --bun --cwd packages/app dev`
3. 桌面端（可选）：`bun run dev:desktop`

如需“全栈联调”，建议至少并行启动 `serve` 与 `packages/app dev`。
