# 数据库业务表结构

后端持久化已从单表快照升级为业务表。接口层仍使用内存 `STATE` 作为运行时缓存，所有写操作通过 `persist_state()` 同步到数据库业务表，服务启动时再从业务表恢复。

## 数据库名

数据库由环境变量决定：

- 优先使用 `DATABASE_URL` 中的库名。
- 未配置 `DATABASE_URL` 时，使用微信云托管 MySQL 环境变量：`MYSQL_DATABASE` 或 `MYSQL_DB`。
- 本地未配置 MySQL 时使用 SQLite：`.data/backend.db`。

## 表列表

| 表名 | 用途 |
| --- | --- |
| `users` | 微信用户、openid、unionid、昵称头像 |
| `auth_tokens` | access token 登录态 |
| `refresh_tokens` | refresh token |
| `credits` | 用户额度余额 |
| `credit_logs` | 额度变更流水 |
| `uploads` | 用户上传图片记录、对象存储 key、内部生成输入 |
| `generation_tasks` | 生成任务主表 |
| `generation_images` | 单张生成结果、风格、状态、URL、错误摘要 |
| `orders` | 充值订单 |
| `feedback` | 用户反馈 |
| `ad_rewards` | 激励广告幂等记录 |
| `generated_assets` | 生成图、海报等图片资产 |
| `admin_tokens` | 后台管理员登录态 |
| `debug_logs` | 接口和生成链路调试日志 |

## 关键关系

- `users.user_id` 对应各业务表的 `user_id`。
- `uploads.image_id` 对应 `generation_tasks.input_image_id`。
- `generation_tasks.task_id` 对应 `generation_images.task_id`。
- `generation_tasks.task_id` 和 `generated_assets.task_id` 可用于追踪生成任务与实际图片资产。
- `orders.user_id`、`credit_logs.user_id` 用于用户运营和额度审计。

## 兼容策略

旧版本的 `app_snapshots` 表仍会创建并保留。启动时如果业务表为空，会尝试从旧 `app_snapshots` 读取历史快照；后续保存会写入新的业务表。

每张业务表保留 `raw_json` 字段，用于兼容当前接口响应结构和未来字段扩展；同时将常用查询字段拆成独立列，便于后台运营查询。

## 旧数据迁移

如果旧数据还在 `app_snapshots` 表里，可以执行一次性迁移脚本。

先预检查，不写入：

```bash
python3 scripts/migrate_legacy_snapshot.py --dry-run
```

确认 `legacy snapshot found: True`，且业务表为空后执行：

```bash
python3 scripts/migrate_legacy_snapshot.py
```

如果业务表已经有数据，脚本会默认拒绝覆盖。确认要用旧快照覆盖业务表时，再执行：

```bash
python3 scripts/migrate_legacy_snapshot.py --force
```

迁移后可查询：

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM generation_tasks;
SELECT COUNT(*) FROM generation_images;
```

确认新业务表数据正常后，可以删除旧快照表：

```bash
python3 scripts/migrate_legacy_snapshot.py --drop-legacy --drop-without-migration
```

如果还没有执行迁移，也可以迁移成功后同时删除旧表：

```bash
python3 scripts/migrate_legacy_snapshot.py --drop-legacy
```

删除前建议先备份数据库，或至少确认 `users`、`generation_tasks`、`generation_images`、`uploads`、`generated_assets` 的行数符合预期。

## 常用查询

查看某个用户最近任务：

```sql
SELECT task_id, status, progress, size, created_at, updated_at
FROM generation_tasks
WHERE user_id = '用户ID'
ORDER BY created_at DESC
LIMIT 20;
```

查看失败图片：

```sql
SELECT gi.task_id, gi.image_id, gi.style, gi.error_message, gt.user_id, gt.created_at
FROM generation_images gi
JOIN generation_tasks gt ON gt.task_id = gi.task_id
WHERE gi.status = 'FAILED'
ORDER BY gt.created_at DESC;
```

查看额度流水：

```sql
SELECT user_id, type, amount, biz_id, created_at
FROM credit_logs
WHERE user_id = '用户ID'
ORDER BY created_at DESC;
```
