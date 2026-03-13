# TpCode build/plan 模式原型图功能方案

生成时间：2026-03-12

## 1. 目标

实现一套围绕 `build` 与 `plan` 模式的原型图闭环能力：

- 在 `build` 开发模式下，开发者完成页面修改并验证后，可以把“修改后的页面原型图”保存下来
- 在 `plan` 计划模式下，用户可以只读查看这些原型图，用于方案讨论、复盘、继续规划和审批

该方案的重点不是“额外做一个图片管理系统”，而是把“原型图”变成会话、变更单、审批流中的一等资产。

## 2. 现状识别

从当前仓库代码看，相关基础已经具备，主要有四块：

### 2.1 已有 build / plan 模式

`packages/opencode/src/agent/agent.ts`

- 已内置 `build` 主模式
- 已内置 `plan` 主模式
- `build` 允许问题确认、允许进入 plan
- `plan` 禁止 edit 类工具，只允许读和计划文件写入

这意味着模式边界已经存在，不需要重新发明模式系统。

### 2.2 已有模式切换链路

`packages/opencode/src/tool/plan.ts`
`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

- 已支持 `build -> plan`
- 已支持 `plan -> build`
- TUI 已监听 `plan_enter` / `plan_exit`

说明“模式切换”本身已经打通，可以在此基础上补“模式专属原型能力”。

### 2.3 已有原型审批字段

`packages/opencode/src/approval/change-request.sql.ts`
`packages/opencode/src/server/routes/approval.ts`
`packages/opencode/src/approval/service.ts`
`packages/app/src/pages/approval-workflow.tsx`

当前审批链路已经有：

- `ai_plan`
- `ai_prototype_url`
- `prototype:view`
- `prototype:approve`

但现在只是“保存一个原型 URL 字符串”，还不是平台内原型资产。

### 2.4 已有图片展示能力

`packages/ui/src/components/message-part.tsx`
`packages/ui/src/components/image-preview.tsx`
`packages/app/src/pages/session.tsx`
`packages/app/src/pages/session/review-tab.tsx`

当前前端已经具备：

- 消息附件图片展示
- 图片预览
- review 面板
- session side panel

这意味着 plan 模式“查看原型图”可以直接复用现有渲染层，不需要另起一套图片浏览基础设施。

## 3. 业务问题

当前流程中的断点主要有：

1. `build` 模式做完页面修改后，结果只停留在运行态页面，没有沉淀为可复用资产。
2. `plan` 模式虽然适合做讨论和方案梳理，但无法直接查看“build 阶段产出的页面效果”。
3. 审批流程已有 `ai_prototype_url`，但只能填外链，缺少平台内托管、版本历史和权限控制。
4. 页面改动、代码 diff、验证结果、原型图之间没有形成统一链路。

## 4. 方案目标拆解

本次功能建议拆成三个目标：

### 4.1 build 模式保存原型图

在 `build` 模式中，开发者修改页面并完成验证后，能够显式触发“保存当前页面原型图”。

### 4.2 plan 模式查看原型图

在 `plan` 模式中，用户可以查看：

- 当前会话最新原型图
- 历史原型图版本
- 原型图关联的说明、路由、时间、提交人、关联变更单

### 4.3 审批链路复用原型图资产

审批流中的 `ai_prototype_url` 从“外链字符串”升级为“平台内原型资产引用 + 外链兜底”。

## 5. 总体设计

建议把原型图能力分成 4 层：

1. 采集层
   build 模式下截图或上传原型图
2. 资产层
   存储图片文件和元数据
3. 关联层
   关联 session / message / change_request / route / test_run
4. 展示层
   在 plan 模式、审批页、会话页展示原型图

## 6. 推荐实现方案

推荐采用：

- `方案主线：自动截图 + 平台内存储 + 会话内展示`
- `落地顺序：先做手动保存，再做自动截图增强`

原因：

- 手动保存最容易落地，风险低
- 自动截图更符合最终目标，但依赖运行环境、页面路由、测试前置条件
- 先把“原型图是资产”这件事打通，再增强自动化

## 7. build 模式原型图保存方案

### 7.1 触发方式

建议提供两种触发方式：

#### 方式 A：手动保存

在 `build` 模式下增加命令或按钮：

- `/prototype save`
- 或会话 UI 中的 “保存原型图”

触发后弹出表单：

- 页面地址 / 路由
- 页面名称
- 关联变更单
- 说明
- 视口尺寸
- 是否覆盖“当前最新版本”

#### 方式 B：测试后自动保存

在页面修改完成并测试通过后，允许选择：

- “保存当前原型图”
- “保存并关联到当前变更单”

这一步建议调用 Playwright 或浏览器截图能力自动生成 PNG/WebP。

### 7.2 保存时机

建议保存时机不是“每次代码变更都自动截图”，而是以下明确节点：

1. build 模式下，用户主动点击“保存原型图”
2. build 模式下，某次测试通过后，用户确认保存
3. build 模式下，提交审批前自动提醒“是否保存最新原型图”

这样可以避免：

- 无意义截图过多
- 半成品页面污染历史版本
- 存储成本失控

### 7.3 截图来源

建议支持三种来源：

#### 来源 1：本地浏览器/本地前端页面自动截图

适合：

- `packages/app`
- 本地 dev server
- 可直接访问的业务页面

推荐实现：

- Playwright 启动已有页面 URL
- 指定 viewport
- `page.screenshot()`

#### 来源 2：手动上传截图

适合：

- 特殊环境页面
- 复杂登录态页面
- 移动端模拟图
- 设计稿导出图

#### 来源 3：已有审批链接导入

适合：

- 当前已有 `ai_prototype_url`
- 外部原型站点仍要保留

但这个只作为兜底，不建议继续作为主方案。

## 8. plan 模式查看原型图方案

### 8.1 核心原则

`plan` 模式保持只读，不允许修改原型图，只允许：

- 查看
- 对比
- 引用
- 在计划中讨论

### 8.2 展示入口

建议提供两个入口：

#### 入口 A：Session Side Panel 新增 `Prototype` 标签

现有 `SessionSidePanel` 已有：

- Review
- Context
- Files

建议新增：

- Prototype

展示内容：

- 最新原型图
- 历史版本列表
- 关联页面路径
- 保存时间
- 保存人
- 关联 message / session / change_request

#### 入口 B：审批详情页展示原型图卡片

当前 `packages/app/src/pages/approval-workflow.tsx` 只展示文本与 URL。

建议改成：

- 原型图预览卡片
- 大图预览
- 版本切换
- 外链跳转

### 8.3 plan 模式中的使用方式

在 `plan` 模式下建议支持：

- 查看最新原型图
- 查看历史版本原型图
- 选择某个原型图并把它作为上下文引用到当前计划
- 在计划里自动插入原型图引用信息

例如计划中可自动生成：

```md
参考原型：
- 原型名称：预约页优化-v3
- 路由：/appointment/queue
- 版本：3
- 生成时间：2026-03-12 21:30
```

## 9. 数据模型设计

当前只有：

- `tp_change_request.ai_prototype_url`
- `tp_timeline.attachment_url`

这不足以支撑版本化原型资产。

建议新增一张原型资产表：

## 10. 建议新增数据表

### 10.1 `tp_prototype_asset`

建议字段：

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
- `image_url`
- `thumbnail_url`
- `storage_key`
- `mime`
- `size_bytes`
- `status`
- `source_type`
- `source_url`
- `test_run_id`
- `test_result`
- `version`
- `is_latest`
- `time_created`
- `time_updated`

### 10.2 字段说明

- `agent_mode`
  固定记录 `build` / `plan`，用于审计和来源判断
- `source_type`
  取值建议：
  - `playwright_capture`
  - `manual_upload`
  - `external_url`
- `route`
  记录截图时页面路由
- `page_key`
  记录业务页面唯一标识，便于分组版本
- `version`
  同一 `session_id + page_key` 下递增
- `is_latest`
  标记当前页面的最新版本

### 10.3 关联策略

建议原型图与以下实体建立弱关联：

- `session_id`
- `message_id`
- `change_request_id`

这样可以支持：

- 先在 build 模式保存原型图，再补关联审批单
- 也可以先有变更单，再挂原型图

## 11. 存储设计

建议按部署场景分两层：

### 11.1 开发 / 本地模式

本地磁盘保存，例如：

- `.opencode/prototypes/<session_id>/<page_key>/<version>.png`

优点：

- 开发快
- 不依赖云存储

### 11.2 线上 / 团队模式

使用已有对象存储体系，优先复用：

- Cloudflare R2

对象路径建议：

- `prototype/<org_id>/<session_id>/<page_key>/v<version>.png`

### 11.3 缩略图策略

建议保存两份：

- 原图
- 缩略图

原因：

- plan 模式侧栏列表不需要原图
- 审批列表也不需要每次加载大图

## 12. API 设计建议

建议新增原型图 API，而不是继续塞进审批接口。

### 12.1 创建原型图

`POST /session/:sessionID/prototype`

请求体建议：

```json
{
  "message_id": "msg_xxx",
  "change_request_id": "cr_xxx",
  "title": "挂号页优化-v2",
  "description": "修改列表布局后的页面效果",
  "route": "/registration/list",
  "page_key": "registration-list",
  "agent_mode": "build",
  "source_type": "playwright_capture",
  "viewport": {
    "width": 1440,
    "height": 900
  },
  "source_url": "http://localhost:5173/registration/list"
}
```

### 12.2 上传原型图文件

`POST /session/:sessionID/prototype/upload`

用于手动上传。

### 12.3 查询原型图列表

`GET /session/:sessionID/prototype`

支持：

- 按 `page_key` 过滤
- 按 `change_request_id` 过滤
- 只取 `latest=true`

### 12.4 查询单个原型图

`GET /prototype/:prototypeID`

### 12.5 获取原型图二进制

`GET /prototype/:prototypeID/file`

### 12.6 绑定到变更单

`POST /approval/change-request/:change_request_id/prototype/:prototype_id/bind`

效果：

- 更新 `change_request.current_prototype_id`
- 同步回写 `ai_prototype_url`

## 13. 审批数据结构调整建议

当前 `ai_prototype_url` 不够。

建议在 `tp_change_request` 增加：

- `current_prototype_id`
- `prototype_version`

保留 `ai_prototype_url` 作为兼容字段。

推荐规则：

- 如果使用平台内原型图，则 `current_prototype_id` 为主
- 如果是外部原型站，则仍可只填 `ai_prototype_url`

## 14. UI 方案

### 14.1 build 模式 UI

建议在会话页增加：

- “保存原型图”按钮
- “保存并关联审批单”按钮

入口位置可选：

1. Session Header
2. SessionSidePanel 顶部工具区
3. Composer 上方操作条

推荐：

- Web 端放在 Session Header 或 Side Panel
- TUI 端先只提供命令，不先做图片展示

### 14.2 保存弹窗

弹窗字段建议：

- 原型标题
- 页面路径
- 截图地址
- 说明
- 关联变更单
- 视口选择
- 来源方式

### 14.3 plan 模式 UI

推荐在 `SessionSidePanel` 新增 `Prototype` tab：

- 顶部：当前页面最新原型图
- 中部：历史版本列表
- 底部：关联审批单和保存信息

点击某个原型图后：

- 右侧大图预览
- 支持放大
- 支持切换版本

### 14.4 审批页 UI

`approval-workflow.tsx` 建议从“输入 prototype URL”升级为：

- 平台内原型图选择器
- 外链输入框作为备用
- 当前原型图预览卡片

## 15. build -> plan 的完整流程

建议形成如下闭环：

1. 用户选择 `build` 模式
2. 修改页面代码
3. 运行验证
4. 触发“保存原型图”
5. 系统生成并保存原型图资产
6. 原型图自动关联当前 session / message / change request
7. 用户切到 `plan` 模式
8. 在 `Prototype` tab 查看原型图
9. 将原型图作为计划上下文继续讨论或提交审批

## 16. 自动截图实现建议

推荐分阶段：

### 阶段 1：手动保存 + 手动上传

最容易交付。

### 阶段 2：自动本地截图

基于 Playwright：

- 输入目标 URL
- 指定 viewport
- 自动等待页面稳定
- 截图
- 上传

### 阶段 3：测试通过后自动沉淀

把“页面验证”和“原型沉淀”串起来。

例如：

- Playwright 用例通过后执行 screenshot hook
- 将截图结果作为 prototype asset 存档
- 回写 session / approval

## 17. 推荐技术选型

### 17.1 截图引擎

推荐：

- `Playwright`

原因：

- 仓库里已经使用 Playwright
- 适合页面级截图
- 可直接接入现有测试链路

### 17.2 图片展示

推荐直接复用：

- `packages/ui/src/components/image-preview.tsx`
- 现有 message attachment 图片渲染能力

### 17.3 存储

推荐：

- 本地开发：文件系统
- 团队/线上：R2

## 18. 权限设计

建议权限规则如下：

- `code:generate`
  允许在 build 模式生成和保存原型图
- `prototype:view`
  允许在 plan 模式和审批页查看原型图
- `prototype:approve`
  允许在审批页确认原型图
- `session:update_any`
  允许管理员重绑原型图和审批单

## 19. 与现有代码的结合点

### 19.1 后端

优先扩展：

- `packages/opencode/src/server/routes/session.ts`
- `packages/opencode/src/server/routes/approval.ts`
- `packages/opencode/src/approval/service.ts`

新增：

- `packages/opencode/src/prototype/*`

建议包含：

- `prototype.sql.ts`
- `service.ts`
- `storage.ts`
- `capture.ts`

### 19.2 前端

优先扩展：

- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/app/src/pages/approval-workflow.tsx`

新增：

- `packages/app/src/pages/session/prototype-tab.tsx`
- `packages/app/src/components/prototype/*`

### 19.3 权限

复用现有：

- `prototype:view`
- `prototype:approve`

不需要重新设计权限体系。

## 20. 推荐分期实施

### 第一期：最小可用版本

目标：

- build 模式可手动保存原型图
- 原型图落库
- plan 模式可只读查看
- 审批页可展示已绑定原型图

范围：

- 新增 `tp_prototype_asset`
- 新增 prototype API
- SessionSidePanel 增加 Prototype tab
- Approval 页改为“平台原型 + URL 兼容”

### 第二期：自动截图

目标：

- build 模式下从 `localhost` 页面自动截图
- 支持 viewport 和 route
- 一键保存

### 第三期：测试联动

目标：

- 页面测试通过后自动建议保存原型图
- 原型图关联 test_run

### 第四期：版本对比

目标：

- 原型图版本历史
- 版本对比
- 原型图与 diff / comment / plan 联动

## 21. 测试方案

### 21.1 后端测试

新增：

- prototype service 单测
- prototype API 测试
- change request 绑定原型图测试

### 21.2 前端测试

新增：

- Prototype tab 展示测试
- plan 模式只读测试
- approval 页面原型图展示测试

### 21.3 E2E 测试

建议场景：

1. build 模式保存原型图成功
2. plan 模式查看原型图成功
3. 审批页展示已绑定原型图
4. 无 `prototype:view` 权限时不可查看

## 22. 风险与注意点

### 22.1 本地截图环境复杂

风险：

- 登录态
- 多页面路由
- 本地服务地址不一致

应对：

- 第一期先手动上传/手动保存
- 第二期再接自动截图

### 22.2 图片存储成本

风险：

- 高频保存产生大量原图

应对：

- 默认压缩为 WebP 或 PNG
- 保存缩略图
- 做版本数量上限或归档策略

### 22.3 plan 模式只读边界

风险：

- 用户在 plan 模式里误触发上传或覆盖

应对：

- plan 模式 UI 只提供查看，不提供保存、删除、覆盖

### 22.4 审批兼容性

风险：

- 现有 `ai_prototype_url` 依赖外链

应对：

- 保留原字段
- 平台内原型图作为主字段，外链作为兼容字段

## 23. 最终建议

最推荐的落地路线是：

1. 先把“原型图资产化”做出来
2. 先支持 `build` 手动保存、`plan` 只读查看
3. 再接自动截图
4. 最后再把测试结果、审批流、版本比较全部串起来

这样可以避免一开始就把问题做成“浏览器自动化 + 文件存储 + 权限 + 审批 + UI 全栈联动”的大爆炸需求。

## 24. 结论

这个需求非常适合基于现有 TpCode / OpenCode 架构做增强，而不是另起系统。

因为当前项目已经具备：

- build / plan 模式
- 会话与消息体系
- 审批与权限体系
- 图片预览能力
- 原型审批字段
- Playwright 测试基础

真正缺的只是把这些现有能力接起来，形成“开发结果沉淀为原型图资产，并在 plan/审批阶段复用”的产品闭环。

---

如果下一步需要，我建议继续补两份文档：

- `TpCode-原型图功能详细开发任务拆解.md`
- `TpCode-原型图功能数据库与API设计.md`

这样就可以直接进入开发排期。
