# TpCode 原型图功能执行计划

生成时间：2026-03-12

关联文档：
- `docs/TpCode-build-plan-原型图功能方案.md`
- `docs/TpCode-原型图功能详细开发任务拆解.md`
- `docs/TpCode-原型图功能数据库与API设计.md`

## 1. 执行目标

基于现有 `build / plan` 双模式和图片展示能力，在不引入审批链路的前提下，分阶段落地以下结果：

1. `build` 模式下可保存页面原型图
2. `plan` 模式下可只读查看原型图与历史版本
3. 原型图成为平台内正式资产，可关联 `session / message`
4. 原型图可记录页面路由、viewport、来源方式和测试结果
5. 后续如需扩展审批或其他业务流时，当前资产模型可直接复用

## 2. 执行原则

### 2.1 先闭环，再增强

先完成“保存 -> 查询 -> 查看”的最小闭环，再做自动截图、测试联动、归档策略等增强能力。

### 2.2 后端先行

先落数据库、存储、服务和 API，再接前端入口和查看界面，避免前端先做成临时状态拼接。

### 2.3 范围收敛

当前执行范围只覆盖：

- build 模式保存
- plan 模式查看
- session 内版本管理

不包含：

- 审批绑定
- 审批时间线
- 审批字段兼容改造

### 2.4 模式边界清晰

- `build` 模式允许创建、上传、截图
- `plan` 模式只允许查询、查看、引用

## 3. 总体排期

建议按 4 个阶段执行，整体节奏按 4 周设计。

### 阶段 P0：准备与基线确认

周期建议：

- 0.5 周

目标：

- 确认字段、路由、权限、验收口径
- 确认自动截图运行环境

输出物：

- 本执行计划评审通过
- 表结构字段冻结
- API 路由命名冻结
- Playwright 截图环境确认结论

### 阶段 P1：资产层与后端闭环

周期建议：

- 第 1 周

目标：

- 新增 `tp_prototype_asset`
- 提供最小 prototype API

输出物：

- migration
- prototype service
- prototype storage
- session / prototype 最小接口

### 阶段 P2：build 模式保存能力

周期建议：

- 第 2 周

目标：

- build 模式中可手动上传保存原型图
- build 模式中可自动截图保存原型图

输出物：

- 保存入口
- 保存弹窗
- 上传与截图联调完成

### 阶段 P3：plan 模式查看能力

周期建议：

- 第 3 周

目标：

- plan 模式中查看原型图和历史版本
- 将原型图作为计划讨论输入引用

输出物：

- `Prototype` Tab
- 原型图卡片和版本列表
- 计划上下文引用能力

### 阶段 P4：测试联动与上线收口

周期建议：

- 第 4 周

目标：

- 测试结果与 prototype 记录打通
- 完成回归、E2E、边界验证

输出物：

- 自动化测试补齐
- 上线检查单
- 风险关闭记录

## 4. 阶段任务与交付物

## 4.1 P0 准备与基线确认

### 任务 1：确认数据模型

依据文档：

- `docs/TpCode-原型图功能数据库与API设计.md`

需要确认：

- `tp_prototype_asset` 全字段
- `status` 枚举是否采用完整版本
- `session_id + page_key + version` 唯一约束是否首批落地

交付物：

- 字段冻结版清单

### 任务 2：确认接口范围

首批接口冻结为：

1. `POST /session/:sessionID/prototype/upload`
2. `POST /session/:sessionID/prototype/capture`
3. `GET /session/:sessionID/prototype`
4. `GET /prototype/:prototypeID`
5. `GET /prototype/:prototypeID/file`

交付物：

- 首批 API 清单
- 请求/响应示例定稿

### 任务 3：确认运行依赖

重点确认：

- `packages/opencode` 的 migration 流程
- Playwright 在当前本地开发环境是否可稳定执行截图
- 图片存储先走本地还是直接接 R2

交付物：

- 技术基线确认结果

## 4.2 P1 资产层与后端闭环

### 任务 4：新增 prototype 模块

目标文件：

- `packages/opencode/src/prototype/prototype.sql.ts`
- `packages/opencode/src/prototype/service.ts`
- `packages/opencode/src/prototype/storage.ts`
- `packages/opencode/src/prototype/schema.ts`
- `packages/opencode/src/prototype/index.ts`

交付物：

- prototype 模块骨架完成

### 任务 5：落数据库迁移

目标文件：

- 新增 prototype 表对应 schema 和 migration

交付物：

- `tp_prototype_asset`

验收点：

- 老数据升级不报错
- 新表索引和唯一约束生效

### 任务 6：实现 PrototypeService

最小方法集：

- `create`
- `upload`
- `capture`
- `listBySession`
- `getByID`
- `setLatest`
- `archiveOlder`
- `remove`

交付物：

- 版本递增逻辑
- latest 切换逻辑
- 归档与删除逻辑

### 任务 7：实现存储层

首批策略：

- 开发环境用本地文件系统
- 保留 R2 扩展点，不作为首批上线阻塞项

交付物：

- 原图存储
- 缩略图生成
- 文件读取接口支持

### 任务 8：提供最小 API

目标文件：

- `packages/opencode/src/server/routes/session.ts`
- 新增 `packages/opencode/src/server/routes/prototype.ts`

交付物：

- session prototype 接口
- prototype 详情与文件接口

### 任务 9：补充后端测试

建议测试文件：

- `packages/opencode/test/prototype/service.test.ts`
- `packages/opencode/test/server/prototype-routes.test.ts`

验收点：

- 版本递增
- latest 切换
- plan 模式禁止创建
- 文件读取成功

## 4.3 P2 build 模式保存能力

### 任务 10：新增 build 模式保存入口

目标文件：

- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`

目标：

- 仅在 `build` 模式且有 `code:generate` 权限时显示

交付物：

- 保存原型图按钮

### 任务 11：新增保存弹窗

建议新增：

- `packages/app/src/components/prototype/prototype-save-dialog.tsx`

表单支持：

- 标题
- 说明
- 路由
- `page_key`
- viewport
- 来源方式

交付物：

- 保存弹窗与校验逻辑

### 任务 12：接手动上传保存

目标：

- 支持 `png / jpg / jpeg / webp`
- 上传后自动创建 prototype 资产

交付物：

- 上传保存闭环

### 任务 13：接自动截图保存

目标：

- 输入 URL 和 viewport
- 后端 Playwright 截图
- 截图成功后直接落库

交付物：

- capture API 联调完成

### 任务 14：记录测试关联信息

目标：

- 保存时可记录 `test_run_id`
- 保存时可记录 `test_result`

交付物：

- 原型记录包含测试元数据

## 4.4 P3 plan 模式查看能力

### 任务 15：新增 Prototype Tab

目标文件：

- `packages/app/src/pages/session/session-side-panel.tsx`
- 新增 `packages/app/src/pages/session/prototype-tab.tsx`

展示内容：

- 最新原型图
- 历史版本
- 元数据

交付物：

- session side panel 中可查看 prototype

### 任务 16：复用图片预览能力

复用基础：

- `packages/ui/src/components/image-preview.tsx`
- `packages/ui/src/components/message-part.tsx`

建议新增：

- `packages/app/src/components/prototype/prototype-card.tsx`
- `packages/app/src/components/prototype/prototype-version-list.tsx`
- `packages/app/src/components/prototype/prototype-preview-dialog.tsx`

交付物：

- 缩略图、预览、版本切换

### 任务 17：实现 plan 模式只读约束

要求：

- 前端隐藏修改入口
- 后端拒绝 upload / capture / patch / delete

交付物：

- plan 模式只读行为生效

### 任务 18：实现原型图引用到计划上下文

目标文件：

- `packages/app/src/utils/prompt.ts`

目标：

- 在 plan 模式中选择 prototype
- 将标题、路由、版本、时间插入当前计划上下文

交付物：

- 计划上下文引用能力

## 4.5 P4 测试联动与上线收口

### 任务 19：测试成功后提示保存原型图

目标：

- build 模式测试通过后提示用户保存当前原型图

交付物：

- 测试后保存推荐入口

### 任务 20：补原型图事件记录

建议动作：

- `prototype_saved`
- `prototype_replaced`
- `prototype_archived`

交付物：

- 原型图变更事件可追踪

### 任务 21：完成前后端回归与 E2E

核心场景：

1. build 模式手动上传
2. build 模式自动截图
3. plan 模式查看最新版本
4. plan 模式切换历史版本
5. 无权限不可查看

交付物：

- 回归结果
- E2E 结果
- 上线检查单

## 5. 依赖关系

执行上必须遵循以下依赖顺序：

1. 先完成表结构和 migration
2. 再完成 service 与存储
3. 再开放 API
4. 再接 build 保存入口
5. 再接 plan 查看
6. 最后做测试联动和收口

不能倒置的原因：

- 没有资产表，前端无法稳定保存与回显
- 没有 API，前端无法稳定查询与展示
- 没有只读边界，plan 模式会混入编辑行为

## 6. 角色分工建议

### 后端

负责：

- schema
- migration
- storage
- service
- API
- 权限校验
- 事件记录

### 前端

负责：

- build 模式保存入口
- Prototype Tab
- 原型图预览与版本切换
- 计划上下文引用

### 测试

负责：

- service 测试
- route 测试
- 组件测试
- E2E

## 7. 验收计划

### 7.1 P1 验收

通过条件：

- `tp_prototype_asset` 建表完成
- 最小 API 可访问
- 版本和 latest 规则测试通过

### 7.2 P2 验收

通过条件：

- build 模式出现保存入口
- 支持上传保存
- 支持截图保存
- prototype 记录可查询

### 7.3 P3 验收

通过条件：

- plan 模式可查看原型图
- 可切换历史版本
- 可引用到计划上下文

### 7.4 P4 验收

通过条件：

- 测试联动入口可用
- 原型图事件可追踪
- 关键 E2E 场景通过
- 上线检查项完成

## 8. 风险与应对

### 风险 1：自动截图不稳定

原因：

- 页面依赖登录态
- 本地服务未启动
- 异步接口未稳定

应对：

- 首批先保证上传保存可用
- 自动截图失败时提供明确报错与重试

### 风险 2：文件膨胀

原因：

- 截图和缩略图会快速积累

应对：

- 首批先不做复杂清理，但保留 `archived` 状态
- 第二阶段增加版本保留策略

### 风险 3：模式边界被绕过

原因：

- 如果只在前端隐藏按钮，仍可手动调接口

应对：

- 服务端必须做模式校验和权限校验

## 9. 首批上线范围

建议把首批上线范围控制在以下闭环：

1. build 模式手动上传保存原型图
2. build 模式自动截图保存原型图
3. plan 模式查看 session 内原型图
4. plan 模式引用 prototype 到计划上下文

不进入首批范围：

- 审批绑定
- 审批时间线
- 图片 diff
- 在线标注
- 批量抓图
- 多设备模板管理
- 跨 session 对比

## 10. 推荐执行顺序

最终建议的实际推进顺序如下：

1. 先评审并冻结本执行计划
2. 先做 P1 后端闭环
3. 再做 P2 build 保存
4. 再做 P3 plan 查看
5. 最后做 P4 测试联动与收口

这条顺序的目标很明确：

- 第一周拿到可落库、可查询的资产
- 第二周拿到用户可操作的保存入口
- 第三周拿到用户可消费的查看与引用能力
- 第四周完成回归和上线准备
