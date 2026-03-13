# TpCode 原型图功能详细开发任务拆解

生成时间：2026-03-12

关联文档：
- `docs/TpCode-build-plan-原型图功能方案.md`
- `docs/TpCode-原型图功能数据库与API设计.md`

## 1. 文档目标

本文件用于把“build 模式保存原型图、plan 模式查看原型图”的方案拆成可执行开发任务，直接服务于：

- 研发排期
- 前后端分工
- 测试用例编写
- 分阶段上线和验收

本文默认采用 `MVP 先打通闭环，再做自动化增强` 的落地顺序。

## 2. 目标边界

本次需求只覆盖以下能力：

1. `build` 模式下，用户在修改页面并验证后，能保存当前页面原型图
2. `plan` 模式下，用户能只读查看会话内原型图和历史版本
3. 原型图能与 `session / message / change_request` 建立稳定关联
4. 审批页能优先展示平台内原型图，不再只依赖 `ai_prototype_url`

第一阶段明确不做：

- 原型图在线标注
- 视觉 diff
- 跨 session 合并原型图
- 批量页面发现与批量抓图
- OCR / 图像语义理解

## 3. 现有代码落点

下面这些文件已经提供了本次改造的主要复用基础：

### 3.1 模式与会话

- `packages/opencode/src/agent/agent.ts`
- `packages/opencode/src/tool/plan.ts`
- `packages/opencode/src/server/routes/session.ts`

现状结论：

- 已有 `build` / `plan` 双模式定义
- 已有模式切换链路
- 会话维度接口已存在，适合作为原型图列表入口

### 3.2 审批链路

- `packages/opencode/src/approval/change-request.sql.ts`
- `packages/opencode/src/approval/service.ts`
- `packages/opencode/src/approval/timeline.sql.ts`
- `packages/opencode/src/server/routes/approval.ts`

现状结论：

- 已存在 `ai_plan` 和 `ai_prototype_url`
- 已有审批单、时间线、确认流程
- 缺少“平台内 prototype 资产”的正式模型和接口

### 3.3 权限

- `packages/opencode/src/user/service.ts`

现状结论：

- 已存在 `prototype:view`
- 已存在 `prototype:approve`
- 已存在 `code:generate`

这意味着新功能应复用现有权限体系，而不是另起一套角色定义。

### 3.4 Web 展示层

- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/app/src/pages/session/review-tab.tsx`
- `packages/app/src/pages/approval-workflow.tsx`
- `packages/ui/src/components/message-part.tsx`
- `packages/ui/src/components/image-preview.tsx`

现状结论：

- 会话页已有 side panel，适合新增 `Prototype` 标签
- UI 层已具备图片预览能力
- 审批页已有 prototype URL 区域，适合演进为 prototype 资产展示

## 4. 推荐实施顺序

建议拆成 4 个里程碑：

- `M1`：数据模型与后端骨架
- `M2`：build 模式保存原型图
- `M3`：plan 模式查看原型图
- `M4`：审批集成与自动化增强

推荐顺序原因：

- 没有资产表和 API，前端先做会变成临时状态拼接
- 先支持“保存”和“查看”，再接入审批，链路最短
- 自动截图依赖环境和容器能力，必须后置

## 5. M1 数据模型与后端骨架

目标：先把“原型图是系统内正式资产”这件事打通。

### 5.1 任务 T1：新增 prototype 模块

新增目录建议：

- `packages/opencode/src/prototype/prototype.sql.ts`
- `packages/opencode/src/prototype/service.ts`
- `packages/opencode/src/prototype/storage.ts`
- `packages/opencode/src/prototype/schema.ts`
- `packages/opencode/src/prototype/index.ts`

工作内容：

1. 定义原型图表结构
2. 定义 API 输入输出 schema
3. 封装 service 层
4. 封装文件存储读写

验收标准：

- `prototype` 模块独立存在
- `route -> schema -> service -> storage` 分层清晰
- 不把所有逻辑继续堆进 `approval/service.ts`

### 5.2 任务 T2：新增原型图资产表

目标表：

- `tp_prototype_asset`

同时需要：

- Drizzle schema
- migration
- 索引

字段以数据库设计文档为准，首批必须包含：

- `id`
- `session_id`
- `message_id`
- `change_request_id`
- `user_id`
- `org_id`
- `department_id`
- `agent_mode`
- `title`
- `description`
- `route`
- `page_key`
- `viewport_width`
- `viewport_height`
- `device_scale_factor`
- `mime`
- `size_bytes`
- `storage_driver`
- `storage_key`
- `image_url`
- `thumbnail_url`
- `source_type`
- `source_url`
- `test_run_id`
- `test_result`
- `version`
- `is_latest`
- `status`
- 时间戳字段

验收标准：

- 本地数据库可成功迁移
- 新表字段、索引与设计文档一致
- `session_id + page_key + version` 唯一

### 5.3 任务 T3：扩展审批单表

改动文件：

- `packages/opencode/src/approval/change-request.sql.ts`

新增字段：

- `current_prototype_id`
- `prototype_version`

兼容要求：

- 保留 `ai_prototype_url`
- 老数据不回填也能正常展示
- 前端读取时优先用 `current_prototype_id`

验收标准：

- 老审批单不报错
- 新审批单可绑定 prototype 资产

### 5.4 任务 T4：实现 PrototypeService

改动文件：

- `packages/opencode/src/prototype/service.ts`

最小方法集建议：

- `create`
- `upload`
- `capture`
- `listBySession`
- `getByID`
- `setLatest`
- `bindToChangeRequest`
- `archive`
- `remove`

关键规则：

1. 同一 `session_id + page_key` 下版本号递增
2. 新版本创建后，旧版本自动取消 `is_latest`
3. 删除 latest 时，要自动切换前一个有效版本
4. `plan` 模式只允许查询，不允许创建

验收标准：

- 版本递增正确
- latest 切换正确
- 绑定审批单正确

### 5.5 任务 T5：实现文件存储抽象

改动文件：

- `packages/opencode/src/prototype/storage.ts`

首批支持：

- 本地文件系统
- R2 预留接口

方法建议：

- `put`
- `read`
- `signedUrl`
- `remove`
- `thumb`

本地开发路径建议：

- `.opencode/prototypes/<session_id>/<page_key>/v<version>.png`
- `.opencode/prototypes/<session_id>/<page_key>/v<version>.thumb.webp`

验收标准：

- 本地保存图片可成功
- API 能稳定读取原图和缩略图

### 5.6 任务 T6：新增后端路由

新增或扩展：

- `packages/opencode/src/server/routes/session.ts`
- `packages/opencode/src/server/routes/approval.ts`
- 新增 `packages/opencode/src/server/routes/prototype.ts`

最小接口集：

- `POST /session/:sessionID/prototype/upload`
- `POST /session/:sessionID/prototype/capture`
- `GET /session/:sessionID/prototype`
- `GET /prototype/:prototypeID`
- `GET /prototype/:prototypeID/file`
- `POST /approval/change-request/:change_request_id/prototype/:prototype_id/bind`

验收标准：

- 接口按 session / prototype / approval 三个领域拆分
- 鉴权和模式判断都落在服务端

### 5.7 任务 T7：补审计和时间线

改动文件：

- `packages/opencode/src/approval/timeline.sql.ts`
- 相关 timeline service

建议新增 timeline action：

- `prototype_saved`
- `prototype_bound`
- `prototype_replaced`
- `prototype_archived`

验收标准：

- 保存、绑定、切换版本都能进入时间线

## 6. M2 build 模式保存原型图

目标：让用户在 build 阶段显式保存“修改后的页面效果”。

### 6.1 任务 T8：build 模式入口控制

改动文件：

- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`

工作内容：

1. 只在 `build` 模式展示“保存原型图”入口
2. `plan` 模式不显示保存按钮
3. 无 `code:generate` 权限时不展示入口

验收标准：

- build 可见，plan 不可见
- 无权限用户不可见

### 6.2 任务 T9：新增保存弹窗

建议新增组件：

- `packages/app/src/components/prototype/prototype-save-dialog.tsx`

表单字段建议：

- `title`
- `description`
- `route`
- `page_key`
- `change_request_id`
- `source_type`
- `viewport_width`
- `viewport_height`
- `device_scale_factor`

若 `source_type = manual_upload`，额外要求：

- 上传图片文件

若 `source_type = playwright_capture`，额外要求：

- 输入截图 URL

验收标准：

- 必填字段有校验
- 不同来源类型切换时表单行为正确

### 6.3 任务 T10：手动上传保存

前端：

- 弹窗内支持拖拽上传 / 文件选择

后端：

- `POST /session/:sessionID/prototype/upload`

约束：

- 支持 `png/jpg/jpeg/webp`
- 限制最大文件体积
- 非图片文件拒绝

验收标准：

- 上传后自动生成 prototype 记录
- 列表和详情接口能查询到

### 6.4 任务 T11：自动截图保存

建议新增：

- `POST /session/:sessionID/prototype/capture`

实现建议：

1. 后端用 Playwright 打开目标 URL
2. 设置 viewport
3. 等待页面稳定
4. 执行截图
5. 写入存储并落库

等待页面稳定建议：

- 支持固定等待时间
- 支持 selector ready
- 支持 network idle 兜底

验收标准：

- 对 `http://localhost:5173` 或类似本地地址可截图
- 截图失败返回明确错误码

### 6.5 任务 T12：build 阶段与测试结果关联

目的：满足“修改完程序测试后，将修改后的页面原型图保存起来”。

首批方案：

1. 先允许保存时填写 `test_run_id`
2. 保存记录里保留 `test_result`
3. 后续再接自动测试产物回填

第二阶段增强：

- 测试通过后弹出“保存原型图”推荐入口
- 保存时默认带上最近一次测试结果

验收标准：

- 原型记录里可看到测试关联信息
- 即使暂未接自动链路，也不阻塞 MVP

### 6.6 任务 T13：TUI 命令补齐

目标文件：

- TUI session route 相关命令处理文件

建议命令：

- `/prototype save`
- `/prototype list`

第一阶段限制：

- TUI 只做元数据操作，不做图片渲染

验收标准：

- TUI 可发起保存
- TUI 可列出当前 session 下原型图

## 7. M3 plan 模式查看原型图

目标：让 plan 模式能直接把原型图作为讨论和规划输入。

### 7.1 任务 T14：新增 Prototype Tab

改动文件：

- `packages/app/src/pages/session/session-side-panel.tsx`
- 新增 `packages/app/src/pages/session/prototype-tab.tsx`

展示内容：

- 最新原型图
- 历史版本列表
- 元数据
- 关联审批单
- 来源方式

验收标准：

- Side panel 出现 `Prototype` 标签
- 可以加载当前 session 的 prototype 列表

### 7.2 任务 T15：复用图片预览组件

复用基础：

- `packages/ui/src/components/image-preview.tsx`
- `packages/ui/src/components/message-part.tsx`

建议新增组件：

- `packages/app/src/components/prototype/prototype-card.tsx`
- `packages/app/src/components/prototype/prototype-version-list.tsx`
- `packages/app/src/components/prototype/prototype-preview-dialog.tsx`

验收标准：

- 支持缩略图列表
- 支持点击大图预览
- 支持版本切换

### 7.3 任务 T16：plan 模式只读约束

前端要求：

- 隐藏保存、删除、上传入口

后端要求：

- 对 create / upload / capture / bind 操作做模式校验

验收标准：

- 只在 plan 模式下允许 list/get/file
- 即使前端绕过，也会被后端拒绝

### 7.4 任务 T17：原型图插入计划上下文

复用方向：

- `packages/app/src/utils/prompt.ts`

目标行为：

1. 在 plan 模式选中一个 prototype
2. 将其标题、路由、版本、查看链接插入当前计划上下文

建议插入片段：

```md
参考原型：
- 标题：门诊排队页-v3
- 路由：/queue/outpatient
- 版本：v3
- 创建时间：2026-03-12 21:30
```

验收标准：

- 计划模式中可把 prototype 作为讨论依据引用

## 8. M4 审批集成与自动化增强

目标：让原型图与变更审批真正打通。

### 8.1 任务 T18：审批页展示平台内原型图

改动文件：

- `packages/app/src/pages/approval-workflow.tsx`

需要实现：

1. 显示当前绑定的 prototype 卡片
2. 支持切换绑定版本
3. 若没有内部资产，则回退显示 `ai_prototype_url`

验收标准：

- 审批页优先显示系统内 prototype
- 保持旧 URL 兼容

### 8.2 任务 T19：审批接口支持 prototype_id

改动文件：

- `packages/opencode/src/approval/service.ts`
- `packages/opencode/src/server/routes/approval.ts`

工作内容：

- create / update change request 支持 `prototype_id`
- get detail 返回 `prototype` 对象摘要
- bind 接口写入 `current_prototype_id` 和 `prototype_version`

验收标准：

- 审批单创建、更新、查看、绑定闭环完整

### 8.3 任务 T20：审批确认前的原型检查

建议规则：

- 如果审批模板要求原型图，则确认前必须满足以下之一：
  - 已绑定内部 prototype
  - 存在外链 `ai_prototype_url`

更推荐规则：

- 新建流程默认要求内部 prototype
- 外链仅作为兼容兜底

验收标准：

- 不满足要求时，服务端阻止确认

### 8.4 任务 T21：测试通过后提示保存原型图

第一阶段只做轻量集成：

1. 识别最近一次测试结果
2. 在 build 模式展示“保存测试后的页面原型图”按钮

第二阶段再补：

- 自动读取 Playwright 截图产物
- 自动回填 `test_run_id`

验收标准：

- 测试成功后，用户能明确触发保存原型图

## 9. 测试任务拆分

### 9.1 后端单测

建议新增测试文件：

- `packages/opencode/test/prototype/service.test.ts`
- `packages/opencode/test/server/prototype-routes.test.ts`

至少覆盖：

1. 创建 prototype 成功
2. 同页版本递增
3. latest 切换
4. 删除 latest 后回退
5. 绑定审批单
6. plan 模式禁止创建
7. 权限不足时拒绝访问

### 9.2 审批链路回归

重点补或扩展：

- `packages/opencode/test/server/approval-flow.test.ts`

至少覆盖：

1. 旧 `ai_prototype_url` 仍能返回
2. 新 `prototype_id` 绑定成功
3. detail 接口返回 prototype 摘要

### 9.3 前端测试

建议新增：

- `PrototypeTab` 组件测试
- `PrototypeSaveDialog` 表单测试
- `ApprovalWorkflow` 原型图区域测试

至少覆盖：

1. build/plan 模式下入口显示差异
2. 版本切换
3. 空态展示
4. 旧 URL 回退展示

### 9.4 E2E

建议放在 `packages/app` 侧，优先用现有 Playwright 体系。

核心场景：

1. build 模式手动上传原型图
2. build 模式自动截图保存原型图
3. plan 模式查看最新版本
4. plan 模式切换历史版本
5. 审批页绑定并展示 prototype
6. 无权限用户无法查看

## 10. 推荐开发顺序

建议按下面顺序执行，减少返工：

1. 先落数据库和 migration
2. 再写 `PrototypeService`
3. 再补 session / prototype / approval 路由
4. 再接会话页 build 保存入口
5. 再做 plan 模式查看
6. 最后接审批页和自动截图增强

原因：

- 这是最符合依赖顺序的链路
- 可以最快跑通一个“上传保存 -> 查看 -> 绑定审批”的 MVP

## 11. 角色分工建议

### 后端

- 表结构
- migration
- 存储抽象
- service
- API
- 审计与时间线

### 前端

- 保存弹窗
- Prototype Tab
- 审批页展示
- 版本列表与图片预览

### 测试

- service 单测
- route 集成测试
- Web 组件测试
- E2E

## 12. 周排期建议

### 第 1 周

- 新增表与 migration
- PrototypeService 骨架
- 原型图查询接口
- Prototype Tab 骨架

### 第 2 周

- 手动上传保存
- build 模式入口与弹窗
- 原型图列表与详情展示

### 第 3 周

- 自动截图保存
- 审批页 prototype 展示与绑定
- 时间线动作

### 第 4 周

- 测试结果关联
- E2E
- 权限与边界回归

## 13. MVP 验收口径

满足以下条件即可判定第一阶段完成：

1. build 模式有“保存原型图”入口
2. 支持手动上传保存
3. 支持自动截图保存
4. 原型图可落库并生成版本号
5. plan 模式可查看最新和历史版本
6. 审批页可展示并绑定 prototype
7. `prototype:view` 和 `code:generate` 权限生效
8. 老字段 `ai_prototype_url` 仍可回退展示

## 14. 风险与依赖

### 风险 1：自动截图稳定性

原因：

- 本地开发服务可能未启动
- 页面可能依赖登录态、环境变量、异步接口

对策：

- MVP 先保证手动上传可用
- 自动截图失败时给出明确错误和重试入口

### 风险 2：审批链路兼容性

原因：

- 旧流程依赖 `ai_prototype_url`

对策：

- 第一阶段保留双轨兼容
- 新 UI 优先读内部 prototype，读不到再回退 URL

### 风险 3：历史版本无限增长

原因：

- 截图文件和缩略图都会占用存储

对策：

- 第二阶段增加归档策略
- 每个 `session + page_key` 可限制保留最近 N 个 active 版本

## 15. 不建议第一阶段做的事项

- 原型图评论流
- 图片 diff
- 批量抓图任务调度
- 多终端设备模板中心
- 跨审批单复用和对比视图

原因很简单：

- 这些都建立在“prototype 已经是系统内资产”之上
- 先把资产闭环打通，后续功能才不会反复返工
