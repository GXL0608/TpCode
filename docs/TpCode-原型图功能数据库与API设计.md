# TpCode 原型图功能数据库与 API 设计

生成时间：2026-03-12

关联文档：
- `docs/TpCode-build-plan-原型图功能方案.md`
- `docs/TpCode-原型图功能详细开发任务拆解.md`

## 1. 设计目标

本设计用于支持以下能力：

1. `build` 模式下保存修改后的页面原型图
2. `plan` 模式下只读查看当前会话中的原型图
3. 原型图与 `session / message / change_request` 建立正式关联
4. 审批流优先使用平台内原型图资产
5. 兼容已有 `ai_prototype_url` 字段，不破坏旧链路

## 2. 当前约束

当前可复用的现状如下：

- `packages/opencode/src/approval/change-request.sql.ts` 已有 `ai_prototype_url`
- `packages/opencode/src/approval/service.ts` 已有审批创建、更新、确认链路
- `packages/opencode/src/server/routes/approval.ts` 已有审批路由
- `packages/opencode/src/user/service.ts` 已有 `prototype:view` 与 `prototype:approve`
- `packages/ui/src/components/image-preview.tsx` 已有图片预览基础能力

当前不足也很明确：

- 只有 URL，没有系统内资产 ID
- 没有版本概念
- 没有路由、viewport、来源方式、测试结果等元数据
- 没有“最新版本”与“历史版本”规则
- 无法稳定支撑 plan 模式查看和审批内绑定

因此必须新增独立的 prototype 资产模型，而不是继续扩展单个 URL 字段。

## 3. 设计原则

### 3.1 资产化

每一张原型图都必须是一条独立资产记录，而不是审批单上的一个字符串字段。

### 3.2 版本化

同一 `session + page_key` 下允许存在多个版本，且始终有一个 `latest`。

### 3.3 只读边界清晰

- `build` 模式允许创建、上传、截图、绑定
- `plan` 模式允许查看、引用，不允许修改资产

### 3.4 兼容优先

旧的 `ai_prototype_url` 必须继续可用，直到所有旧页面与旧审批单都完成切换。

## 4. 数据模型总览

建议改动如下：

### 新增

- `tp_prototype_asset`

### 修改

- `tp_change_request`

### 可选扩展

- `tp_timeline`

## 5. 新增表：`tp_prototype_asset`

### 5.1 表职责

`tp_prototype_asset` 是原型图资产主表，用来记录：

- 原型图属于哪个 session
- 对应哪个 message
- 是否绑定某个变更单
- 来自上传还是自动截图
- 当前是哪一版
- 文件实际存储在哪里

### 5.2 建议字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `text` | 主键 |
| `session_id` | `text` | 关联会话 |
| `message_id` | `text` | 关联消息，可空 |
| `change_request_id` | `text` | 关联审批单，可空 |
| `user_id` | `text` | 创建人 |
| `org_id` | `text` | 所属组织 |
| `department_id` | `text` | 所属部门，可空 |
| `agent_mode` | `text` | `build` / `plan`，第一阶段应主要为 `build` |
| `title` | `text` | 原型标题 |
| `description` | `text` | 说明，可空 |
| `route` | `text` | 页面路由，可空但建议填写 |
| `page_key` | `text` | 页面稳定标识，用于版本归组 |
| `viewport_width` | `integer` | 截图宽度 |
| `viewport_height` | `integer` | 截图高度 |
| `device_scale_factor` | `integer` 或 `real` | 设备缩放倍率 |
| `mime` | `text` | 图片 MIME |
| `size_bytes` | `integer` | 文件大小 |
| `storage_driver` | `text` | `local` / `r2` |
| `storage_key` | `text` | 实际对象路径 |
| `image_url` | `text` | 原图访问地址，可空 |
| `thumbnail_url` | `text` | 缩略图访问地址，可空 |
| `source_type` | `text` | `manual_upload` / `playwright_capture` / `external_url` |
| `source_url` | `text` | 截图地址或来源外链，可空 |
| `test_run_id` | `text` | 关联测试记录，可空 |
| `test_result` | `text` | `passed` / `failed` / `unknown` |
| `version` | `integer` | 同一页面下的版本号 |
| `is_latest` | `integer` 或 `boolean` | 是否当前最新版本 |
| `status` | `text` | `draft` / `ready` / `archived` / `failed` / `deleted` |
| `time_created` | `integer` | 创建时间 |
| `time_updated` | `integer` | 更新时间 |

### 5.3 字段说明补充

#### `page_key`

这是版本管理的核心字段，要求稳定且可重复计算。

推荐来源：

- 手工填写的业务页面 key
- 路由标准化后的 key
- 页面组件约定的唯一 key

不建议直接用完整 URL 作为 `page_key`，因为 query 参数会让版本归组失稳。

#### `status`

建议状态定义：

- `draft`：记录已创建，但文件还未完整落盘
- `ready`：可展示、可绑定、可引用
- `archived`：历史版本保留
- `failed`：截图或上传失败后的保留记录
- `deleted`：逻辑删除

第一阶段允许简化为 `ready / archived / deleted`，但设计上建议保留完整状态。

## 6. Drizzle schema 建议

字段风格应遵循仓库约定，使用 `snake_case`。

示意结构：

```ts
export const tp_prototype_asset = sqliteTable("tp_prototype_asset", {
  id: text().primaryKey(),
  session_id: text().notNull(),
  message_id: text(),
  change_request_id: text(),
  user_id: text().notNull(),
  org_id: text().notNull(),
  department_id: text(),
  agent_mode: text().notNull(),
  title: text().notNull(),
  description: text(),
  route: text(),
  page_key: text().notNull(),
  viewport_width: integer(),
  viewport_height: integer(),
  device_scale_factor: integer(),
  mime: text().notNull(),
  size_bytes: integer().notNull(),
  storage_driver: text().notNull(),
  storage_key: text().notNull(),
  image_url: text(),
  thumbnail_url: text(),
  source_type: text().notNull(),
  source_url: text(),
  test_run_id: text(),
  test_result: text(),
  version: integer().notNull(),
  is_latest: integer().notNull().default(1),
  status: text().notNull().default("ready"),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})
```

注意点：

- 不要在 schema 中使用 camelCase 字段名
- `is_latest` 是否用布尔取决于当前数据库方言，和现有表风格保持一致即可

## 7. 索引与约束

### 7.1 必要索引

建议新增：

- `tp_prototype_asset_session_idx` on `session_id`
- `tp_prototype_asset_change_request_idx` on `change_request_id`
- `tp_prototype_asset_user_idx` on `user_id`
- `tp_prototype_asset_org_idx` on `org_id`
- `tp_prototype_asset_page_idx` on `(session_id, page_key)`
- `tp_prototype_asset_latest_idx` on `(session_id, page_key, is_latest)`
- `tp_prototype_asset_status_idx` on `status`
- `tp_prototype_asset_created_idx` on `time_created`

### 7.2 唯一约束

建议唯一索引：

- `(session_id, page_key, version)`

原因：

- 保证版本号不会冲突
- 比直接拿文件名去判重更稳定

### 7.3 latest 维护策略

不建议依赖复杂数据库唯一条件索引去保证“每组只有一个 latest”，建议由 service 在事务内维护：

1. 先把当前 `session_id + page_key` 组内其他记录设为 `is_latest = false`
2. 再把新版本设为 `is_latest = true`

## 8. 修改表：`tp_change_request`

### 8.1 建议新增字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `current_prototype_id` | `text` | 当前绑定的 prototype 资产 ID |
| `prototype_version` | `integer` | 审批单当前采用的版本号 |

### 8.2 保留字段

继续保留：

- `ai_prototype_url`

### 8.3 兼容策略

前端读取顺序：

1. `current_prototype_id`
2. `ai_prototype_url`

后端写入策略：

- 新流程绑定内部 prototype 时，写入 `current_prototype_id`
- `ai_prototype_url` 可以保留原值，也可以回填为平台文件地址作为兼容兜底

## 9. 可选扩展：`tp_timeline`

当前 `tp_timeline` 已有 `attachment_url`，但它不适合作为 prototype 主存储。

建议可选新增：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `prototype_id` | `text` | 关联的 prototype 资产 |

推荐新增 action：

- `prototype_saved`
- `prototype_bound`
- `prototype_replaced`
- `prototype_archived`

这样可以让审批时间线展示出原型图演进过程，但不把 `tp_timeline` 变成 source of truth。

## 10. 状态与枚举设计

### 10.1 `source_type`

允许值：

- `manual_upload`
- `playwright_capture`
- `external_url`

说明：

- `manual_upload`：用户上传截图
- `playwright_capture`：平台自动访问 URL 截图
- `external_url`：仅保存外链，不托管文件

### 10.2 `agent_mode`

允许值：

- `build`
- `plan`

第一阶段建议只允许 `build` 创建 prototype，`plan` 只读取。

### 10.3 `test_result`

允许值：

- `passed`
- `failed`
- `unknown`

## 11. 版本规则

### 11.1 版本号生成

版本按下面维度递增：

- `session_id + page_key`

例如：

- 当前最新是 `v3`
- 再创建新原型时生成 `v4`

### 11.2 latest 规则

每个 `session_id + page_key` 分组内，始终只能有一个 `latest`。

创建新版本后：

- 新版本 `is_latest = true`
- 其他 `ready/archived` 记录 `is_latest = false`

### 11.3 删除规则

如果删除的是 latest：

1. 找到同组最近一个 `ready` 或 `archived` 版本
2. 将其提升为 `latest`

### 11.4 审批绑定规则

审批单的 `prototype_version` 记录的是“绑定时采用的版本”，不是永远动态追踪最新版本。

这样做的原因：

- 防止历史审批内容因为后续新增截图而被动变更

## 12. 存储策略

### 12.1 本地开发

建议路径：

- `.opencode/prototypes/<session_id>/<page_key>/v<version>.png`
- `.opencode/prototypes/<session_id>/<page_key>/v<version>.thumb.webp`

### 12.2 对象存储

若接 R2，建议 key：

- `prototype/<org_id>/<session_id>/<page_key>/v<version>.png`
- `prototype/<org_id>/<session_id>/<page_key>/v<version>.thumb.webp`

### 12.3 URL 策略

建议主存储字段是：

- `storage_driver`
- `storage_key`

`image_url` / `thumbnail_url` 作为缓存或公开访问地址：

- 若对象公开可读，则可直接返回 URL
- 若对象私有，则由 `GET /prototype/:prototypeID/file` 输出内容

## 13. API 设计原则

路由按领域拆分，不把所有 prototype 逻辑都塞进审批模块。

### session 域

负责当前会话里的 prototype 列表、上传、截图

### prototype 域

负责 prototype 详情、文件读取、元数据更新

### approval 域

负责审批单和 prototype 的绑定关系

## 14. Session 域 API

### 14.1 上传并创建 prototype

`POST /session/:sessionID/prototype/upload`

用途：

- 用户手动上传一张页面效果图并创建 prototype 资产

请求方式：

- `multipart/form-data`

字段建议：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `file` | 是 | 图片文件 |
| `title` | 是 | 原型标题 |
| `description` | 否 | 原型说明 |
| `route` | 否 | 页面路由 |
| `page_key` | 是 | 页面稳定标识 |
| `change_request_id` | 否 | 关联变更单 |
| `message_id` | 否 | 关联消息 |
| `agent_mode` | 是 | 仅允许 `build` |
| `viewport_width` | 否 | 宽度 |
| `viewport_height` | 否 | 高度 |
| `device_scale_factor` | 否 | 缩放倍率 |
| `test_run_id` | 否 | 最近测试记录 |
| `test_result` | 否 | 测试结果 |

成功返回示例：

```json
{
  "ok": true,
  "prototype": {
    "id": "proto_01",
    "session_id": "session_01",
    "page_key": "queue-outpatient",
    "version": 2,
    "is_latest": true,
    "status": "ready"
  }
}
```

### 14.2 自动截图并创建 prototype

`POST /session/:sessionID/prototype/capture`

用途：

- 后端访问给定 URL 截图并直接保存为 prototype

请求体示例：

```json
{
  "message_id": "msg_01",
  "change_request_id": "cr_01",
  "title": "门诊排队页-v2",
  "description": "测试通过后的自动截图",
  "route": "/queue/outpatient",
  "page_key": "queue-outpatient",
  "agent_mode": "build",
  "source_url": "http://localhost:5173/queue/outpatient",
  "wait_until": "networkidle",
  "ready_selector": "[data-page-ready='1']",
  "viewport": {
    "width": 1440,
    "height": 900,
    "device_scale_factor": 1
  },
  "test_run_id": "test_01",
  "test_result": "passed"
}
```

成功返回：

```json
{
  "ok": true,
  "prototype": {
    "id": "proto_02",
    "page_key": "queue-outpatient",
    "version": 3,
    "source_type": "playwright_capture"
  }
}
```

### 14.3 查询当前 session 的 prototype 列表

`GET /session/:sessionID/prototype`

查询参数建议：

- `page_key`
- `change_request_id`
- `latest`
- `status`
- `limit`
- `cursor`

成功返回示例：

```json
{
  "items": [
    {
      "id": "proto_02",
      "title": "门诊排队页-v3",
      "page_key": "queue-outpatient",
      "version": 3,
      "is_latest": true,
      "status": "ready",
      "thumbnail_url": "/prototype/proto_02/file?variant=thumbnail"
    }
  ],
  "next_cursor": null
}
```

### 14.4 查询某个页面最新 prototype

`GET /session/:sessionID/prototype/latest?page_key=queue-outpatient`

用途：

- plan 模式快速加载某页面最新原型图

可选返回：

- 也可以不单独开接口，直接通过列表接口加 `latest=true&page_key=...` 实现

## 15. Prototype 域 API

### 15.1 查询详情

`GET /prototype/:prototypeID`

返回内容应包含：

- 基础元数据
- 版本信息
- 关联 session / message / change_request
- 文件访问地址或文件接口地址

示例：

```json
{
  "ok": true,
  "prototype": {
    "id": "proto_02",
    "title": "门诊排队页-v3",
    "description": "优化状态区块层级",
    "session_id": "session_01",
    "change_request_id": "cr_01",
    "page_key": "queue-outpatient",
    "route": "/queue/outpatient",
    "version": 3,
    "is_latest": true,
    "image_url": "/prototype/proto_02/file?variant=original",
    "thumbnail_url": "/prototype/proto_02/file?variant=thumbnail"
  }
}
```

### 15.2 获取文件

`GET /prototype/:prototypeID/file`

查询参数：

- `variant=original|thumbnail`

行为要求：

- 私有存储时返回二进制流
- 可公开访问时，也可以 302 跳转到对象地址

### 15.3 更新元数据

`PATCH /prototype/:prototypeID`

允许更新：

- `title`
- `description`
- `route`
- `change_request_id`

不允许更新：

- `version`
- `storage_key`
- `user_id`
- `org_id`
- `source_type`

请求体示例：

```json
{
  "title": "门诊排队页-v3-确认版",
  "description": "审批前补充说明"
}
```

### 15.4 归档或删除

建议先做逻辑删除或归档，不直接物理删除。

可选接口：

- `POST /prototype/:prototypeID/archive`
- 或 `DELETE /prototype/:prototypeID`

行为要求：

- 删除 latest 时自动回退上一版为 latest

## 16. Approval 域 API

### 16.1 审批创建/更新扩展

当前审批创建、更新接口建议新增字段：

- `prototype_id`

请求体示例：

```json
{
  "session_id": "session_01",
  "title": "优化门诊排队页",
  "description": "提升状态可视性",
  "ai_plan": "先灰度验证再全量",
  "ai_prototype_url": "https://example.com/fallback",
  "prototype_id": "proto_02"
}
```

行为规则：

- 若传 `prototype_id`，后端校验该 prototype 是否属于当前 session 或可被当前用户访问
- 绑定成功后写入：
  - `current_prototype_id`
  - `prototype_version`

### 16.2 绑定已有 prototype

`POST /approval/change-request/:change_request_id/prototype/:prototype_id/bind`

用途：

- 先创建审批单，再从已有 prototype 列表中选择绑定

成功返回：

```json
{
  "ok": true,
  "change_request_id": "cr_01",
  "prototype_id": "proto_02",
  "prototype_version": 3
}
```

### 16.3 审批详情扩展

`GET /approval/change-request/:change_request_id`

建议返回结构中补充：

```json
{
  "ok": true,
  "change_request": {
    "id": "cr_01",
    "current_prototype_id": "proto_02",
    "prototype_version": 3,
    "ai_prototype_url": "https://example.com/fallback"
  },
  "prototype": {
    "id": "proto_02",
    "title": "门诊排队页-v3",
    "thumbnail_url": "/prototype/proto_02/file?variant=thumbnail"
  }
}
```

### 16.4 审批确认前检查

若审批模板要求必须带原型图，确认接口应校验：

- 存在 `current_prototype_id`
- 或存在兼容字段 `ai_prototype_url`

更推荐的新规则：

- 未来默认必须存在内部 prototype

## 17. 权限设计

### 17.1 查看权限

需要：

- `prototype:view`

适用接口：

- `GET /session/:sessionID/prototype`
- `GET /prototype/:prototypeID`
- `GET /prototype/:prototypeID/file`

### 17.2 创建权限

需要：

- `code:generate`

附加约束：

- 当前会话模式必须是 `build`

适用接口：

- upload
- capture
- patch
- delete/archive

### 17.3 绑定审批权限

建议满足以下之一：

- 审批单创建者
- 有审批维护权限的管理员
- 具备 `prototype:approve`

### 17.4 plan 模式限制

在 `plan` 模式中：

- 允许 list/get/file
- 禁止 upload/capture/patch/delete/bind

## 18. 错误码建议

建议新增以下错误码：

- `prototype_missing`
- `prototype_forbidden`
- `prototype_invalid_mode`
- `prototype_invalid_source`
- `prototype_page_key_required`
- `prototype_capture_failed`
- `prototype_upload_failed`
- `prototype_file_missing`
- `prototype_change_request_missing`
- `prototype_change_request_mismatch`
- `prototype_bind_forbidden`

错误返回结构建议统一：

```json
{
  "error": "prototype_invalid_mode",
  "message": "prototype can only be created in build mode"
}
```

## 19. Service 设计建议

建议在 `packages/opencode/src/prototype/service.ts` 中提供以下方法：

- `create`
- `upload`
- `capture`
- `listBySession`
- `getByID`
- `setLatest`
- `bindToChangeRequest`
- `archiveOlder`
- `remove`

### 19.1 `create`

场景：

- 外部截图或存储写入已完成，只需要落 metadata

### 19.2 `upload`

场景：

- 接受 multipart 文件
- 生成缩略图
- 写存储
- 创建 prototype 记录

### 19.3 `capture`

场景：

- 使用 Playwright 访问 URL 并截图
- 截图成功后和 `upload/create` 共用相同入库流程

## 20. 审计与时间线

建议记录以下事件：

- `prototype.create`
- `prototype.upload`
- `prototype.capture`
- `prototype.bind`
- `prototype.archive`
- `prototype.delete`

审计 detail 最少包含：

- `prototype_id`
- `session_id`
- `change_request_id`
- `page_key`
- `version`
- `source_type`

## 21. 迁移策略

### 第一步：新增表

- 新增 `tp_prototype_asset`

### 第二步：扩展审批表

- 给 `tp_change_request` 增加 `current_prototype_id`
- 给 `tp_change_request` 增加 `prototype_version`

### 第三步：代码双读

前端和后端都按下面逻辑处理：

1. 优先走 `current_prototype_id`
2. 若为空，回退 `ai_prototype_url`

### 第四步：视需要回填

如果未来要把旧 URL 迁移成内部资产，可额外做离线回填脚本，但这不应阻塞 MVP。

## 22. 测试建议

### 22.1 数据层

至少覆盖：

- 同一页面版本递增
- latest 切换
- 删除 latest 后回退
- 绑定审批单

### 22.2 路由层

至少覆盖：

- build 模式可创建
- plan 模式不可创建
- 无 `prototype:view` 不可读取
- `ai_prototype_url` 兼容返回

### 22.3 E2E

至少覆盖：

1. 上传原型图成功
2. 自动截图成功
3. plan 模式查看最新版本
4. 审批页显示内部 prototype

## 23. 第一阶段最小 API 集

如果只做 MVP，建议先交付这 6 个：

1. `POST /session/:sessionID/prototype/upload`
2. `POST /session/:sessionID/prototype/capture`
3. `GET /session/:sessionID/prototype`
4. `GET /prototype/:prototypeID`
5. `GET /prototype/:prototypeID/file`
6. `POST /approval/change-request/:change_request_id/prototype/:prototype_id/bind`

这 6 个接口已经足够支撑：

- build 保存
- plan 查看
- approval 绑定

## 24. 暂不建议纳入第一阶段的 API

- `POST /prototype/compare`
- `POST /prototype/annotate`
- `POST /prototype/batch-capture`
- 跨 session prototype 合并接口

原因：

- 这些都不是“资产闭环”所必需
- 现在做会显著增加存储、权限、前端复杂度
