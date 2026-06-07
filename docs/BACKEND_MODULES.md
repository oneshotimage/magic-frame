# 后端模块结构

本文档说明 FastAPI 后端的模块拆分和维护边界。后端入口位于 `backend/`，部署入口仍是：

```bash
uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

## 目录结构

```text
backend/
├── main.py              # FastAPI 应用装配、异常处理、中间件、router 注册
├── core.py              # 环境配置、全局状态、运行配置、调试日志
├── catalog.py           # 写真风格和套餐常量
├── schemas.py           # Pydantic 请求模型
├── services.py          # 用户、额度、上传记录、任务展示等业务服务
├── generation.py        # KL image2 调用、生成任务线程、图片资产和海报生成
├── cloud_runtime.py     # MySQL 业务表存储与 COS/本地对象存储
├── test_api.py          # 后端接口回归测试
└── routes/
    ├── public.py        # 小程序 API
    ├── admin.py         # 管理后台 API
    └── system.py        # 健康检查、运行配置、图片资产、后台静态页
```

## 模块职责

### `main.py`

只负责 FastAPI 应用装配：

- 创建 `FastAPI` 实例。
- 注册异常处理器。
- 注册请求调试和 CORS 中间件。
- 注册 `routes/` 下的 router。

不应继续堆业务接口或具体业务逻辑。

### `core.py`

放全局基础能力：

- `.env` 加载。
- 时间、ID、深拷贝等基础 helper。
- `AppError`。
- 进程内状态 `STATE`。
- `SnapshotStore` / `ObjectStorage` 实例。
- `/config/runtime` 使用的运行配置。
- 调试日志脱敏、记录和等级规范。

### `catalog.py`

放静态业务常量：

- `STYLE_PROMPTS`
- `PACKAGES`

新增风格或套餐时优先改这里。

### `schemas.py`

放请求模型：

- 登录、上传、生成、订单、反馈、后台登录、额度调整等 Pydantic model。

只定义输入结构，不写业务逻辑。

### `services.py`

放不直接依赖 FastAPI router 的业务服务：

- 用户创建和 token 签发。
- 登录态依赖函数。
- 管理员登录态依赖函数。
- 额度读取、增加、消耗、后台调整。
- 上传记录创建。
- 小程序任务视图和后台任务视图转换。
- 图片资产 URL 归一。

### `generation.py`

放生成链路相关能力：

- mock SVG 生成。
- KL API 响应图片 URL 提取。
- KL payload 摘要。
- `gpt-image-2` multipart 调用。
- base64 生成图转图片资产。
- 简易分享海报 PNG 生成。
- 后台线程 `process_generation`。

调用 KL API 或改生成任务状态流时优先改这里。

### `cloud_runtime.py`

放部署运行时存储适配：

- MySQL 业务表读写和旧快照迁移。
- COS / 本地对象存储。
- data URL 解析。

云托管 MySQL、COS 或持久化策略变化时优先改这里。

### `routes/public.py`

小程序调用的 API：

- Auth
- User
- Credits
- Upload
- Generation
- Packages / Orders / Payment
- Share
- Feedback

新增小程序接口优先放这里。

### `routes/admin.py`

管理后台 API：

- 后台登录、退出、当前用户。
- 运行配置。
- 统计。
- 用户、额度、任务、订单、反馈、图片资产。
- 调试日志查询和清空。

新增 `/admin/api/*` 接口优先放这里。

### `routes/system.py`

系统与静态资源 API：

- `/health`
- `/config/runtime`
- `/assets/generated/*`
- `/assets/object/*`
- `/admin`
- `/admin/{path:path}`

注意：`system.router` 中包含 `/admin/{path:path}` 静态兜底路由，必须在 `admin.router` 之后注册，避免截获 `/admin/api/*`。

## 依赖方向

推荐依赖方向：

```text
routes -> services / generation / core / schemas / catalog
services -> core / cloud_runtime
generation -> core / services / catalog / cloud_runtime
core -> cloud_runtime
```

避免：

- `core.py` 依赖 `routes/`。
- `services.py` 依赖 `routes/`。
- `schemas.py` 写业务逻辑。
- `main.py` 继续增加业务函数。

## 验证命令

修改后端模块后至少执行：

```bash
python3 -m py_compile backend/main.py backend/core.py backend/schemas.py backend/catalog.py backend/services.py backend/generation.py backend/routes/system.py backend/routes/admin.py backend/routes/public.py backend/test_api.py
python3 -m pytest backend/test_api.py
```
