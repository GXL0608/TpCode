# tpCode 改造方案

> 基于 OpenCode 开源项目的企业级 Web Coding 平台改造方案
> 版本：v2.0 | 日期：2026-02-28

---

## 目录

1. [项目总览](#1-项目总览)
2. [改造目标与愿景](#2-改造目标与愿景)
3. [总体架构设计](#3-总体架构设计)
4. [阶段规划](#4-阶段规划)
5. [多智能体协作方案](#5-多智能体协作方案)
6. [第一阶段：基础设施改造](#6-第一阶段基础设施改造)
7. [第二阶段：业务功能开发](#7-第二阶段业务功能开发)
8. [第三阶段：审核与原型系统](#8-第三阶段审核与原型系统)
9. [数据库设计](#9-数据库设计)
10. [API 接口设计](#10-api-接口设计)
11. [前端页面设计](#11-前端页面设计)
12. [现有功能修改清单](#12-现有功能修改清单)
13. [远期规划（第二期）](#13-远期规划第二期)
14. [风险与约束](#14-风险与约束)
15. [附录：文件修改索引](#15-附录文件修改索引)

---

## 1. 项目总览

### 1.1 原始项目

OpenCode 是一个开源的 AI 编程助手，采用客户端/服务端架构，支持 CLI（TUI）、Web 界面和桌面应用三种使用方式。

**技术栈：**

- 运行时：Bun 1.3+
- 语言：TypeScript (ESM)
- 前端框架：SolidJS
- 桌面端：Tauri (Rust)
- 数据库：SQLite + Drizzle ORM
- API 框架：Hono
- AI SDK：Vercel AI SDK
- 包管理：Bun workspaces + Turborepo

**核心包结构：**

```
packages/
├── opencode/     # 核心业务逻辑、AI Agent、CLI、API 服务端
├── app/          # Web UI 组件 (SolidJS)
├── desktop/      # Tauri 桌面应用
├── plugin/       # 插件系统
├── sdk/js/       # JavaScript SDK
├── ui/           # 共享 UI 组件库
└── util/         # 通用工具函数
```

### 1.2 改造后项目

项目名称：**tpCode**
定位：企业级端到端 Web Coding 平台，支持多用户、多项目、审核流程、页面仿真预览。

### 1.3 现状分析

| 维度     | 现状                                 | 目标                            |
| -------- | ------------------------------------ | ------------------------------- |
| 用户体系 | 无用户概念，仅 os.userInfo 做展示    | 完整账号体系，用户名/手机号登录 |
| 认证机制 | 可选 HTTP Basic Auth（单一密码）     | JWT 多用户认证                  |
| 权限控制 | 仅 AI 工具使用权限，无用户级权限     | 用户角色 + 资源级权限控制       |
| API Key  | 全局单一 auth.json，所有用户共享     | 每用户独立配置，互不干扰        |
| 项目管理 | 自动检测 git 仓库，无业务层级        | 解决方案 → 模块 → 页面 三级结构 |
| 文件浏览 | 右侧面板无限制浏览所有文件           | 权限控制，按角色决定可见性      |
| 审核流程 | 无                                   | 修改方案生成 → 审核人审批 → 执行 |
| 页面预览 | 无                                   | 仿真页面 + 原型预览挂载到菜单   |
| 品牌     | OpenCode                             | tpCode                          |

---

## 2. 改造目标与愿景

### 2.1 核心愿景

构建端到端的 Web Coding 平台：

**提出需求 → 生成计划 → 生成原型 → 审核通过 → 生成代码 → 测试验收 → 部署上线**

全流程可控、可追溯。

### 2.2 第一期目标（本方案范围）

1. 完整的用户账号体系（用户名/手机号/密码登录）
2. 基于角色的权限控制（管理员、开发者、审核人、普通用户）
3. 解决方案 → 模块 → 页面 三级项目管理结构
4. 页面仿真预览（选择菜单页面后直接展示当前页面状态）
5. AI 驱动的修改方案生成 + 原型预览
6. 审核流程（选择审核人 → 审批 → 执行）
7. 用户级 API Key 独立配置
8. 文件浏览器权限控制
9. 品牌重命名 OpenCode → tpCode
10. 生成的原型挂载到页面菜单（带时间戳标记）

### 2.3 第二期目标（远期规划）

1. 端到端自动化流水线（需求 → 计划 → 原型 → 代码 → 测试 → 部署）
2. 系统运行日志采集与分析
3. 用户操作习惯采集
4. AI 自动生成优化方案
5. 自动执行升级计划（人工确认后执行）

---

## 3. 总体架构设计

### 3.1 系统分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端展示层 (SolidJS)                    │
│  登录页 │ 解决方案选择 │ 模块/页面导航 │ 仿真预览 │ AI对话   │
│  审核面板 │ 用户设置 │ 原型预览 │ 管理后台                   │
├─────────────────────────────────────────────────────────────┤
│                      API 网关层 (Hono)                       │
│  JWT认证中间件 │ 权限校验中间件 │ 路由分发                   │
├─────────────────────────────────────────────────────────────┤
│                      业务逻辑层                              │
│  用户服务 │ 解决方案服务 │ 审核服务 │ 原型服务               │
│  AI Agent服务(现有) │ Session服务(改造) │ 权限服务           │
├─────────────────────────────────────────────────────────────┤
│                      数据访问层 (Drizzle ORM)                │
│  用户表 │ 角色表 │ 解决方案表 │ 模块表 │ 页面表             │
│  变更请求表 │ 审核表 │ 用户API Key表                        │
├─────────────────────────────────────────────────────────────┤
│                      存储层 (SQLite)                         │
│  tpcode.db (主库，替代原 opencode.db)                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 改造原则

1. **最小侵入**：尽量不修改现有 AI 对话核心逻辑，在外围包装新功能
2. **分层解耦**：新增功能以独立模块形式存在，通过中间件和服务层集成
3. **向后兼容**：保留 CLI/TUI 模式的正常使用，Web 模式增加新功能
4. **渐进式改造**：分三个阶段推进，每个阶段可独立交付验证

### 3.3 新增模块规划

```
packages/opencode/src/
├── user/                  # [新增] 用户账号体系
│   ├── user.ts            # 用户 CRUD、登录、注册
│   ├── user.sql.ts        # 用户表 schema
│   ├── role.ts            # 角色管理
│   ├── role.sql.ts        # 角色表 schema
│   └── jwt.ts             # JWT 签发与验证
├── solution/              # [新增] 解决方案管理
│   ├── solution.ts        # 解决方案 CRUD
│   ├── solution.sql.ts    # 解决方案表 schema
│   ├── module.ts          # 模块管理
│   ├── module.sql.ts      # 模块表 schema
│   ├── page.ts            # 页面/菜单管理
│   └── page.sql.ts        # 页面表 schema
├── review/                # [新增] 审核流程
│   ├── review.ts          # 审核流程管理
│   ├── review.sql.ts      # 审核表 schema
│   ├── change-request.ts  # 变更请求管理
│   └── change-request.sql.ts
├── preview/               # [新增] 页面仿真与原型预览
│   ├── preview.ts         # 预览服务
│   └── prototype.ts       # 原型管理
├── user-apikey/           # [新增] 用户级 API Key 管理
│   ├── user-apikey.ts
│   └── user-apikey.sql.ts
└── server/routes/         # [修改] 新增路由
    ├── user.ts            # 用户相关 API
    ├── tp-solution.ts     # 解决方案相关 API
    ├── review.ts          # 审核相关 API
    └── preview.ts         # 预览相关 API
```

---

## 4. 阶段规划

### 4.1 总体阶段划分

```
阶段一（基础设施）──→ 阶段二（业务功能）──→ 阶段三（审核与原型）──→ 第二期
     2-3周                  3-4周                  3-4周               持续迭代
```

### 4.2 阶段一：基础设施改造（2-3周）

| 编号  | 任务                                    | 优先级 | 涉及层      |
| ----- | --------------------------------------- | ------ | ----------- |
| P1-01 | 品牌重命名 OpenCode → tpCode            | 高     | 前端+后端   |
| P1-02 | 用户表、角色表数据库设计与迁移          | 高     | 数据层      |
| P1-03 | 用户注册/登录 API（用户名/手机号/密码） | 高     | 后端        |
| P1-04 | JWT 认证中间件                          | 高     | 后端        |
| P1-05 | 前端登录/注册页面                       | 高     | 前端        |
| P1-06 | Session 表增加 user_id 字段 + 数据隔离  | 高     | 数据层+后端 |
| P1-07 | 用户级 API Key 存储与管理               | 中     | 后端+数据层 |
| P1-08 | 用户设置页面（API Key 配置）            | 中     | 前端        |
| P1-09 | 右侧文件浏览器权限控制                  | 中     | 前端+后端   |
| P1-10 | 角色与权限基础框架                      | 中     | 后端        |

### 4.3 阶段二：业务功能开发（3-4周）

| 编号  | 任务                               | 优先级 | 涉及层    |
| ----- | ---------------------------------- | ------ | --------- |
| P2-01 | 解决方案/模块/页面数据库设计与迁移 | 高     | 数据层    |
| P2-02 | 解决方案 CRUD API                  | 高     | 后端      |
| P2-03 | 模块 CRUD API                      | 高     | 后端      |
| P2-04 | 页面/菜单 CRUD API                 | 高     | 后端      |
| P2-05 | 解决方案选择页面（登录后首页）     | 高     | 前端      |
| P2-06 | 模块列表 + 页面菜单树导航          | 高     | 前端      |
| P2-07 | 页面仿真预览（iframe/截图方式）    | 高     | 前端      |
| P2-08 | 解决方案与用户权限关联             | 中     | 后端      |
| P2-09 | 管理后台：解决方案/模块/页面管理   | 中     | 前端+后端 |
| P2-10 | 页面菜单与 AI 对话上下文关联       | 中     | 后端      |

### 4.4 阶段三：审核与原型系统（3-4周）

| 编号  | 任务                               | 优先级 | 涉及层      |
| ----- | ---------------------------------- | ------ | ----------- |
| P3-01 | 变更请求/审核表数据库设计与迁移    | 高     | 数据层      |
| P3-02 | 变更请求 CRUD API                  | 高     | 后端        |
| P3-03 | 审核流程 API（提交/审批/驳回）     | 高     | 后端        |
| P3-04 | AI 修改方案生成（伪代码/计划）     | 高     | 后端(Agent) |
| P3-05 | 修改后原型预览生成                 | 高     | 后端+前端   |
| P3-06 | 审核人选择与通知机制               | 中     | 后端+前端   |
| P3-07 | 审核列表页面                       | 中     | 前端        |
| P3-08 | 审核详情 + 方案对比页面            | 中     | 前端        |
| P3-09 | 原型挂载到页面菜单（带时间戳标记） | 中     | 前端+后端   |
| P3-10 | 审核通过后自动触发代码生成         | 中     | 后端(Agent) |

---

## 5. 多智能体协作方案

### 5.1 Agent 角色定义

```
┌─────────────────────────────────────────────────────┐
│                 Orchestrator Agent                   │
│            （编排Agent / 总协调者）                   │
├──────────┬──────────┬──────────┬────────────────────┤
│          │          │          │                    │
▼          ▼          ▼          ▼                    ▼
┌────┐  ┌────┐  ┌────┐  ┌──────────┐  ┌──────────────┐
│DB  │  │API │  │UI  │  │ Review   │  │ Integration  │
│Agent│  │Agent│  │Agent│  │ Agent   │  │ Agent        │
└────┘  └────┘  └────┘  └──────────┘  └──────────────┘
```

| Agent              | 职责                                           |
| ------------------ | ---------------------------------------------- |
| Orchestrator Agent | 任务分解、调度分配、进度追踪、冲突协调         |
| DB Agent           | 数据库 schema 设计、Drizzle ORM 表定义、迁移   |
| API Agent          | Hono 路由定义、请求校验、业务逻辑、中间件      |
| UI Agent           | SolidJS 页面开发、组件开发、路由配置、状态管理 |
| Review Agent       | 审核流程设计、AI 方案生成集成、原型预览生成    |
| Integration Agent  | 端到端集成验证、回归测试、冲突检测             |

### 5.2 协作流程

各阶段采用并行+串行混合模式：
- DB Agent 先行完成 schema 设计
- UI Agent 可与 DB Agent 并行开发页面骨架
- API Agent 依赖 DB Agent 输出后开始服务层开发
- UI Agent 数据对接需等 API Agent 完成
- Integration Agent 在每阶段末尾进行集成测试

---

## 6. 第一阶段：基础设施改造

### 6.1 P1-01 品牌重命名 OpenCode → tpCode

**修改清单：**

| 文件                                  | 修改内容                                 |
| ------------------------------------- | ---------------------------------------- |
| `packages/ui/src/components/logo.tsx` | 替换 SVG wordmark，"opencode" → "tpCode" |
| `packages/app/index.html`             | `<title>` 替换为 tpCode                  |
| `packages/desktop/index.html`         | 同上                                     |
| `packages/app/src/entry.tsx`          | favicon URL、通知图标 URL 替换           |
| `packages/opencode/src/cli/logo.ts`   | CLI logo ASCII art 替换                  |

### 6.2 P1-02 用户表、角色表数据库设计

**用户表 `tp_user`：**

| 字段          | 类型                 | 说明                      |
| ------------- | -------------------- | ------------------------- |
| id            | text PK              | ULID 主键                 |
| username      | text UNIQUE NOT NULL | 用户名，唯一              |
| phone         | text UNIQUE          | 手机号，唯一，可选        |
| password_hash | text NOT NULL        | 密码哈希（bcrypt/argon2） |
| display_name  | text                 | 显示名称                  |
| role_id       | text FK              | 关联角色表                |
| status        | text NOT NULL        | active / disabled         |
| last_login_at | integer              | 最后登录时间戳            |
| created_at    | integer NOT NULL     | 创建时间                  |
| updated_at    | integer NOT NULL     | 更新时间                  |

**角色表 `tp_role`：**

| 字段         | 类型                 | 说明                                    |
| ------------ | -------------------- | --------------------------------------- |
| id           | text PK              | ULID 主键                               |
| name         | text UNIQUE NOT NULL | 角色名（admin/developer/reviewer/user） |
| display_name | text                 | 显示名称                                |
| permissions  | text NOT NULL        | JSON 权限配置                           |
| created_at   | integer NOT NULL     | 创建时间                                |

### 6.3 P1-03 用户注册/登录 API

**API 端点：**

| 方法  | 路径                | 说明                           |
| ----- | ------------------- | ------------------------------ |
| POST  | `/user/register`    | 用户注册（用户名/手机号/密码） |
| POST  | `/user/login`       | 用户登录，返回 JWT             |
| POST  | `/user/logout`      | 登出（前端清除 token）         |
| GET   | `/user/me`          | 获取当前用户信息               |
| PATCH | `/user/me`          | 更新当前用户信息               |
| PATCH | `/user/me/password` | 修改密码                       |

### 6.4 P1-04 JWT 认证中间件

**实现要点：**

- 使用 Bun 内置 crypto 签发/验证 JWT（HS256）
- JWT payload：`user_id`、`username`、`role`、`exp`
- Token 有效期：24 小时，可配置
- Secret 从环境变量 `TPCODE_JWT_SECRET` 读取

**白名单路由（不需要认证）：**

```typescript
const PUBLIC_ROUTES = ["/user/login", "/user/register", "/global/health"]
```

### 6.5 P1-05 前端登录/注册页面

**登录页设计：**
- tpCode Logo 居中
- 用户名/手机号输入框
- 密码输入框
- 登录按钮
- "没有账号？去注册" 链接

**认证上下文 `auth.tsx`：**
- 使用 `createStore` 管理认证状态
- Token 持久化到 localStorage
- 提供 `login()`、`logout()`、`isAuthenticated()` 方法

### 6.6 P1-06 Session 表增加 user_id

**修改：**
- `session.sql.ts` 增加 `user_id` 字段
- 所有查询增加 `user_id` 过滤条件
- 用户只能查看/操作自己创建的 Session
- admin 角色可查看所有用户的 Session

### 6.7 P1-07 用户级 API Key 管理

**用户 API Key 表 `tp_user_apikey`：**

| 字段        | 类型             | 说明                                     |
| ----------- | ---------------- | ---------------------------------------- |
| id          | text PK          | ULID 主键                                |
| user_id     | text FK NOT NULL | 关联用户                                 |
| provider_id | text NOT NULL    | 提供商标识（anthropic/openai/google 等） |
| api_key     | text NOT NULL    | 加密存储的 API Key                       |
| label       | text             | 用户自定义标签                           |
| created_at  | integer NOT NULL | 创建时间                                 |
| updated_at  | integer NOT NULL | 更新时间                                 |

**查询优先级：** 用户级 API Key → 全局 auth.json → 环境变量

### 6.8 P1-09 文件浏览器权限控制

**权限规则：**

| 角色      | 文件树权限                        |
| --------- | --------------------------------- |
| admin     | 可查看全部（Changes + All Files） |
| developer | 可查看全部（Changes + All Files） |
| reviewer  | 仅可查看 Changes tab              |
| user      | 完全隐藏文件树面板                |

### 6.9 P1-10 角色与权限框架

**预置角色：**

| 角色     | 标识      | 权限说明                                   |
| -------- | --------- | ------------------------------------------ |
| 管理员   | admin     | 全部权限，管理用户/解决方案/审核           |
| 开发者   | developer | 查看/编辑代码，提交变更请求，查看文件树    |
| 审核人   | reviewer  | 查看变更请求，审批/驳回，查看变更文件      |
| 普通用户 | user      | 选择解决方案/模块/页面，提出需求，查看原型 |

**权限矩阵：**

| 功能             | admin | developer | reviewer | user |
| ---------------- | ----- | --------- | -------- | ---- |
| 用户管理         | ✅    | ❌        | ❌       | ❌   |
| 解决方案管理     | ✅    | ❌        | ❌       | ❌   |
| 查看解决方案     | ✅    | ✅        | ✅       | ✅   |
| AI 对话          | ✅    | ✅        | ❌       | ✅   |
| 查看文件树(全部) | ✅    | ✅        | ❌       | ❌   |
| 查看文件树(变更) | ✅    | ✅        | ✅       | ❌   |
| 提交变更请求     | ✅    | ✅        | ❌       | ✅   |
| 审批变更请求     | ✅    | ❌        | ✅       | ❌   |
| 查看原型         | ✅    | ✅        | ✅       | ✅   |
| 配置 API Key     | ✅    | ✅        | ✅       | ✅   |

---

## 7. 第二阶段：业务功能开发

### 7.1 P2-01 解决方案/模块/页面数据库设计

**解决方案表 `tp_solution`：**

| 字段         | 类型             | 说明                |
| ------------ | ---------------- | ------------------- |
| id           | text PK          | ULID 主键           |
| name         | text NOT NULL    | 解决方案名称        |
| description  | text             | 描述                |
| git_repo_url | text             | 关联的 Git 仓库地址 |
| project_id   | text FK          | 关联现有 project 表 |
| owner_id     | text FK          | 创建者用户          |
| status       | text NOT NULL    | active / archived   |
| created_at   | integer NOT NULL | 创建时间            |
| updated_at   | integer NOT NULL | 更新时间            |

**模块表 `tp_module`：**

| 字段        | 类型             | 说明              |
| ----------- | ---------------- | ----------------- |
| id          | text PK          | ULID 主键         |
| solution_id | text FK NOT NULL | 所属解决方案      |
| name        | text NOT NULL    | 模块名称          |
| description | text             | 描述              |
| sort_order  | integer NOT NULL | 排序序号          |
| status      | text NOT NULL    | active / archived |
| created_at  | integer NOT NULL | 创建时间          |
| updated_at  | integer NOT NULL | 更新时间          |

**页面表 `tp_page`：**

| 字段        | 类型             | 说明                       |
| ----------- | ---------------- | -------------------------- |
| id          | text PK          | ULID 主键                  |
| module_id   | text FK NOT NULL | 所属模块                   |
| parent_id   | text FK          | 父页面（支持多级菜单）     |
| name        | text NOT NULL    | 页面名称                   |
| path        | text             | 页面路由路径               |
| preview_url | text             | 仿真预览 URL               |
| page_type   | text NOT NULL    | normal / prototype         |
| sort_order  | integer NOT NULL | 排序序号                   |
| status      | text NOT NULL    | active / archived          |
| prototype_at| integer          | 原型生成时间（原型页面用） |
| created_at  | integer NOT NULL | 创建时间                   |
| updated_at  | integer NOT NULL | 更新时间                   |

### 7.2 P2-02~04 解决方案/模块/页面 CRUD API

| 方法   | 路径                   | 说明                           |
| ------ | ---------------------- | ------------------------------ |
| GET    | `/solution`            | 获取当前用户可见的解决方案列表 |
| POST   | `/solution`            | 创建解决方案（admin）          |
| GET    | `/solution/:id`        | 获取解决方案详情               |
| PATCH  | `/solution/:id`        | 更新解决方案（admin）          |
| DELETE | `/solution/:id`        | 删除解决方案（admin）          |
| GET    | `/solution/:id/module` | 获取模块列表                   |
| POST   | `/solution/:id/module` | 创建模块（admin）              |
| PATCH  | `/module/:id`          | 更新模块                       |
| DELETE | `/module/:id`          | 删除模块                       |
| GET    | `/module/:id/page`     | 获取页面/菜单树                |
| POST   | `/module/:id/page`     | 创建页面                       |
| PATCH  | `/page/:id`            | 更新页面                       |
| DELETE | `/page/:id`            | 删除页面                       |

### 7.3 P2-05 解决方案选择页面

**页面设计：**
- 卡片式布局，每个解决方案一张卡片
- 卡片内容：名称、描述、状态标签、最近活动时间
- 点击卡片进入该解决方案的模块/页面导航
- admin 角色显示"管理"入口按钮

### 7.4 P2-06 模块列表 + 页面菜单树导航

**页面设计：**
- 左侧：模块列表（垂直 tab 切换）
- 右侧：当前模块下的页面菜单树（支持多级嵌套）
- 菜单树节点显示：页面名称、类型标签（normal/prototype）、原型时间戳
- 点击页面节点 → 进入仿真预览 + AI 对话界面

### 7.5 P2-07 页面仿真预览

**实现方案：**
- 方案A（推荐）：iframe 嵌入目标页面 URL（`tp_page.preview_url`）
- 方案B：服务端截图（Puppeteer/Playwright），存储为静态图片
- 预览区域占页面左侧 60%，右侧 40% 为 AI 对话区域
- 预览区域顶部显示当前页面路径面包屑

---

## 8. 第三阶段：审核与原型系统

### 8.1 P3-01 变更请求/审核表数据库设计

**变更请求表 `tp_change_request`：**

| 字段             | 类型             | 说明                                                       |
| ---------------- | ---------------- | ---------------------------------------------------------- |
| id               | text PK          | ULID 主键                                                  |
| page_id          | text FK NOT NULL | 关联页面                                                   |
| user_id          | text FK NOT NULL | 提交人                                                     |
| session_id       | text FK          | 关联 AI 对话 Session                                       |
| title            | text NOT NULL    | 变更标题                                                   |
| description      | text NOT NULL    | 用户输入的修改需求                                         |
| ai_plan          | text             | AI 生成的修改方案（伪代码/计划）                           |
| ai_prototype_url | text             | AI 生成的原型预览地址                                      |
| status           | text NOT NULL    | draft/pending_review/approved/rejected/executing/completed |
| created_at       | integer NOT NULL | 创建时间                                                   |
| updated_at       | integer NOT NULL | 更新时间                                                   |

**审核表 `tp_review`：**

| 字段              | 类型             | 说明                      |
| ----------------- | ---------------- | ------------------------- |
| id                | text PK          | ULID 主键                 |
| change_request_id | text FK NOT NULL | 关联变更请求              |
| reviewer_id       | text FK NOT NULL | 审核人                    |
| status            | text NOT NULL    | pending/approved/rejected |
| comment           | text             | 审核意见                  |
| reviewed_at       | integer          | 审核时间                  |
| created_at        | integer NOT NULL | 创建时间                  |

### 8.2 审核流程状态机

```
┌─────────┐    提交审核    ┌────────────────┐
│  draft  │ ─────────────→ │ pending_review │
└─────────┘                └────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              │              ▼
              ┌──────────┐        │        ┌──────────┐
              │ approved │        │        │ rejected │
              └──────────┘        │        └──────────┘
                    │             │              │
                    ▼             │              │
              ┌───────────┐      │              │
              │ executing │      │              │
              └───────────┘      │              │
                    │             │              │
                    ▼             │              │
              ┌───────────┐      │              │
              │ completed │←─────┴──────────────┘
              └───────────┘      (重新提交)
```

### 8.3 P3-04 AI 修改方案生成

**流程：**
1. 用户在页面仿真预览界面输入修改需求
2. 系统创建变更请求（draft 状态）
3. AI Agent 分析当前页面代码 + 用户需求
4. 生成修改方案（伪代码/计划）
5. 生成修改后的原型预览
6. 用户确认后提交审核

### 8.4 P3-09 原型挂载到页面菜单

**实现：**
- 审核通过后，在 `tp_page` 表新增一条 `page_type=prototype` 的记录
- 原型页面名称格式：`{原页面名称}_原型_{时间戳}`
- 菜单树中原型页面显示特殊标记（如蓝色标签）
- 点击原型页面可查看 AI 生成的预览效果

---

## 9. 数据库设计

### 9.1 ER 关系图

```
┌──────────┐     ┌──────────┐     ┌───────────────┐
│ tp_role  │←────│ tp_user  │────→│ tp_user_apikey│
└──────────┘     └──────────┘     └───────────────┘
                      │
                      │ owner_id / user_id
                      ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ tp_solution │──│ tp_module   │──│ tp_page     │
└─────────────┘  └─────────────┘  └─────────────┘
                                        │
                                        │ page_id
                                        ▼
                               ┌──────────────────┐
                               │ tp_change_request│
                               └──────────────────┘
                                        │
                                        │ change_request_id
                                        ▼
                               ┌──────────────────┐
                               │ tp_review        │
                               └──────────────────┘
```

### 9.2 完整表结构汇总

| 表名               | 用途           | 关键外键                          |
| ------------------ | -------------- | --------------------------------- |
| tp_role            | 角色定义       | -                                 |
| tp_user            | 用户账号       | role_id → tp_role                 |
| tp_user_apikey     | 用户 API Key   | user_id → tp_user                 |
| tp_solution        | 解决方案       | owner_id → tp_user                |
| tp_module          | 模块           | solution_id → tp_solution         |
| tp_page            | 页面/菜单      | module_id → tp_module             |
| tp_change_request  | 变更请求       | page_id, user_id, session_id      |
| tp_review          | 审核记录       | change_request_id, reviewer_id    |
| session (改造)     | AI 对话会话    | 新增 user_id → tp_user            |

### 9.3 索引设计

```sql
-- 用户表索引
CREATE INDEX idx_tp_user_username ON tp_user(username);
CREATE INDEX idx_tp_user_phone ON tp_user(phone);
CREATE INDEX idx_tp_user_role ON tp_user(role_id);

-- 解决方案索引
CREATE INDEX idx_tp_solution_owner ON tp_solution(owner_id);
CREATE INDEX idx_tp_solution_status ON tp_solution(status);

-- 模块索引
CREATE INDEX idx_tp_module_solution ON tp_module(solution_id);

-- 页面索引
CREATE INDEX idx_tp_page_module ON tp_page(module_id);
CREATE INDEX idx_tp_page_parent ON tp_page(parent_id);

-- 变更请求索引
CREATE INDEX idx_tp_change_request_page ON tp_change_request(page_id);
CREATE INDEX idx_tp_change_request_user ON tp_change_request(user_id);
CREATE INDEX idx_tp_change_request_status ON tp_change_request(status);

-- 审核索引
CREATE INDEX idx_tp_review_change_request ON tp_review(change_request_id);
CREATE INDEX idx_tp_review_reviewer ON tp_review(reviewer_id);

-- Session 索引（新增）
CREATE INDEX idx_session_user ON session(user_id);
```

---

## 10. API 接口设计

### 10.1 认证相关 API

| 方法 | 路径                | 请求体                                          | 响应                     |
| ---- | ------------------- | ----------------------------------------------- | ------------------------ |
| POST | `/user/register`    | `{username, phone?, password, display_name?}`   | `{user, token}`          |
| POST | `/user/login`       | `{username, password}` 或 `{phone, password}`   | `{user, token}`          |
| GET  | `/user/me`          | -                                               | `{user}`                 |
| PATCH| `/user/me`          | `{display_name?}`                               | `{user}`                 |
| PATCH| `/user/me/password` | `{old_password, new_password}`                  | `{success: true}`        |

### 10.2 用户 API Key 相关

| 方法   | 路径                   | 请求体                        | 响应                |
| ------ | ---------------------- | ----------------------------- | ------------------- |
| GET    | `/user/me/apikeys`     | -                             | `{apikeys: [...]}`  |
| POST   | `/user/me/apikeys`     | `{provider_id, api_key, label?}` | `{apikey}`       |
| DELETE | `/user/me/apikeys/:id` | -                             | `{success: true}`   |

### 10.3 解决方案相关

| 方法   | 路径                   | 请求体                                    | 响应                |
| ------ | ---------------------- | ----------------------------------------- | ------------------- |
| GET    | `/solution`            | -                                         | `{solutions: [...]}` |
| POST   | `/solution`            | `{name, description?, git_repo_url?}`     | `{solution}`        |
| GET    | `/solution/:id`        | -                                         | `{solution}`        |
| PATCH  | `/solution/:id`        | `{name?, description?, status?}`          | `{solution}`        |
| DELETE | `/solution/:id`        | -                                         | `{success: true}`   |

### 10.4 模块相关

| 方法   | 路径                   | 请求体                              | 响应              |
| ------ | ---------------------- | ----------------------------------- | ----------------- |
| GET    | `/solution/:id/module` | -                                   | `{modules: [...]}` |
| POST   | `/solution/:id/module` | `{name, description?, sort_order?}` | `{module}`        |
| PATCH  | `/module/:id`          | `{name?, description?, sort_order?}` | `{module}`       |
| DELETE | `/module/:id`          | -                                   | `{success: true}` |

### 10.5 页面相关

| 方法   | 路径               | 请求体                                        | 响应              |
| ------ | ------------------ | --------------------------------------------- | ----------------- |
| GET    | `/module/:id/page` | -                                             | `{pages: [...]}`  |
| POST   | `/module/:id/page` | `{name, path?, parent_id?, preview_url?, sort_order?}` | `{page}` |
| PATCH  | `/page/:id`        | `{name?, path?, preview_url?, sort_order?}`   | `{page}`          |
| DELETE | `/page/:id`        | -                                             | `{success: true}` |

### 10.6 变更请求相关

| 方法  | 路径                          | 请求体                          | 响应                   |
| ----- | ----------------------------- | ------------------------------- | ---------------------- |
| GET   | `/change-request`             | `?page_id=&status=`             | `{changeRequests: [...]}` |
| POST  | `/change-request`             | `{page_id, title, description}` | `{changeRequest}`      |
| GET   | `/change-request/:id`         | -                               | `{changeRequest}`      |
| PATCH | `/change-request/:id`         | `{title?, description?}`        | `{changeRequest}`      |
| POST  | `/change-request/:id/submit`  | `{reviewer_ids: []}`            | `{changeRequest}`      |
| POST  | `/change-request/:id/execute` | -                               | `{changeRequest}`      |

### 10.7 审核相关

| 方法  | 路径                    | 请求体                    | 响应              |
| ----- | ----------------------- | ------------------------- | ----------------- |
| GET   | `/review`               | `?status=pending`         | `{reviews: [...]}` |
| GET   | `/review/:id`           | -                         | `{review}`        |
| POST  | `/review/:id/approve`   | `{comment?}`              | `{review}`        |
| POST  | `/review/:id/reject`    | `{comment}`               | `{review}`        |

### 10.8 预览相关

| 方法 | 路径                    | 请求体 | 响应                        |
| ---- | ----------------------- | ------ | --------------------------- |
| GET  | `/preview/page/:id`     | -      | `{preview_url, screenshot?}` |
| POST | `/preview/generate`     | `{change_request_id}` | `{prototype_url}` |

---

## 11. 前端页面设计

### 11.1 页面路由规划

| 路由                          | 页面           | 权限要求     |
| ----------------------------- | -------------- | ------------ |
| `/login`                      | 登录页         | 公开         |
| `/register`                   | 注册页         | 公开         |
| `/`                           | 解决方案选择页 | 登录         |
| `/solution/:id`               | 模块/页面导航  | 登录         |
| `/solution/:id/page/:pageId`  | 页面仿真预览   | 登录         |
| `/review`                     | 审核列表       | reviewer+    |
| `/review/:id`                 | 审核详情       | reviewer+    |
| `/settings`                   | 用户设置       | 登录         |
| `/settings/apikeys`           | API Key 配置   | 登录         |
| `/admin/users`                | 用户管理       | admin        |
| `/admin/solutions`            | 解决方案管理   | admin        |

### 11.2 新增页面文件

```
packages/app/src/pages/
├── login.tsx                 # 登录页
├── register.tsx              # 注册页
├── solutions.tsx             # 解决方案选择页（登录后首页）
├── solution-detail.tsx       # 模块/页面导航
├── page-preview.tsx          # 页面仿真预览 + AI 对话
├── review-list.tsx           # 审核列表
├── review-detail.tsx         # 审核详情
├── settings/
│   ├── index.tsx             # 设置首页
│   └── apikeys.tsx           # API Key 配置
└── admin/
    ├── users.tsx             # 用户管理
    └── solutions.tsx         # 解决方案管理
```

### 11.3 新增 Context

```
packages/app/src/context/
├── auth.tsx                  # 认证状态管理
└── solution.tsx              # 解决方案/模块/页面状态
```

### 11.4 页面布局设计

**页面仿真预览布局：**

```
┌─────────────────────────────────────────────────────────────┐
│  面包屑：解决方案 > 模块 > 页面                              │
├─────────────────────────────────┬───────────────────────────┤
│                                 │                           │
│                                 │      AI 对话区域          │
│      页面仿真预览               │                           │
│      (iframe / 截图)            │   ┌─────────────────────┐ │
│                                 │   │ 对话历史            │ │
│         60%                     │   │                     │ │
│                                 │   │                     │ │
│                                 │   └─────────────────────┘ │
│                                 │   ┌─────────────────────┐ │
│                                 │   │ 输入框              │ │
│                                 │   └─────────────────────┘ │
│                                 │         40%               │
└─────────────────────────────────┴───────────────────────────┘
```

**审核详情布局：**

```
┌─────────────────────────────────────────────────────────────┐
│  变更请求标题                              状态标签          │
├─────────────────────────────────┬───────────────────────────┤
│                                 │                           │
│      原始页面预览               │      修改后原型预览       │
│                                 │                           │
│         50%                     │         50%               │
│                                 │                           │
├─────────────────────────────────┴───────────────────────────┤
│  AI 生成的修改方案（伪代码/计划）                           │
├─────────────────────────────────────────────────────────────┤
│  审核意见输入框                    [驳回]  [通过]           │
└─────────────────────────────────────────────────────────────┘
```

---

## 12. 现有功能修改清单

### 12.1 需要修改的现有文件

| 文件路径                                           | 修改内容                           |
| -------------------------------------------------- | ---------------------------------- |
| `packages/opencode/src/server/server.ts`           | 注入 JWT 认证中间件                |
| `packages/opencode/src/session/session.sql.ts`     | 增加 user_id 字段                  |
| `packages/opencode/src/session/index.ts`           | 查询增加 user_id 过滤              |
| `packages/opencode/src/server/routes/session.ts`   | 从 JWT context 获取 user_id        |
| `packages/opencode/src/provider/auth.ts`           | 优先查询用户级 API Key             |
| `packages/app/src/app.tsx`                         | 新增路由、认证守卫                 |
| `packages/app/src/pages/session/session-side-panel.tsx` | 文件树权限控制               |
| `packages/app/src/context/layout.tsx`              | fileTree 状态增加权限判断          |
| `packages/ui/src/components/logo.tsx`              | 品牌替换 opencode → tpCode         |
| `packages/app/index.html`                          | title 替换                         |
| `packages/desktop/index.html`                      | title 替换                         |
| `packages/app/src/entry.tsx`                       | favicon、通知图标替换              |
| `packages/opencode/src/cli/logo.ts`                | CLI logo 替换                      |

### 12.2 不应修改的核心文件

以下文件为 AI Agent 核心逻辑，应尽量避免修改：

| 文件路径                                    | 原因                     |
| ------------------------------------------- | ------------------------ |
| `packages/opencode/src/agent/agent.ts`      | AI 对话核心逻辑          |
| `packages/opencode/src/agent/tool.ts`       | 工具调用核心             |
| `packages/opencode/src/session/prompt/`     | 系统提示词（可扩展不改） |
| `packages/opencode/src/provider/`           | AI 提供商集成            |

### 12.3 兼容性保证

| 场景                | 保证措施                                    |
| ------------------- | ------------------------------------------- |
| CLI/TUI 模式        | 保留原有启动方式，不强制登录                |
| 现有 Session 数据   | 迁移时设置默认 user_id                      |
| 现有 auth.json      | 作为 fallback，用户级 API Key 优先          |
| localStorage keys   | 暂不修改 `opencode.*` 前缀，避免数据丢失    |

---

## 13. 远期规划（第二期）

### 13.1 端到端自动化流水线

**目标：** 需求 → 计划 → 原型 → 代码 → 测试 → 部署 全自动化

**实现路径：**

1. 集成 CI/CD 系统（GitHub Actions / GitLab CI）
2. 审核通过后自动触发代码生成
3. 代码生成后自动运行测试
4. 测试通过后自动部署到预发布环境
5. 人工确认后部署到生产环境

### 13.2 系统运行日志采集

**采集内容：**
- 用户操作日志（点击、输入、导航）
- AI 对话日志（请求、响应、耗时）
- 系统错误日志
- 性能指标（响应时间、资源使用）

**存储方案：**
- 新增 `tp_operation_log` 表
- 可选接入 ELK / Loki 等日志系统

### 13.3 用户操作习惯采集

**采集内容：**
- 常用功能路径
- 操作频率统计
- 停留时间分析
- 错误操作模式

**应用场景：**
- 个性化推荐
- UI/UX 优化
- 培训材料生成

### 13.4 AI 自动生成优化方案

**流程：**

```
日志数据 → 数据分析 → 模式识别 → AI 生成优化建议 → 人工审核 → 自动执行
```

**优化类型：**
- 性能优化建议
- 代码重构建议
- 安全漏洞修复
- 用户体验改进

### 13.5 多租户支持

**远期考虑：**
- 工作空间（Workspace）概念
- 租户级数据隔离
- 租户级配置管理
- 计费与配额管理

---

## 14. 风险与约束

### 14.1 技术风险

| 风险                     | 影响 | 缓解措施                           |
| ------------------------ | ---- | ---------------------------------- |
| 数据库迁移失败           | 高   | 备份现有数据，分步迁移，回滚脚本   |
| JWT 安全漏洞             | 高   | 使用成熟库，定期轮换密钥           |
| 性能下降（多用户并发）   | 中   | 连接池、缓存、索引优化             |
| 前端状态管理复杂度增加   | 中   | 统一使用 createStore，模块化设计   |
| 与现有功能冲突           | 中   | 充分测试，保留 fallback            |

### 14.2 业务风险

| 风险                     | 影响 | 缓解措施                           |
| ------------------------ | ---- | ---------------------------------- |
| 用户学习成本             | 中   | 渐进式引导，保留简单模式           |
| 审核流程阻塞开发效率     | 中   | 支持紧急通道，审核超时自动通过     |
| 权限配置错误导致数据泄露 | 高   | 默认最小权限，审计日志             |

### 14.3 约束条件

| 约束                     | 说明                                       |
| ------------------------ | ------------------------------------------ |
| 不能影响 CLI/TUI 模式    | 命令行用户不强制登录                       |
| 不能破坏现有 Session     | 迁移时保留历史数据                         |
| 不能修改 AI Agent 核心   | 通过扩展而非修改实现新功能                 |
| 保持单体部署能力         | 不引入强依赖的外部服务（如 Redis）         |

---

## 15. 附录：文件修改索引

### 15.1 新增文件清单

**后端（packages/opencode/src/）：**

```
user/
├── user.ts
├── user.sql.ts
├── role.ts
├── role.sql.ts
└── jwt.ts

solution/
├── solution.ts
├── solution.sql.ts
├── module.ts
├── module.sql.ts
├── page.ts
└── page.sql.ts

review/
├── review.ts
├── review.sql.ts
├── change-request.ts
└── change-request.sql.ts

preview/
├── preview.ts
└── prototype.ts

user-apikey/
├── user-apikey.ts
└── user-apikey.sql.ts

server/routes/
├── user.ts
├── tp-solution.ts
├── review.ts
└── preview.ts
```

**前端（packages/app/src/）：**

```
pages/
├── login.tsx
├── register.tsx
├── solutions.tsx
├── solution-detail.tsx
├── page-preview.tsx
├── review-list.tsx
├── review-detail.tsx
├── settings/
│   ├── index.tsx
│   └── apikeys.tsx
└── admin/
    ├── users.tsx
    └── solutions.tsx

context/
├── auth.tsx
└── solution.tsx
```

### 15.2 修改文件清单

| 文件                                               | 修改类型 |
| -------------------------------------------------- | -------- |
| `packages/opencode/src/server/server.ts`           | 中间件   |
| `packages/opencode/src/session/session.sql.ts`     | 字段     |
| `packages/opencode/src/session/index.ts`           | 逻辑     |
| `packages/opencode/src/server/routes/session.ts`   | 逻辑     |
| `packages/opencode/src/provider/auth.ts`           | 逻辑     |
| `packages/app/src/app.tsx`                         | 路由     |
| `packages/app/src/pages/session/session-side-panel.tsx` | UI  |
| `packages/app/src/context/layout.tsx`              | 状态     |
| `packages/ui/src/components/logo.tsx`              | 品牌     |
| `packages/app/index.html`                          | 品牌     |
| `packages/desktop/index.html`                      | 品牌     |
| `packages/app/src/entry.tsx`                       | 品牌     |
| `packages/opencode/src/cli/logo.ts`                | 品牌     |

### 15.3 数据库迁移文件

```
packages/opencode/migration/
├── 0001_add_user_role.sql
├── 0002_add_user_apikey.sql
├── 0003_add_solution_module_page.sql
├── 0004_add_change_request_review.sql
└── 0005_add_session_user_id.sql
```

---

## 附录 A：环境变量配置

| 变量名                  | 说明                    | 默认值           |
| ----------------------- | ----------------------- | ---------------- |
| `TPCODE_JWT_SECRET`     | JWT 签名密钥            | 随机生成         |
| `TPCODE_JWT_EXPIRES`    | JWT 过期时间（秒）      | 86400 (24小时)   |
| `TPCODE_ENCRYPTION_KEY` | API Key 加密密钥        | 随机生成         |
| `TPCODE_DB_PATH`        | 数据库文件路径          | ~/.tpcode/tpcode.db |

---

## 附录 B：API 错误码

| 错误码 | 说明                 |
| ------ | -------------------- |
| 401    | 未认证               |
| 403    | 无权限               |
| 404    | 资源不存在           |
| 409    | 资源冲突（如用户名重复） |
| 422    | 请求参数校验失败     |
| 500    | 服务器内部错误       |

---

*文档版本：v2.0*
*最后更新：2026-02-28*
