# tpCode Token 用量回填操作手册

## 1. 目的

本手册用于上线 `tp_token_usage` 后，执行历史数据回填，补齐已有会话的 token 消耗记录。

回填只处理 `step-finish` 历史记录，不处理历史 `auto_title`（历史无法可靠重建）。

## 2. 适用范围

- 项目：`TpCode/packages/opencode`
- 数据库：PostgreSQL（由 `OPENCODE_DATABASE_URL` 或 `OPENCODE_PG_URL` 指定）
- 回填脚本：`packages/opencode/script/backfill-token-usage.ts`
- 运行命令：`bun run backfill:token-usage`

## 3. 前置条件

1. 已部署包含以下改动的版本：
   - `tp_token_usage` 表迁移
   - 实时写入钩子（`step-finish`、`auto_title`）
2. 数据库可连接（网络/账号权限正常）。
3. 在仓库路径执行命令：
   - `cd TpCode/packages/opencode`

## 4. 执行时机

1. 首次上线：发布后立即执行一次全量回填。
2. 可选补偿：上线后 1 次补偿回填（防止窗口期漏写）。
3. 后续：仅在修复统计逻辑后按需重跑。

## 5. 执行步骤

### 5.1 进入目录

```bash
cd TpCode/packages/opencode
```

### 5.2 执行默认批次回填（推荐）

```bash
bun run backfill:token-usage
```

默认批次大小：`500`

### 5.3 指定批次大小（可选）

```bash
bun run backfill:token-usage 1000
```

说明：参数 `1000` 对应脚本内 `batchSize`。

## 6. 日志解读

脚本会输出：

```text
[token-usage] backfill started, batchSize=...
[token-usage] backfill finished scanned=... written=... failed=...
```

字段说明：

- `scanned`：扫描到的 `part` 记录数（包含非 `step-finish`）。
- `written`：成功写入/更新的 token usage 条数。
- `failed`：解析失败或写库失败数量。

## 7. 幂等与重复执行

可重复执行，设计为幂等：

- 唯一键：`unique(usage_scene, source_id)`
- `step-finish` 场景：`source_id = part.id`

重复回填不会重复累加同一条统计。

## 8. 验证方式（SQL）

建议在回填后执行以下检查：

```sql
-- 总量
select count(*) from tp_token_usage;

-- 场景分布
select usage_scene, count(*) from tp_token_usage group by usage_scene;

-- 最近写入
select id, usage_scene, source_id, session_id, message_id, token_total, cost_micros, time_created
from tp_token_usage
order by time_created desc
limit 20;
```

## 9. 常见问题

### 9.1 `FailedToOpenSocket failed to connect to postgresql`

原因：数据库不可达。  
处理：

1. 检查 `OPENCODE_DATABASE_URL` / `OPENCODE_PG_URL`
2. 检查网络连通与防火墙
3. 检查账号权限

### 9.2 `failed` 数量持续增长

处理：

1. 先查看日志中的 `partID/sessionID/messageID`
2. 检查对应 `part.data` 是否是合法 `step-finish`
3. 修复后可重跑脚本（幂等）

## 10. 与线上实时统计关系

回填只补历史数据。  
新数据由实时钩子异步写入，不阻塞主业务流程：

- `step-finish`：`Session.updatePart` 中异步记录
- `auto_title`：`ensureTitle` 中异步记录

