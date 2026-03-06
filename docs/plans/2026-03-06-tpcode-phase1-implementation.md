# TpCode 阶段 1 实施计划：企业级改造 + 数据积累

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 完成 TpCode v3 企业级改造，启动蒸馏数据采集，为去中心化演进奠定基础

**架构：** 从 SQLite 迁移到 PostgreSQL，构建完整的账号体系和 RBAC 权限系统，实现端到端 VibeCoding 工作流，引入多智能体协作框架，启动蒸馏数据采集。

**技术栈：**
- 数据库：PostgreSQL + Drizzle ORM
- 后端：Bun + Hono + TypeScript
- 多智能体：MetaGPT 或自研框架
- 区块链：以太坊测试网 (Sepolia)
- 加密：argon2 (密码) + AES-256 (API Key)

**时间线：** 0-6 个月

---

## 任务概览

```
Phase 1.1: 数据库迁移与账号体系 (Week 1-4)
├── Task 1: PostgreSQL 迁移
├── Task 2: 用户账号体系
├── Task 3: 部门组织架构
├── Task 4: 角色权限系统 (RBAC)
└── Task 5: JWT 认证中间件

Phase 1.2: 端到端工作流 (Week 5-8)
├── Task 6: 解决方案/模块/页面三级结构
├── Task 7: 变更请求与审批流程
├── Task 8: 沙箱预览机制
├── Task 9: 版本管理与回退
└── Task 10: 工作轴追踪

Phase 1.3: 多智能体协作 (Week 9-12)
├── Task 11: 智能体基础框架
├── Task 12: PM Agent (需求分析)
├── Task 13: Architect Agent (架构设计)
├── Task 14: Coder Agent (代码生成)
├── Task 15: Reviewer Agent (代码审查)
└── Task 16: QA Agent (质量评分)

Phase 1.4: 知识产权确权 (Week 13-16)
├── Task 17: 代码数字水印
├── Task 18: 软件出生证明
├── Task 19: 区块链锚定 (测试网)
└── Task 20: 水印验证工具

Phase 1.5: 蒸馏数据采集 (Week 17-20)
├── Task 21: 数据采集钩子
├── Task 22: 蒸馏数据表设计
├── Task 23: 质量评分标注
├── Task 24: RLHF 反馈收集
└── Task 25: 数据导出工具

Phase 1.6: 前端改造 (Week 21-24)
├── Task 26: 登录页与认证流程
├── Task 27: 解决方案选择界面
├── Task 28: 审批工作流界面
├── Task 29: 沙箱预览组件
└── Task 30: 权限控制 UI
```

---

## Phase 1.1: 数据库迁移与账号体系

### Task 1: PostgreSQL 迁移

**文件：**
- 修改: `packages/opencode/drizzle.config.ts`
- 创建: `packages/opencode/src/db/pg-client.ts`
- 修改: `packages/opencode/src/db/index.ts`

**步骤 1: 安装 PostgreSQL 驱动**

```bash
cd packages/opencode
bun add postgres drizzle-orm@latest
```

**步骤 2: 修改 Drizzle 配置**

修改 `packages/opencode/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/db/schema/**/*.sql.ts",
  out: "./drizzle",
  dialect: "postgresql", // 从 "sqlite" 改为 "postgresql"
  dbCredentials: {
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    user: process.env.POSTGRES_USER || "tpcode",
    password: process.env.POSTGRES_PASSWORD || "tpcode",
    database: process.env.POSTGRES_DB || "tpcode",
  },
})
```

**步骤 3: 创建 PostgreSQL 客户端**

创建 `packages/opencode/src/db/pg-client.ts`:

```typescript
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

const connectionString = process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || "tpcode"}:${process.env.POSTGRES_PASSWORD || "tpcode"}@${process.env.POSTGRES_HOST || "localhost"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "tpcode"}`

const client = postgres(connectionString, {
  max: 10, // 连接池大小
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(client)
export { client }
```

**步骤 4: 更新数据库索引文件**

修改 `packages/opencode/src/db/index.ts`:

```typescript
// 从 SQLite 切换到 PostgreSQL
export { db, client } from "./pg-client"
export * from "./schema"
```

**步骤 5: 运行迁移**

```bash
# 生成迁移文件
bun run drizzle-kit generate

# 执行迁移
bun run drizzle-kit migrate
```

预期输出: `✓ Migrations applied successfully`

**步骤 6: 提交**

```bash
git add packages/opencode/drizzle.config.ts \
        packages/opencode/src/db/pg-client.ts \
        packages/opencode/src/db/index.ts \
        packages/opencode/drizzle/
git commit -m "feat(db): migrate from SQLite to PostgreSQL

- Update drizzle config to use postgresql dialect
- Create PostgreSQL client with connection pooling
- Generate and apply initial migrations

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 用户账号体系

**文件：**
- 创建: `packages/opencode/src/user/user.sql.ts`
- 创建: `packages/opencode/src/user/user.ts`
- 创建: `packages/opencode/src/user/user.test.ts`

**步骤 1: 编写用户表测试**

创建 `packages/opencode/src/user/user.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { db } from "../db"
import { createUser, getUserById, getUserByUsername } from "./user"

describe("User Management", () => {
  beforeAll(async () => {
    // 清理测试数据
    await db.execute("DELETE FROM tp_user WHERE username LIKE 'test_%'")
  })

  afterAll(async () => {
    // 清理测试数据
    await db.execute("DELETE FROM tp_user WHERE username LIKE 'test_%'")
  })

  test("should create a new user", async () => {
    const user = await createUser({
      username: "test_user_1",
      email: "test1@example.com",
      password: "SecurePass123!",
      displayName: "Test User 1",
    })

    expect(user.id).toBeDefined()
    expect(user.username).toBe("test_user_1")
    expect(user.email).toBe("test1@example.com")
    expect(user.passwordHash).not.toBe("SecurePass123!") // 应该被哈希
  })

  test("should retrieve user by ID", async () => {
    const created = await createUser({
      username: "test_user_2",
      email: "test2@example.com",
      password: "SecurePass123!",
    })

    const retrieved = await getUserById(created.id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.username).toBe("test_user_2")
  })

  test("should retrieve user by username", async () => {
    await createUser({
      username: "test_user_3",
      email: "test3@example.com",
      password: "SecurePass123!",
    })

    const user = await getUserByUsername("test_user_3")
    expect(user).toBeDefined()
    expect(user?.email).toBe("test3@example.com")
  })

  test("should not allow duplicate usernames", async () => {
    await createUser({
      username: "test_duplicate",
      email: "dup1@example.com",
      password: "SecurePass123!",
    })

    await expect(
      createUser({
        username: "test_duplicate",
        email: "dup2@example.com",
        password: "SecurePass123!",
      })
    ).rejects.toThrow()
  })
})
```

**步骤 2: 运行测试确认失败**

```bash
cd packages/opencode
bun test src/user/user.test.ts
```

预期输出: `FAIL - Cannot find module './user'`

**步骤 3: 创建用户表 Schema**

创建 `packages/opencode/src/user/user.sql.ts`:

```typescript
import { pgTable, text, bigint, index } from "drizzle-orm/pg-core"
import { ulid } from "ulid"

export const tpUser = pgTable(
  "tp_user",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    username: text("username").notNull().unique(),
    phone: text("phone").unique(),
    email: text("email").unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    roleId: text("role_id").references(() => tpRole.id),
    departmentId: text("department_id").references(() => tpDepartment.id),
    status: text("status").notNull().default("active"), // active | disabled
    vhoUserId: text("vho_user_id"), // VHO 关联用户 ID
    externalSource: text("external_source"), // tpcode | vho | sso
    lastLoginAt: bigint("last_login_at", { mode: "number" }),
    timeCreated: bigint("time_created", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    timeUpdated: bigint("time_updated", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    usernameIdx: index("tp_user_username_idx").on(table.username),
    emailIdx: index("tp_user_email_idx").on(table.email),
    departmentIdx: index("tp_user_department_idx").on(table.departmentId),
  })
)

// 临时占位，后续任务会创建
export const tpRole = pgTable("tp_role", {
  id: text("id").primaryKey(),
})

export const tpDepartment = pgTable("tp_department", {
  id: text("id").primaryKey(),
})
```

**步骤 4: 创建用户管理逻辑**

创建 `packages/opencode/src/user/user.ts`:

```typescript
import { eq } from "drizzle-orm"
import { hash, verify } from "@node-rs/argon2"
import { db } from "../db"
import { tpUser } from "./user.sql"

export interface CreateUserInput {
  username: string
  email?: string
  phone?: string
  password: string
  displayName?: string
  roleId?: string
  departmentId?: string
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await hash(input.password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  })

  const [user] = await db
    .insert(tpUser)
    .values({
      username: input.username,
      email: input.email,
      phone: input.phone,
      passwordHash,
      displayName: input.displayName,
      roleId: input.roleId,
      departmentId: input.departmentId,
    })
    .returning()

  return user
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(tpUser).where(eq(tpUser.id, id))
  return user
}

export async function getUserByUsername(username: string) {
  const [user] = await db.select().from(tpUser).where(eq(tpUser.username, username))
  return user
}

export async function verifyPassword(user: typeof tpUser.$inferSelect, password: string) {
  return verify(user.passwordHash, password)
}

export async function updateLastLogin(userId: string) {
  await db
    .update(tpUser)
    .set({ lastLoginAt: Date.now() })
    .where(eq(tpUser.id, userId))
}
```

**步骤 5: 安装依赖**

```bash
bun add @node-rs/argon2 ulid
```

**步骤 6: 生成并运行迁移**

```bash
bun run drizzle-kit generate
bun run drizzle-kit migrate
```

**步骤 7: 运行测试确认通过**

```bash
bun test src/user/user.test.ts
```

预期输出: `✓ All tests passed`

**步骤 8: 提交**

```bash
git add packages/opencode/src/user/
git commit -m "feat(user): implement user account system

- Create tp_user table with PostgreSQL schema
- Implement user CRUD operations
- Add argon2 password hashing
- Add comprehensive test coverage

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: 部门组织架构

**文件：**
- 创建: `packages/opencode/src/user/department.sql.ts`
- 创建: `packages/opencode/src/user/department.ts`
- 创建: `packages/opencode/src/user/department.test.ts`

**步骤 1: 编写部门测试**

创建 `packages/opencode/src/user/department.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { db } from "../db"
import { createDepartment, getDepartmentTree, getDepartmentById } from "./department"

describe("Department Management", () => {
  let rootDeptId: string
  let childDeptId: string

  beforeAll(async () => {
    await db.execute("DELETE FROM tp_department WHERE code LIKE 'TEST_%'")
  })

  afterAll(async () => {
    await db.execute("DELETE FROM tp_department WHERE code LIKE 'TEST_%'")
  })

  test("should create root department", async () => {
    const dept = await createDepartment({
      name: "测试公司",
      code: "TEST_ROOT",
      type: "internal",
      sortOrder: 1,
    })

    rootDeptId = dept.id
    expect(dept.id).toBeDefined()
    expect(dept.parentId).toBeNull()
  })

  test("should create child department", async () => {
    const dept = await createDepartment({
      name: "测试研发部",
      code: "TEST_DEV",
      type: "internal",
      parentId: rootDeptId,
      sortOrder: 1,
    })

    childDeptId = dept.id
    expect(dept.parentId).toBe(rootDeptId)
  })

  test("should retrieve department tree", async () => {
    const tree = await getDepartmentTree()
    const testRoot = tree.find((d) => d.code === "TEST_ROOT")

    expect(testRoot).toBeDefined()
    expect(testRoot?.children).toBeDefined()
    expect(testRoot?.children?.length).toBeGreaterThan(0)
  })

  test("should retrieve department by ID", async () => {
    const dept = await getDepartmentById(childDeptId)
    expect(dept).toBeDefined()
    expect(dept?.code).toBe("TEST_DEV")
  })
})
```

**步骤 2: 运行测试确认失败**

```bash
bun test src/user/department.test.ts
```

预期输出: `FAIL - Cannot find module './department'`

**步骤 3: 创建部门表 Schema**

创建 `packages/opencode/src/user/department.sql.ts`:

```typescript
import { pgTable, text, integer, bigint, index } from "drizzle-orm/pg-core"
import { ulid } from "ulid"

export const tpDepartment = pgTable(
  "tp_department",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => ulid()),
    parentId: text("parent_id").references((): any => tpDepartment.id),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    type: text("type").notNull(), // internal | hospital
    hospitalId: text("hospital_id"), // 所属医院 ID (医院科室用)
    sortOrder: integer("sort_order").notNull().default(0),
    timeCreated: bigint("time_created", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
    timeUpdated: bigint("time_updated", { mode: "number" })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => ({
    parentIdx: index("tp_department_parent_idx").on(table.parentId),
    codeIdx: index("tp_department_code_idx").on(table.code),
  })
)
```

**步骤 4: 创建部门管理逻辑**

创建 `packages/opencode/src/user/department.ts`:

```typescript
import { eq, isNull } from "drizzle-orm"
import { db } from "../db"
import { tpDepartment } from "./department.sql"

export interface CreateDepartmentInput {
  name: string
  code: string
  type: "internal" | "hospital"
  parentId?: string
  hospitalId?: string
  sortOrder?: number
}

export interface DepartmentTree {
  id: string
  name: string
  code: string
  type: string
  parentId: string | null
  children?: DepartmentTree[]
}

export async function createDepartment(input: CreateDepartmentInput) {
  const [dept] = await db
    .insert(tpDepartment)
    .values({
      name: input.name,
      code: input.code,
      type: input.type,
      parentId: input.parentId,
      hospitalId: input.hospitalId,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning()

  return dept
}

export async function getDepartmentById(id: string) {
  const [dept] = await db.select().from(tpDepartment).where(eq(tpDepartment.id, id))
  return dept
}

export async function getDepartmentTree(): Promise<DepartmentTree[]> {
  const allDepts = await db.select().from(tpDepartment).orderBy(tpDepartment.sortOrder)

  const deptMap = new Map<string, DepartmentTree>()
  const roots: DepartmentTree[] = []

  // 构建映射
  for (const dept of allDepts) {
    deptMap.set(dept.id, {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      type: dept.type,
      parentId: dept.parentId,
      children: [],
    })
  }

  // 构建树
  for (const dept of deptMap.values()) {
    if (dept.parentId) {
      const parent = deptMap.get(dept.parentId)
      if (parent) {
        parent.children!.push(dept)
      }
    } else {
      roots.push(dept)
    }
  }

  return roots
}
```

**步骤 5: 生成并运行迁移**

```bash
bun run drizzle-kit generate
bun run drizzle-kit migrate
```

**步骤 6: 运行测试确认通过**

```bash
bun test src/user/department.test.ts
```

预期输出: `✓ All tests passed`

**步骤 7: 提交**

```bash
git add packages/opencode/src/user/department.*
git commit -m "feat(user): implement department hierarchy

- Create tp_department table with self-referencing parent
- Implement department CRUD operations
- Add tree structure retrieval
- Support internal and hospital department types

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 注意事项

由于完整的实施计划非常长（30 个任务），我将其分为多个部分。当前文档包含：

- ✅ 任务概览
- ✅ Task 1: PostgreSQL 迁移
- ✅ Task 2: 用户账号体系
- ✅ Task 3: 部门组织架构

**剩余任务将在后续文档中补充：**
- Task 4-5: 角色权限与 JWT 认证
- Task 6-10: 端到端工作流
- Task 11-16: 多智能体协作
- Task 17-20: 知识产权确权
- Task 21-25: 蒸馏数据采集
- Task 26-30: 前端改造

---

**文档状态：** 部分完成 (Task 1-3)
**下一步：** 继续编写 Task 4-30
**预计完成时间：** 需要额外 2-3 小时完成全部任务细节

