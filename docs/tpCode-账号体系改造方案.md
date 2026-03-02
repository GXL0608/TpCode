# tpCode 账号与权限体系改造方案（补全版）

> 主题：账号、登录、角色、权限、用户级 API Key、会话隔离
> 版本：v1.1
> 日期：2026-03-02
> 约束：基于当前开源项目 `packages/opencode`，继续使用现有 SQLite + Drizzle，不迁移到 PostgreSQL

---

## 1. 背景与目标

当前 tpCode 要同时服务两类人群：

1. 内部人员：研发、运维、项目、价值运营。
2. 医院侧用户：信息科、科室主任、院长、一线使用人员。

本次改造目标是把“账号体系”做成可上线、可扩展、可与 VHO 融合的基础设施，重点解决：

1. 完整登录体系：登录、注册、密码管理、会话管理。
2. 组织体系：内部账号 + 医院账号 + 科室（部门）划分。
3. RBAC：用户/部门/角色/权限可管理、可审计。
4. 会话隔离：用户会话与数据可见范围严格隔离。
5. 用户级 API Key：每个用户独立配置，不混用。
6. 不影响当前可用性：CLI/TUI、既有功能可平滑过渡。

---

## 2. 现状核查（基于当前代码）

### 2.1 认证与会话现状

| 文件 | 现状 | 风险 |
| --- | --- | --- |
| `packages/opencode/src/server/server.ts` | 使用可选 `basicAuth`（`OPENCODE_SERVER_PASSWORD`） | 仅单口令，无多用户 |
| `packages/opencode/src/session/session.sql.ts` | `session` 表无 `user_id`、`org_id`、`department_id` | 会话无法按人隔离 |
| `packages/opencode/src/session/index.ts` | `Session.list()` 仅按项目/目录筛选 | 默认全可见 |
| `packages/app/src/app.tsx` | 无登录页、无路由守卫 | 任意访问 |

### 2.2 Provider 凭据现状

| 文件 | 现状 | 风险 |
| --- | --- | --- |
| `packages/opencode/src/auth/index.ts` | 凭据写入全局 `auth.json` | 所有用户共享同一套 Key |
| `packages/opencode/src/provider/provider.ts` | Provider 状态通过 `Instance.state()` 缓存 | 多用户同目录下可能混用凭据 |
| `packages/opencode/src/project/instance.ts` | 实例/状态 key 仅按 `directory` | 无用户维度隔离 |

### 2.3 数据库与迁移机制现状

1. 数据库：SQLite（`opencode.db`）。
2. ORM：Drizzle（`sqlite-core`）。
3. 迁移：`packages/opencode/migration/<timestamp>_*`。
4. Schema 汇总：`packages/opencode/src/storage/schema.ts`。
5. 时间戳复用：`packages/opencode/src/storage/schema.sql.ts` 的 `Timestamps`。

---

## 3. 设计原则

1. 先补齐登录 + RBAC + 隔离，再扩展审批与知识库。
2. 兼容优先：默认通过 feature flag 控制，不直接破坏 CLI/TUI。
3. 最小权限默认拒绝：无权限即不可见、不可操作。
4. 用户级凭据优先：用户配置优先于共享配置。
5. 可并入 VHO：先独立可跑，再按字段和协议并轨。

---

## 4. 账号模型（内部 + 医院）

### 4.1 账号类型

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `account_type` | `internal` | 内部研发/运维/项目/运营 |
| `account_type` | `hospital` | 医院侧账号 |
| `account_type` | `partner` | 生态伙伴（预留） |

### 4.2 组织与部门模型

1. 顶层组织使用 `tp_organization`。
2. 每家医院对应一条 `organization(type=hospital)`。
3. 科室/信息科/院办对应 `tp_department`。
4. 内部公司也作为一个 `organization(type=internal)`，下挂研发/运维/项目/运营部门。

示例：

```text
天鹏科技（internal）
  ├─ 研发部
  ├─ 运维部
  ├─ 项目部
  └─ 价值运营部

XX医院（hospital）
  ├─ 信息科
  ├─ 门诊部
  ├─ 财务科
  ├─ 脑外科
  ├─ 骨科
  └─ 院办
```

---

## 5. RBAC 设计（用户/部门/角色/权限）

### 5.1 预置角色

| 角色 code | 名称 | scope |
| --- | --- | --- |
| `super_admin` | 超级管理员 | `system` |
| `dev_lead` | 研发组长 | `system` |
| `developer` | 研发工程师 | `system` |
| `ops` | 运维工程师 | `system` |
| `pm` | 项目经理 | `system` |
| `value_ops` | 价值运营 | `system` |
| `hospital_admin` | 信息科长 | `org` |
| `dept_director` | 科室主任 | `org` |
| `hospital_user` | 医院普通用户 | `org` |
| `dean` | 院长 | `org` |

### 5.2 核心权限集

| 权限 code | 说明 |
| --- | --- |
| `user:manage` | 用户增删改查 |
| `org:manage` | 组织/部门管理 |
| `role:manage` | 角色权限配置 |
| `session:create` | 创建会话 |
| `session:view_own` | 查看本人会话 |
| `session:view_dept` | 查看部门会话 |
| `session:view_org` | 查看组织会话 |
| `session:view_all` | 查看全局会话 |
| `session:update_any` | 修改他人会话（受控） |
| `code:generate` | 触发代码生成 |
| `code:review` | 审核代码变更 |
| `code:deploy` | 部署 |
| `prototype:view` | 查看原型 |
| `prototype:approve` | 原型确认/审批 |
| `file:browse` | 文件树浏览 |
| `provider:config_own` | 配置本人 API Key |
| `provider:config_global` | 配置全局共享 Key（受限） |
| `audit:view` | 查看审计日志 |

### 5.3 数据可见域

会话增加 `visibility`：

1. `private`：仅自己。
2. `department`：本部门可见。
3. `org`：本组织可见。
4. `public`：全局可见（仅高权限角色可创建）。

---

## 6. 数据库设计（基于现有 SQLite）

### 6.1 新增表

> 目录建议：`packages/opencode/src/user/*.sql.ts`

### `tp_organization`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | not null |
| `code` | text | unique, not null |
| `org_type` | text | not null (`internal/hospital/partner`) |
| `status` | text | not null, default `active` |
| `parent_id` | text | nullable, FK self |
| `time_created` | integer | not null |
| `time_updated` | integer | not null |

### `tp_department`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `org_id` | text | not null, FK `tp_organization.id` |
| `parent_id` | text | nullable, FK self |
| `name` | text | not null |
| `code` | text | nullable |
| `sort_order` | integer | not null, default 0 |
| `status` | text | not null, default `active` |
| `time_created` | integer | not null |
| `time_updated` | integer | not null |

### `tp_user`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `username` | text | unique, not null |
| `password_hash` | text | not null |
| `display_name` | text | not null |
| `email` | text | nullable |
| `phone` | text | nullable |
| `account_type` | text | not null |
| `org_id` | text | not null, FK `tp_organization.id` |
| `department_id` | text | nullable, FK `tp_department.id` |
| `status` | text | not null, default `active` |
| `force_password_reset` | integer | not null, default 1 |
| `failed_login_count` | integer | not null, default 0 |
| `locked_until` | integer | nullable |
| `vho_user_id` | text | nullable |
| `external_source` | text | nullable (`tpcode/vho/sso`) |
| `last_login_at` | integer | nullable |
| `last_login_ip` | text | nullable |
| `time_created` | integer | not null |
| `time_updated` | integer | not null |

### `tp_role`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `code` | text | unique, not null |
| `name` | text | not null |
| `scope` | text | not null (`system/org`) |
| `description` | text | nullable |
| `status` | text | not null, default `active` |
| `time_created` | integer | not null |
| `time_updated` | integer | not null |

### `tp_user_role`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `user_id` | text | FK `tp_user.id`, cascade |
| `role_id` | text | FK `tp_role.id`, cascade |
| `time_created` | integer | not null |

主键：`(user_id, role_id)`。

### `tp_permission`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `code` | text | unique, not null |
| `name` | text | not null |
| `group_name` | text | not null |
| `description` | text | nullable |

### `tp_role_permission`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `role_id` | text | FK `tp_role.id`, cascade |
| `permission_id` | text | FK `tp_permission.id`, cascade |

主键：`(role_id, permission_id)`。

### `tp_session_token`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | not null, FK `tp_user.id`, cascade |
| `token_hash` | text | unique, not null |
| `token_type` | text | not null (`access/refresh`) |
| `expires_at` | integer | not null |
| `revoked_at` | integer | nullable |
| `ip` | text | nullable |
| `user_agent` | text | nullable |
| `time_created` | integer | not null |

### `tp_user_provider`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | not null, FK `tp_user.id`, cascade |
| `provider_id` | text | not null |
| `auth_type` | text | not null (`api/oauth/wellknown`) |
| `secret_cipher` | text | not null（加密后） |
| `meta_json` | text | nullable（json） |
| `is_active` | integer | not null, default 1 |
| `time_created` | integer | not null |
| `time_updated` | integer | not null |

唯一约束：`(user_id, provider_id)`。

### `tp_password_reset`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `user_id` | text | not null, FK `tp_user.id`, cascade |
| `code_hash` | text | not null |
| `channel` | text | not null (`email/sms/admin`) |
| `expires_at` | integer | not null |
| `consumed_at` | integer | nullable |
| `time_created` | integer | not null |

### `tp_audit_log`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | text | PK |
| `actor_user_id` | text | nullable, FK `tp_user.id` |
| `action` | text | not null |
| `target_type` | text | not null |
| `target_id` | text | nullable |
| `result` | text | not null (`success/failed/blocked`) |
| `detail_json` | text | nullable |
| `ip` | text | nullable |
| `user_agent` | text | nullable |
| `time_created` | integer | not null |

### 6.2 现有表改造

### `session` 表扩展（`packages/opencode/src/session/session.sql.ts`）

新增字段：

1. `user_id`：创建者。
2. `org_id`：创建者组织快照。
3. `department_id`：创建者部门快照。
4. `visibility`：`private/department/org/public`。

新增索引：

1. `session_user_idx(user_id)`
2. `session_org_idx(org_id)`
3. `session_department_idx(department_id)`
4. `session_visibility_idx(visibility)`

### Schema 注册

在 `packages/opencode/src/storage/schema.ts` 增加对上述新表导出。

---

## 7. 登录注册与密码管理（完整体系）

### 7.1 路由分组（避免与现有 `/auth/:providerID` 冲突）

新增账号路由前缀：`/account`。

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/account/register` | 注册（建议邀请码或管理员预创建） |
| `POST` | `/account/login` | 账号密码登录 |
| `POST` | `/account/logout` | 当前会话退出 |
| `POST` | `/account/logout-all` | 全设备退出 |
| `POST` | `/account/token/refresh` | 刷新 token |
| `GET` | `/account/me` | 当前用户信息 + 角色 + 权限 |
| `POST` | `/account/password/change` | 登录态改密 |
| `POST` | `/account/password/forgot/request` | 发起找回 |
| `POST` | `/account/password/forgot/reset` | 重置密码 |

### 7.2 认证机制

1. `access_token`（短期，例如 2 小时）。
2. `refresh_token`（长期，例如 14 天）。
3. 服务端只落 `token_hash`，不落明文 token。
4. 中间件校验后注入：`user_id`、`org_id`、`department_id`、`roles`、`permissions`。

### 7.3 密码策略

1. 最低长度 8，至少包含大写/小写/数字。
2. 首次登录强制改密（`force_password_reset=1`）。
3. 连续失败锁定（例如 5 次后锁 15 分钟）。
4. 密码哈希用 Bun 原生 `Bun.password`。

### 7.4 注册策略

为避免医院侧乱注册，默认策略：

1. 医院账号由管理员创建或导入。
2. 自助注册需邀请码（可按组织发放）。
3. 可通过 `TPCODE_REGISTER_MODE` 控制：`closed/invite/open`。

---

## 8. 授权与会话隔离

### 8.1 中间件分层

1. `accountAuth`：解析 token 并装载用户上下文。
2. `requirePermission(code)`：RBAC 校验。
3. `requireScope(resource)`：资源级可见域校验（own/dept/org/public）。

### 8.2 `Session.list/get/update/delete` 改造点

`packages/opencode/src/session/index.ts` 关键改造：

1. `createNext()` 写入 `user_id/org_id/department_id/visibility`。
2. `list()` 和 `listGlobal()` 增加用户上下文过滤。
3. 非 owner 且无 `session:update_any` 时禁止更新/删除。
4. 共享、归档、重命名都要走 `requireScope`。

### 8.3 可见性规则

1. `private`：仅 `session.user_id == current_user.id`。
2. `department`：同 `department_id` 且拥有 `session:view_dept`。
3. `org`：同 `org_id` 且拥有 `session:view_org`。
4. `public`：拥有 `session:view_all` 或被显式允许。

---

## 9. 用户级 API Key 隔离

### 9.1 当前问题

当前 `Auth` 写全局 `auth.json`，无法做到“每个账号一套 provider 凭据”。

### 9.2 目标行为

1. 每个用户在“设置-模型配置”中维护自己的 provider key。
2. A 用户的 key 不得被 B 用户读取或使用。
3. 允许管理员配置“全局兜底 key”（可选）。

### 9.3 凭据解析优先级

对 Web 请求建议采用：

1. `tp_user_provider`（当前用户，启用状态）。
2. 全局环境变量（运维统一配置）。
3. 现有 `auth.json`（兼容旧流程，逐步退场）。

### 9.4 Provider 状态缓存隔离（关键）

由于 `Provider` 与 `Instance.state` 当前按目录缓存，必须增加用户维度隔离，避免同目录多用户串 key。

建议改造：

1. 为请求上下文增加 `actor_key = <directory>:<user_id|anonymous>`。
2. `Instance.state()` 的 key 从 `directory` 扩展为 `actor_key`（账号模式开启时启用）。
3. CLI/TUI 保持原逻辑（`user_id` 为空时回退旧 key），避免破坏本地体验。

---

## 10. 前端改造（完整登录系统）

### 10.1 新增页面

建议新增：

1. `/login`：账号密码登录。
2. `/register`：邀请码注册。
3. `/password/forgot`：找回入口。
4. `/password/reset`：验证码重置。
5. `/settings/security`：登录后改密。
6. `/settings/apikeys`：本人 API Key 配置。

### 10.2 路由守卫

`packages/app/src/app.tsx` 增加：

1. `AuthProvider`（token 存储、刷新、用户信息）。
2. `ProtectedRoute`（无登录跳 `/login`）。
3. 权限路由（无权限跳 403 页面或首页）。

### 10.3 文件浏览器权限控制

按你的要求“右侧文件浏览去掉，不能随意看”：

1. 默认隐藏文件树。
2. 仅 `file:browse` 用户可显示完整文件树。
3. 非 `file:browse` 用户仅看“变更摘要/补丁视图”。

---

## 11. 与端到端流程的衔接（本方案关心的接口）

虽然本方案聚焦账号体系，但必须支持“提示词→计划→原型→审核→执行”的闭环：

1. 需求提交者必须可追溯到 `user_id + org_id + department_id`。
2. 审核/执行动作必须写审计日志（谁审、谁执行、何时）。
3. 原型确认人和最终执行人必须分角色受控。
4. 不合适原型可回退，回退动作同样记录审计日志。

---

## 12. VHO 融合策略（同一账号体系）

### 12.1 阶段策略

1. 阶段 1（2026-03-02 至 2026-03-08）：tpCode 独立账号可用，预留 VHO 字段。
2. 阶段 2（2026-03-09 起）：接入统一 SSO/OIDC，逐步账号打通。

### 12.2 预留字段

1. `tp_user.vho_user_id`
2. `tp_user.external_source`

### 12.3 合并契机

1. 当 VHO 统一认证中心接口稳定后，切换登录入口为统一认证。
2. tpCode 现有 token 改为统一 token 兑换。
3. 角色映射从 tpCode 本地 role 过渡为“统一角色 + 本地补充权限”。

---

## 13. 任务拆解与分工（本周内落地）

> 时间按当前周：2026-03-02（周一）到 2026-03-08（周日）

### 13.1 轨道 A：后端与数据库（建议你主导）

1. 2026-03-02：完成 schema 评审与 migration 草案。
2. 2026-03-03：完成 `/account/*` 认证接口 + token 机制。
3. 2026-03-04：完成 RBAC 中间件 + session 隔离改造。
4. 2026-03-05：完成 `tp_user_provider` 与 provider 隔离缓存改造。

### 13.2 轨道 B：前端与管理能力（建议郭旭龙主导）

1. 2026-03-03：登录/注册/改密页面与状态管理。
2. 2026-03-04：路由守卫、403、会话范围筛选 UI。
3. 2026-03-05：API Key 配置页（仅本人）。
4. 2026-03-06：文件浏览器权限显示策略。

### 13.3 联调与上线准备

1. 2026-03-06：A/B 轨道联调，修复接口契约。
2. 2026-03-07：回归测试 + 灰度开关验证。
3. 2026-03-08：内部全员切换到 tpCode 账号体系。

---

## 14. 代码改造清单（建议）

### 14.1 新增文件

1. `packages/opencode/src/user/organization.sql.ts`
2. `packages/opencode/src/user/department.sql.ts`
3. `packages/opencode/src/user/user.sql.ts`
4. `packages/opencode/src/user/role.sql.ts`
5. `packages/opencode/src/user/permission.sql.ts`
6. `packages/opencode/src/user/token.sql.ts`
7. `packages/opencode/src/user/user-provider.sql.ts`
8. `packages/opencode/src/user/password-reset.sql.ts`
9. `packages/opencode/src/user/audit-log.sql.ts`
10. `packages/opencode/src/user/service.ts`
11. `packages/opencode/src/user/password.ts`
12. `packages/opencode/src/user/jwt.ts`
13. `packages/opencode/src/user/rbac.ts`
14. `packages/opencode/src/server/routes/account.ts`

### 14.2 修改文件

1. `packages/opencode/src/storage/schema.ts`
2. `packages/opencode/src/session/session.sql.ts`
3. `packages/opencode/src/session/index.ts`
4. `packages/opencode/src/server/server.ts`
5. `packages/opencode/src/provider/provider.ts`
6. `packages/opencode/src/project/instance.ts`
7. `packages/app/src/app.tsx`
8. `packages/app/src/context/*`（新增 auth context）
9. `packages/app/src/pages/*`（登录/注册/改密/APIKey 页面）

### 14.3 迁移文件

1. `packages/opencode/migration/<timestamp>_tpcode_account_system/migration.sql`

---

## 15. 安全与审计要求

1. 所有登录、登出、改密、重置密码写入 `tp_audit_log`。
2. 所有角色变更、权限变更写审计日志。
3. 所有会话可见性变更写审计日志。
4. 禁用词拦截（如删除核心数据）作为输入前置校验，失败直接拒绝入模。
5. 审批与执行必须记录“审核人/执行人”双字段，满足追责。

---

## 16. 验收标准（Definition of Done）

1. 未登录请求访问受保护接口返回 `401`。
2. 普通用户无法看到他人 `private` 会话。
3. 同部门用户可见 `department` 会话，跨部门不可见。
4. API Key 完全按用户隔离，A 用户发起请求不得使用 B 用户 key。
5. 无 `file:browse` 权限时，右侧文件树不可见。
6. 登录、注册、改密、找回密码全流程可用。
7. 账号开关关闭时，现有 CLI/TUI 与老流程可继续工作。

---

## 17. 测试计划

> 注意：按仓库规范，测试从包目录执行，不从仓库根目录执行。

1. 单元测试：`packages/opencode/test/user/*`（密码、JWT、RBAC）。
2. 集成测试：`packages/opencode/test/server/*`（account 接口、session 隔离）。
3. 前端 E2E：登录→进系统→配置 API Key→创建会话→权限校验。
4. 回归测试：provider 连接、session 基础能力、文件操作与非账号模式。

---

## 18. 风险与回滚

### 18.1 风险

1. Provider 缓存未按用户隔离导致串 key。
2. 历史 session 无 `user_id` 导致迁移脏数据。
3. 角色配置错误导致越权或误封禁。

### 18.2 回滚策略

1. 通过 `TPCODE_ACCOUNT_ENABLED=false` 快速回退到旧访问模式。
2. migration 采用“先加字段 nullable，再回填，再收紧约束”。
3. 关键改造保留兼容分支一周，灰度后再清理。

---

## 19. 本文档结论

本补全版已经把原半成品文档扩展为可执行方案，覆盖了：

1. 完整用户登录系统（登录、注册、密码管理、会话管理）。
2. 账号体系（内部账号 + 医院账号 + 科室/部门）。
3. RBAC 与会话隔离（含可见域与资源级校验）。
4. 用户级 API Key 隔离与 Provider 缓存隔离关键点。
5. 与 VHO 合并策略、分工、排期、验收与回滚。
