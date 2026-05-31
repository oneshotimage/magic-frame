# AI影像写真馆后端架构文档

版本：MVP 研发版  
技术栈：NestJS + TypeScript + Prisma + MySQL 8 + Redis + RabbitMQ + 腾讯 COS + KL API  
AI 主链路：KL API `gpt-image-2`，OpenAI 兼容图片编辑接口 `/v1/images/edits`

## 1. 架构目标

AI影像写真馆后端负责微信登录、用户与次数体系、图片上传、人像校验、AI 生成任务、支付回调、广告奖励、作品管理和后台运营。MVP 不自建模型，所有大模型能力通过 KL API 聚合调用。

核心原则：

- 前端只上传用户授权图片，后端统一上传 COS 并生成短期签名 URL。
- 创建任务不扣次数，四张风格图全部成功后扣 1 次。
- KL API 调用通过 `AiGatewayModule` 封装，不让业务模块直接接触第三方接口。
- AI 生成异步化，API 只负责创建任务和查询状态。
- 支付回调、广告奖励、点数扣减全部幂等。
- 图片、人脸、支付数据最小化留存，支持用户注销和作品删除。

## 2. 总体架构

```mermaid
flowchart LR
  MP[微信小程序 Taro] --> NGINX[Nginx / API Gateway]
  NGINX --> API[NestJS API]
  API --> Auth[Auth Service]
  API --> User[User Service]
  API --> Credit[Credit Service]
  API --> Upload[Upload Service]
  API --> Gen[Generation Service]
  API --> Pay[Payment Service]
  API --> Ad[Ad Service]
  API --> Admin[Admin Service]

  Upload --> COS[腾讯 COS]
  Gen --> Redis[(Redis)]
  Gen --> MQ[(RabbitMQ)]
  API --> MySQL[(MySQL 8)]
  API --> Redis

  MQ --> Worker[AI Worker]
  Worker --> AiGateway[AI Gateway]
  AiGateway --> KL[KL API api.kl-api.info]
  KL --> GPT[gpt-image-2 / images edits]
  Worker --> COS
  Worker --> MySQL
  Worker --> Redis

  Pay --> WXPay[微信支付 / 虚拟支付]
  Auth --> WX[微信 code2session]
```

## 3. 核心数据流

```mermaid
flowchart TD
  A[用户选择照片] --> B[小程序本地压缩到 2MB 内]
  B --> C[POST /upload/image]
  C --> D[后端校验 MIME/大小/基础安全]
  D --> E[上传腾讯 COS]
  E --> F[POST /generation/create]
  F --> G[检查用户次数与限流]
  G --> H[创建 ai_tasks 和 4 条 ai_task_images]
  H --> I[投递 RabbitMQ ai.generate]
  I --> J[Worker 消费任务]
  J --> K[生成 COS 输入图签名 URL 或下载图片]
  K --> L[AI Gateway 调 KL API gpt-image-2]
  L --> M{单风格成功?}
  M -- 是 --> N[保存输出图到 COS]
  M -- 否 --> O[按策略重试]
  O --> P{仍失败?}
  P -- 是 --> Q[任务 FAILED/PARTIAL_SUCCESS 不扣次数]
  N --> R{四张全部成功?}
  R -- 是 --> S[事务扣减 1 次]
  S --> T[任务 SUCCESS]
  T --> U[前端轮询展示四宫格]
```

## 4. 后端目录结构

```text
src/
├── main.ts
├── app.module.ts
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── pipes/
│   ├── constants/error-codes.ts
│   └── utils/
├── config/
│   ├── env.schema.ts
│   ├── app.config.ts
│   ├── cos.config.ts
│   ├── kl-api.config.ts
│   ├── redis.config.ts
│   └── rabbitmq.config.ts
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── modules/
│   ├── auth/
│   ├── user/
│   ├── credit/
│   ├── upload/
│   ├── generation/
│   ├── ai-gateway/
│   ├── order/
│   ├── payment/
│   ├── ad/
│   ├── share/
│   ├── feedback/
│   ├── work/
│   └── admin/
└── workers/
    ├── ai-generate.consumer.ts
    ├── ai-retry.consumer.ts
    └── payment-reconcile.job.ts
```

## 5. 模块职责

| 模块 | 职责 | Controller | Service | 依赖 |
| --- | --- | --- | --- | --- |
| AuthModule | 微信登录、JWT、注销 | `AuthController` | `AuthService` | WeChat API、User、Credit |
| UserModule | 用户资料、设备、注销 | `UserController` | `UserService` | Prisma、COS |
| CreditModule | 次数余额、流水、扣减、发放 | `CreditController` | `CreditService` | Prisma、Redis |
| UploadModule | 图片上传、校验、COS 存储 | `UploadController` | `UploadService` | COS、Redis |
| GenerationModule | AI 任务创建、查询、取消、历史 | `GenerationController` | `GenerationService` | Credit、RabbitMQ、Redis |
| AiGatewayModule | KL API 适配、重试、响应归一 | 无或内部 Controller | `KlImage2Provider` | KL API |
| WorkModule | RabbitMQ 消费、任务状态推进 | 无 | `AiGenerateConsumer` | Generation、AiGateway |
| OrderModule | 套餐、订单、关闭、补单 | `OrderController` | `OrderService` | Payment、Credit |
| PaymentModule | 微信支付参数、回调验签、对账 | `PaymentController` | `PaymentService` | WeChat Pay、Redis |
| AdModule | 激励广告奖励、每日上限、防刷 | `AdController` | `AdService` | Credit、Redis |
| ShareModule | 分享海报、分享奖励 | `ShareController` | `ShareService` | COS、Credit |
| AdminModule | 运营后台、人工补偿、任务管理 | `AdminController` | `AdminService` | 全业务模块 |

## 6. AI Gateway 设计

MVP 统一使用 KL API，不直接接入 OpenAI、火山或阿里。

```ts
export interface AiProvider {
  createImageEdit(input: CreateImageEditInput): Promise<CreateImageEditResult>;
}

export interface CreateImageEditInput {
  taskId: string;
  style: "pixar" | "realistic" | "handdrawn" | "comic";
  prompt: string;
  inputImageUrl: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  traceId: string;
}

export interface CreateImageEditResult {
  provider: "kl-api";
  model: "gpt-image-2";
  requestId?: string;
  outputUrl?: string;
  outputBase64?: string;
  raw: unknown;
  elapsedMs: number;
}
```

KL API 调用约定：

- Base URL：`KL_API_BASE_URL=https://api.kl-api.info`
- Endpoint：`POST /v1/images/edits`
- Auth：`Authorization: Bearer ${KL_API_KEY}`
- Content-Type：`multipart/form-data`
- Fields：`model=gpt-image-2`、`prompt`、`size`、`n=1`、`image=@input.jpg`
- 后端可以从 COS 下载输入图片后 multipart 上传，也可以使用 COS 短期签名 URL 下载后再传文件。
- 返回兼容 `data[0].url` 或 `data[0].b64_json`，统一转存 COS。

风格 Prompt 由服务端固定管理，避免前端注入高风险提示词。

| 风格 | style | KL 模型 | Prompt 版本 |
| --- | --- | --- | --- |
| 3D皮克斯卡通 | `pixar` | `gpt-image-2` | `v1_pixar` |
| 高级写实插画 | `realistic` | `gpt-image-2` | `v1_realistic` |
| 文艺手绘质感 | `handdrawn` | `gpt-image-2` | `v1_handdrawn` |
| 潮流涂鸦漫画 | `comic` | `gpt-image-2` | `v1_comic` |

## 7. AI 任务状态机

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> VALIDATING
  VALIDATING --> REJECTED: 图片不合规
  VALIDATING --> UPLOADED
  UPLOADED --> QUEUED
  QUEUED --> PROCESSING
  PROCESSING --> PARTIAL_SUCCESS: 部分风格失败
  PROCESSING --> SUCCESS: 四张全部成功
  PROCESSING --> RETRYING: KL API 临时失败
  RETRYING --> PROCESSING
  RETRYING --> FAILED: 超过重试上限
  PROCESSING --> TIMEOUT
  PARTIAL_SUCCESS --> RETRYING
  PARTIAL_SUCCESS --> REFUNDED
  FAILED --> REFUNDED
  TIMEOUT --> REFUNDED
  SUCCESS --> CHARGED
  CHARGED --> [*]
```

状态说明：

| 状态 | 说明 | 是否扣次数 |
| --- | --- | --- |
| CREATED | 任务已创建 | 否 |
| VALIDATING | 图片合规、人脸、大小校验 | 否 |
| QUEUED | 已进入 RabbitMQ | 否 |
| PROCESSING | Worker 正在调用 KL API | 否 |
| PARTIAL_SUCCESS | 部分风格成功 | 否，等待重试或补偿 |
| SUCCESS | 四风格全部成功 | 是，事务扣 1 次 |
| FAILED | 全部失败或重试耗尽 | 否 |
| TIMEOUT | 业务超时 | 否 |
| REFUNDED | 已补偿或无需扣费 | 否 |

## 8. RabbitMQ 设计

Exchange：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `ai.generate.exchange` | direct | 首次生成 |
| `ai.retry.exchange` | direct | 延迟重试 |
| `ai.dead.exchange` | direct | 死信归档 |

Queue：

| 名称 | Routing Key | 说明 |
| --- | --- | --- |
| `ai.generate.queue` | `ai.generate` | AI 生成主队列 |
| `ai.retry.queue` | `ai.retry` | TTL 延迟后回主队列 |
| `ai.dead.queue` | `ai.failed` | 人工处理失败任务 |

消息结构：

```json
{
  "taskId": "task_001",
  "userId": "user_001",
  "inputImageUrl": "https://cos.example.com/input.jpg",
  "styles": ["pixar", "realistic", "handdrawn", "comic"],
  "provider": "kl-api",
  "model": "gpt-image-2",
  "retryCount": 0,
  "traceId": "trace_001",
  "createdAt": "2026-05-31T10:00:00+08:00"
}
```

重试策略：

- 单风格 KL API 网络错误、5xx、超时：最多重试 2 次。
- 4xx 内容安全或参数错误：不重试，记录失败原因。
- 任务级超时：10 分钟后标记 `TIMEOUT`，不扣次数。
- 死信任务进入后台，支持人工重试或关闭补偿。

幂等策略：

- `ai_task_images` 对 `(task_id, style)` 建唯一索引。
- Worker 处理前检查图片状态，已成功则跳过。
- 输出 COS Key 使用确定性路径：`outputs/{taskId}/{style}.png`。

## 9. 点数体系

点数类型：

| 类型 | 说明 |
| --- | --- |
| `free` | 新用户赠送 |
| `ad` | 激励广告奖励 |
| `paid` | 付费购买 |
| `gift` | 运营赠送 |
| `refund` | 失败补偿 |

扣减优先级：`free -> ad -> paid -> gift`。

事务流程：

```mermaid
sequenceDiagram
  participant W as AI Worker
  participant DB as MySQL
  participant R as Redis
  W->>R: SET lock:credit:task:{taskId} NX EX 30
  W->>DB: begin transaction
  W->>DB: SELECT ai_tasks FOR UPDATE
  W->>DB: SELECT credits WHERE user_id FOR UPDATE
  W->>DB: 检查 task.status=SUCCESS 且 charged=false
  W->>DB: 按 free/ad/paid/gift 扣减 1
  W->>DB: INSERT credit_logs idempotency_key=task:{taskId}:charge
  W->>DB: UPDATE ai_tasks charged=true
  W->>DB: commit
  W->>R: DEL lock
```

失败不扣费。若扣减事务失败，任务进入 `SUCCESS_PENDING_CHARGE`，由定时补偿任务重试扣减。

## 10. 微信登录

```mermaid
sequenceDiagram
  participant MP as 小程序
  participant API as NestJS
  participant WX as 微信 code2session
  participant DB as MySQL
  MP->>MP: wx.login()
  MP->>API: POST /auth/wechat-login {code}
  API->>WX: appid + secret + code
  WX-->>API: openid, unionid, session_key
  API->>DB: upsert users
  API->>DB: 首次注册初始化 credits.free=3
  API-->>MP: accessToken, refreshToken, profile, credits
```

JWT Payload：

```json
{
  "sub": "user_001",
  "openid": "wx_openid",
  "role": "user",
  "sessionVersion": 1
}
```

Token 策略：

- Access Token：2 小时。
- Refresh Token：30 天，存 Redis 哈希。
- 用户注销后提升 `sessionVersion`，让旧 token 失效。

## 11. 支付与虚拟商品

商品包：

| package_id | 名称 | 价格 | 点数 |
| --- | --- | ---: | ---: |
| `pkg_6_20` | 20次包 | 6 元 | 20 |
| `pkg_12_50` | 50次包 | 12 元 | 50 |
| `pkg_19_100` | 100次包 | 19 元 | 100 |

下单流程：

```mermaid
sequenceDiagram
  participant MP as 小程序
  participant API as 后端
  participant WX as 微信支付/虚拟支付
  participant DB as MySQL
  MP->>API: POST /orders {packageId}
  API->>DB: 创建 PENDING 订单
  API->>WX: 创建支付单
  WX-->>API: paymentParams
  API-->>MP: orderId + paymentParams
  MP->>WX: wx.requestPayment / 虚拟支付
  WX->>API: POST /payment/wechat/notify
  API->>API: 验签 + 幂等锁
  API->>DB: 更新订单 PAID，写 payment_records
  API->>DB: 发放 paid 点数，写 credit_logs
  API-->>WX: success
```

合规风险：

- 微信小程序虚拟商品在 iOS、类目、支付能力上存在平台限制，开发前必须确认当前类目是否允许。
- 如 iOS 不允许虚拟支付，需走广告奖励、活动赠送、安卓购买/iOS 展示权益说明等兜底。
- 不得绕过微信支付在小程序内售卖虚拟点数。

## 12. Redis Key 设计

| Key | 类型 | TTL | 用途 | 示例 |
| --- | --- | --- | --- | --- |
| `auth:refresh:{userId}:{jti}` | string | 30d | refresh token | `auth:refresh:u1:jti1` |
| `user:profile:{userId}` | hash | 10m | 用户资料缓存 | `user:profile:u1` |
| `credits:{userId}` | hash | 60s | 点数缓存 | `credits:u1` |
| `task:{taskId}` | hash | 24h | AI 任务状态 | `task:t1` |
| `poll:task:{taskId}` | string | 15m | 轮询节流 | `poll:task:t1` |
| `ad:daily:{userId}:{yyyyMMdd}` | counter | 2d | 每日广告次数 | `ad:daily:u1:20260531` |
| `rate:user:{userId}` | counter | 60s | 用户限流 | `rate:user:u1` |
| `rate:ip:{ip}` | counter | 60s | IP 限流 | `rate:ip:1.2.3.4` |
| `lock:pay:{transactionId}` | string | 10m | 支付回调幂等 | `lock:pay:wx123` |
| `lock:credit:task:{taskId}` | string | 30s | 扣费幂等 | `lock:credit:task:t1` |
| `circuit:kl-api:gpt-image-2` | string | 1m | KL API 熔断 | `circuit:kl-api:gpt-image-2` |

## 13. 数据库表结构摘要

实际实现建议用 Prisma 管理 schema，下列为核心表。

| 表 | 说明 | 关键约束 |
| --- | --- | --- |
| `users` | 用户主表 | `openid` unique |
| `user_login_logs` | 登录日志 | `user_id` index |
| `user_devices` | 设备记录 | `(user_id, device_id)` unique |
| `credits` | 用户点数余额 | `user_id` unique |
| `credit_logs` | 点数流水 | `idempotency_key` unique |
| `ai_tasks` | AI 主任务 | `task_no` unique |
| `ai_task_images` | 四风格子任务 | `(task_id, style)` unique |
| `generation_history` | 作品历史 | `user_id` index |
| `packages` | 次数包 | `package_id` unique |
| `orders` | 订单 | `order_no` unique |
| `payment_records` | 支付记录 | `transaction_id` unique |
| `ad_reward_logs` | 广告奖励 | `ad_event_id` unique |
| `invite_records` | 分享邀请 | `(inviter_id, invitee_id)` unique |
| `admin_users` | 后台用户 | `email` unique |
| `operation_logs` | 后台操作日志 | `operator_id` index |
| `system_configs` | 系统配置 | `config_key` unique |

## 14. 错误码

| code | HTTP | message | 场景 |
| --- | ---: | --- | --- |
| `AUTH_INVALID_CODE` | 400 | 微信登录 code 无效 | 登录 |
| `AUTH_UNAUTHORIZED` | 401 | 未登录或 token 失效 | 鉴权 |
| `USER_BANNED` | 403 | 当前账号不可用 | 风控 |
| `UPLOAD_TOO_LARGE` | 400 | 图片超过大小限制 | 上传 |
| `UPLOAD_INVALID_IMAGE` | 400 | 图片格式不支持 | 上传 |
| `IMAGE_FACE_INVALID` | 422 | 请上传清晰正面人像 | 校验 |
| `CREDIT_NOT_ENOUGH` | 402 | 生成次数不足 | 创建任务 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 | 查询 |
| `TASK_NOT_RETRYABLE` | 409 | 当前任务不可重试 | 重试 |
| `AI_PROVIDER_FAILED` | 502 | AI 服务暂时不可用 | KL API |
| `AI_TASK_TIMEOUT` | 504 | AI 生成超时 | Worker |
| `PAYMENT_VERIFY_FAILED` | 400 | 支付回调验签失败 | 支付 |
| `IDEMPOTENT_REPLAY` | 200 | 重复请求已处理 | 回调/扣费 |
| `RATE_LIMITED` | 429 | 请求过于频繁 | 限流 |

## 15. 部署方案

服务：

- `api`：NestJS HTTP API
- `worker`：RabbitMQ 消费进程
- `mysql`：MySQL 8
- `redis`：Redis 7
- `rabbitmq`：RabbitMQ management
- `nginx`：HTTPS、静态资源、反向代理

关键环境变量：

```bash
DATABASE_URL=mysql://user:password@mysql:3306/ai_photo
REDIS_URL=redis://redis:6379/0
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
JWT_SECRET=replace_me
WECHAT_APPID=replace_me
WECHAT_SECRET=replace_me
COS_SECRET_ID=replace_me
COS_SECRET_KEY=replace_me
COS_BUCKET=replace_me
COS_REGION=ap-guangzhou
KL_API_BASE_URL=https://api.kl-api.info
KL_API_KEY=replace_me
KL_IMAGE_MODEL=gpt-image-2
```

## 16. 验收指标

| 指标 | MVP 标准 |
| --- | --- |
| 图片上传压缩 | 前端 ≤ 1s，后端上传 COS P95 ≤ 2s |
| AI 平均耗时 | 单风格 P50 4-10s，四风格总任务可异步等待 |
| 成功率 | 有效人像任务 ≥ 95% |
| 超时率 | ≤ 2% |
| 失败扣费 | 0 |
| 支付回调幂等 | 重复回调不重复发点 |
| 广告奖励 | 每日最多 5 次 |
| 隐私 | 用户可删除作品和注销账号 |
