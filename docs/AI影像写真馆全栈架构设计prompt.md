# AI影像写真馆 全栈架构设计 Prompt（研发落地版）

> 适用场景：Cursor / Claude Code / Cline / GPT / Gemini / Copilot Agent
> 目标：基于 PRD、DESIGN.md 和 Figma 17 个页面，生成可直接进入研发阶段的全栈技术架构文档。
> 项目核心：AI影像写真馆是一款微信小程序，用户上传普通照片后，一键生成 3D皮克斯卡通、写实插画、文艺手绘、涂鸦漫画四种风格，主打朋友圈、头像、亲子写真分享。

---

## 角色设定

你是一位资深：

* 产品架构师
* SaaS系统架构师
* 微信小程序架构师
* AI图片生成平台架构师
* 后端技术负责人
* 前端技术负责人
* OpenAPI设计专家
* 微信支付与虚拟商品支付架构师

请基于以下资料，输出一套可以直接进入研发阶段的《AI影像写真馆 技术架构设计文档》。

---

## 输入资料

### 1. 产品 PRD

`@AI影像特效小程序 PRD（MVP正式版）.md`

产品定位：

AI影像写真馆是一款轻量化微信小程序，用户上传普通照片后，一键生成 3D皮克斯卡通、写实插画、文艺手绘、涂鸦漫画四种主流高级风格，主打低成本、高颜值、朋友圈、头像、亲子写真分享。

PRD 中明确要求支持：

* 图片上传
* 智能压缩
* 人脸校验
* 四风格一键生成
* 结果保存分享
* 免费次数
* 广告次数
* 付费购买次数
* AI异步任务
* 失败重试
* 内容合规过滤

### 2. UI 设计规范

`@DESIGN.md`

视觉风格：

Warm Amber Minimalism。

核心视觉：

* 暖琥珀色
* 奶油色
* 柔和圆角
* 玻璃拟态
* 8pt Grid
* 24px 圆角卡片
* 999px 胶囊按钮
* 微信小程序原生体验

主色：

```text
#FFB800
#FFF5E8
#FF7D45
#F8F8F8
#222222
```

### 3. Figma 设计稿

Implement these 17 designs from Figma.

```text
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-893&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-927&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1016&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1058&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1131&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1202&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1287&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1392&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1421&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1931&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1856&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1791&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1707&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1671&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1605&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1535&m=dev
https://www.figma.com/design/iKflxgQqoyvdKA1QkmRiEW/XGT?node-id=3306-1462&m=dev
```

---

# 目标

输出一套可直接研发落地的技术方案，包含：

1. 前端微信小程序架构
2. 后端服务架构
3. 数据库表结构
4. Redis 缓存设计
5. RabbitMQ 异步任务设计
6. AI 生成任务系统
7. 微信登录与用户体系
8. 微信虚拟支付 / 虚拟商品点数购买方案
9. 点数、免费次数、广告次数管理体系
10. Swagger OpenAPI 3.0
11. 管理后台架构
12. 部署方案
13. 测试验收标准

不要只讲概念。

必须输出：

* 字段
* 表结构
* API 路径
* Request / Response
* OpenAPI YAML
* 状态机
* 数据流
* 页面流
* 时序图
* 代码目录结构
* 错误码
* 权限设计
* 支付回调验签流程
* 点数扣减事务流程
* AI 任务失败补偿流程

---

# 技术栈要求

## 微信小程序端

* Taro
* React
* TypeScript
* Zustand
* React Query
* NutUI

微信小程序原生能力：

* wx.login
* wx.uploadFile
* wx.chooseMedia
* wx.saveImageToPhotosAlbum
* wx.shareAppMessage
* wx.showShareImageMenu
* 激励视频广告
* 虚拟支付能力

## 后端

* NestJS
* TypeScript
* Prisma
* MySQL 8
* Redis
* RabbitMQ
* Swagger OpenAPI 3.0
* JWT

## 存储

* 腾讯 COS

## AI 服务

* 火山引擎：主模型
* Liblib：卡通增强
* 阿里百炼：失败兜底

## 部署

* Docker Compose
* Nginx
* PM2 或 Node Cluster
* GitHub Actions
* 可选 Kubernetes

---

# 第一部分：系统总体架构

请输出：

## 1.1 系统架构图

使用 Mermaid 或文本图。

必须包含：

* 微信小程序
* API Gateway
* Auth Service
* User Service
* Credit Service
* Payment Service
* Generation Service
* AI Gateway
* Work Service
* Admin Service
* MySQL
* Redis
* RabbitMQ
* COS
* 火山引擎
* Liblib
* 阿里百炼

## 1.2 核心数据流图

覆盖以下流程：

```text
用户选择图片
↓
前端压缩
↓
上传后端
↓
上传 COS
↓
创建 AI 任务
↓
进入 RabbitMQ
↓
AI Gateway 调用火山
↓
失败重试
↓
失败转阿里兜底
↓
成功保存作品
↓
扣减点数
↓
返回四宫格结果
```

## 1.3 核心时序图

输出 Mermaid sequenceDiagram：

* 微信登录时序图
* 生成写真时序图
* 微信虚拟支付下单时序图
* 支付回调发放点数时序图
* 激励广告获得次数时序图
* AI 任务失败重试时序图

---

# 第二部分：17 个 Figma 页面到前端页面映射

请根据 17 个 Figma 设计稿，输出页面映射表。

每一行包含：

| Figma Node | 页面名称 | Taro路由 | 页面职责 | 主要组件 | 依赖API | 状态Store | 埋点事件 |
| ---------- | ---- | ------ | ---- | ---- | ----- | ------- | ---- |

至少覆盖：

1. 启动页
2. 首页
3. 风格选择页
4. 上传页
5. 图片确认页
6. 协议确认页
7. 生成中页
8. 结果页
9. 图片预览页
10. 保存成功页
11. 分享海报页
12. 点数购买页
13. 激励广告页
14. 我的页面
15. 订单记录页
16. FAQ页面
17. 隐私协议 / 用户协议页面

---

# 第三部分：微信小程序前端架构

## 3.1 目录结构

输出完整 Taro 项目目录：

```text
src/
├── app.config.ts
├── app.tsx
├── pages/
├── components/
├── stores/
├── services/
├── hooks/
├── utils/
├── constants/
├── assets/
└── styles/
```

## 3.2 页面路由配置

输出 `app.config.ts` 示例。

## 3.3 Zustand Store 设计

必须输出：

### UserStore

字段：

* userId
* openid
* unionid
* nickname
* avatar
* token
* isLogin

Actions：

* login
* logout
* refreshProfile

### CreditStore

字段：

* totalCredits
* freeCredits
* paidCredits
* adCredits
* todayAdCount
* dailyAdLimit

Actions：

* fetchCredits
* consumeCredit
* addAdCredit
* addPaidCredit

### GenerationStore

字段：

* currentTaskId
* uploadImageUrl
* selectedStyles
* taskStatus
* progress
* results
* errorMessage

Actions：

* createTask
* pollTask
* resetTask
* retryTask

### OrderStore

字段：

* currentOrderId
* packageId
* paymentStatus
* orderList

Actions：

* createOrder
* requestPayment
* fetchOrders

## 3.4 React Query Hooks

输出：

* useLogin
* useUserProfile
* useCredits
* useCreateGeneration
* useGenerationTask
* useCreateOrder
* useOrderList
* useAdReward

每个 Hook 输出 TypeScript 类型。

## 3.5 组件设计

根据 DESIGN.md 输出组件规范：

* PrimaryButton
* StyleCard
* UploadCard
* CreditBadge
* ResultImageCard
* LoadingProgress
* PurchasePackageCard
* SharePosterCard
* EmptyState
* ErrorState

要求遵循：

* 主色 #FFB800
* 背景 #F8F8F8
* 卡片圆角 24px
* 胶囊按钮 999px
* 8pt grid
* 微信顶部胶囊安全区适配

---

# 第四部分：后端架构

## 4.1 NestJS 模块划分

输出完整目录：

```text
src/
├── main.ts
├── app.module.ts
├── common/
├── modules/
│   ├── auth/
│   ├── user/
│   ├── credit/
│   ├── generation/
│   ├── ai-gateway/
│   ├── payment/
│   ├── order/
│   ├── work/
│   ├── ad/
│   ├── admin/
│   └── upload/
├── prisma/
└── config/
```

## 4.2 每个模块职责

输出：

| 模块 | 职责 | Controller | Service | Repository | 依赖 |
| -- | -- | ---------- | ------- | ---------- | -- |

## 4.3 中间件与守卫

输出：

* JWT Guard
* Admin Guard
* RateLimit Guard
* WeChat Signature Guard
* Payment Callback Guard

## 4.4 错误码设计

输出统一错误码表：

| code | message | HTTP状态码 | 场景 |
| ---- | ------- | ------- | -- |

---

# 第五部分：数据库设计

请输出完整 MySQL 8 DDL。

必须包含：

1. users
2. user_login_logs
3. user_devices
4. credits
5. credit_logs
6. ai_tasks
7. ai_task_images
8. generation_history
9. orders
10. payment_records
11. packages
12. ad_reward_logs
13. invite_records
14. user_feedback
15. admin_users
16. operation_logs
17. system_configs

每张表必须包含：

* id
* created_at
* updated_at
* deleted_at 或 is_deleted
* 必要索引
* 唯一约束
* 字段注释

重点保证：

* 点数扣减可追溯
* 支付回调幂等
* AI任务失败不扣费
* 每生成一次全套4图才消耗1次
* 新用户默认赠送3次
* 每日广告最多5次

---

# 第六部分：Redis 设计

输出 Redis Key 设计表：

| Key | 类型 | TTL | 用途 | 示例 |
| --- | -- | --- | -- | -- |

必须包含：

* 用户登录 token
* 用户点数缓存
* AI任务状态缓存
* 生成任务轮询缓存
* 每日广告次数限制
* 用户限流
* IP限流
* 支付回调幂等锁
* AI供应商熔断状态
* 分享奖励去重

---

# 第七部分：RabbitMQ 任务设计

输出：

## Exchange

* ai.generate.exchange
* ai.retry.exchange
* ai.dead.exchange

## Queue

* ai.generate.queue
* ai.retry.queue
* ai.dead.queue

## Routing Key

* ai.generate
* ai.retry
* ai.failed

## Message Schema

```json
{
  "taskId": "task_001",
  "userId": "u_001",
  "imageUrl": "https://cos.xxx/input.jpg",
  "styles": ["pixar", "realistic", "handdrawn", "comic"],
  "provider": "volcengine",
  "retryCount": 0,
  "createdAt": "2026-05-31T10:00:00Z"
}
```

输出：

* 消费者逻辑
* 重试策略
* 死信队列策略
* 幂等处理
* 失败补偿

---

# 第八部分：AI 任务系统

## 8.1 状态机

输出 Mermaid stateDiagram：

* CREATED
* VALIDATING
* UPLOADED
* QUEUED
* PROCESSING
* PARTIAL_SUCCESS
* SUCCESS
* FAILED
* TIMEOUT
* CANCELLED
* REFUNDED

## 8.2 AI Provider 路由策略

输出：

| 风格        | 主供应商   | 兜底供应商 |
| --------- | ------ | ----- |
| pixar     | Liblib | 火山    |
| realistic | 火山     | 阿里    |
| handdrawn | 火山     | 阿里    |
| comic     | Liblib | 火山    |

## 8.3 计费规则

必须实现：

* 创建任务不扣点
* AI生成成功后扣点
* 四张图全部成功才扣1次
* 失败不扣点
* 超时不扣点
* 部分成功进入人工 / 系统补偿逻辑
* 重试不重复扣点

## 8.4 AI Gateway 接口抽象

输出 TypeScript interface：

```ts
interface AiProvider {
  createTask(input: CreateAiTaskInput): Promise<CreateAiTaskResult>;
  queryTask(providerTaskId: string): Promise<QueryAiTaskResult>;
  cancelTask?(providerTaskId: string): Promise<void>;
}
```

输出：

* VolcengineProvider
* LiblibProvider
* AliBailianProvider

---

# 第九部分：微信登录与用户体系

输出完整流程：

```text
wx.login
↓
小程序拿 code
↓
POST /auth/wechat-login
↓
后端调用微信 code2session
↓
保存 openid / unionid
↓
创建或更新用户
↓
首次注册赠送3次免费次数
↓
返回 accessToken / refreshToken / user profile
```

输出：

* API
* 数据结构
* JWT payload
* token过期策略
* 用户注销
* 账号绑定
* openid / unionid 处理
* 隐私合规提示

---

# 第十部分：点数 / 免费次数 / 广告次数系统

## 10.1 点数类型

* free
* paid
* ad
* gift
* refund

## 10.2 扣减优先级

建议：

1. free
2. ad
3. paid
4. gift

## 10.3 点数流水

必须每次变更写 `credit_logs`。

输出：

* 发放点数
* 扣减点数
* 退款点数
* 广告奖励点数
* 新用户赠送点数
* 后台人工调整点数

## 10.4 并发安全

要求输出：

* MySQL事务方案
* Redis分布式锁方案
* 幂等 key 设计
* 防重复扣费逻辑

---

# 第十一部分：微信虚拟支付 / 虚拟商品购买

请设计适用于微信小程序内虚拟商品“生成次数包”的支付方案。

## 11.1 商品包

| package_id | 名称    | 价格  | 点数  |
| ---------- | ----- | --- | --- |
| pkg_6_20   | 20次包  | 6元  | 20  |
| pkg_12_50  | 50次包  | 12元 | 50  |
| pkg_19_100 | 100次包 | 19元 | 100 |

## 11.2 下单流程

```text
用户选择套餐
↓
创建订单
↓
调用微信虚拟支付 / 小程序支付能力
↓
用户支付
↓
微信回调
↓
验签
↓
更新订单状态
↓
发放 paid 点数
↓
写 payment_records
↓
写 credit_logs
```

## 11.3 必须输出

* 下单接口
* 支付参数接口
* 支付回调接口
* 补单接口
* 查询订单接口
* 关闭订单接口
* 对账流程
* 退款 / 补偿策略
* 幂等处理
* 回调验签
* 风控限制

## 11.4 合规要求

请列出开发前必须确认的微信平台要求：

* 当前小程序类目是否允许虚拟支付
* iOS端虚拟支付是否可用
* 是否需要接入微信小程序虚拟支付
* 是否需要区分安卓与iOS购买路径
* 是否需要改为广告 / 积分免费模式作为兜底

不要假设一定可用，必须输出合规风险和兜底方案。

---

# 第十二部分：激励视频广告

输出：

* 广告初始化
* 广告播放成功回调
* 广告中断不发放
* 每日最多5次
* 防刷
* ad_reward_logs
* API设计
* 前后端交互流程

---

# 第十三部分：Swagger OpenAPI 3.0

输出完整 `openapi.yaml`。

必须包含：

## Auth

* POST /auth/wechat-login
* POST /auth/refresh-token
* POST /auth/logout

## User

* GET /user/profile
* PATCH /user/profile
* POST /user/delete

## Credit

* GET /credits
* GET /credits/logs
* POST /credits/consume
* POST /credits/reward-ad

## Upload

* POST /upload/image
* POST /upload/validate

## Generation

* POST /generation/create
* GET /generation/{taskId}
* POST /generation/{taskId}/retry
* POST /generation/{taskId}/cancel
* GET /generation/history

## Order

* GET /packages
* POST /orders
* GET /orders/{orderId}
* GET /orders
* POST /orders/{orderId}/close

## Payment

* POST /payment/wechat/notify
* POST /payment/reconcile

## Share

* POST /share/create-poster
* POST /share/reward

## Feedback

* POST /feedback

要求：

* 每个接口都有 summary
* requestBody
* parameters
* responses
* schemas
* examples
* security bearerAuth

---

# 第十四部分：管理后台系统

输出后台功能设计：

## 用户管理

* 用户列表
* 点数余额
* 点数流水
* 登录记录
* 封禁 / 解封

## AI任务管理

* 任务列表
* 状态筛选
* 查看原图
* 查看结果图
* 失败原因
* 手动重试
* 手动退款

## 订单管理

* 订单列表
* 支付状态
* 回调日志
* 补单
* 对账

## 点数管理

* 人工增加
* 人工扣减
* 调整原因
* 操作日志

## 运营统计

* DAU
* 新增用户
* 生成次数
* 成功率
* 失败率
* 平均耗时
* 分享率
* 支付转化率
* 广告完成率

---

# 第十五部分：部署方案

输出：

## Docker Compose

包含：

* api
* mysql
* redis
* rabbitmq
* nginx

## 环境变量

输出 `.env.example`：

* DATABASE_URL
* REDIS_URL
* RABBITMQ_URL
* JWT_SECRET
* WECHAT_APPID
* WECHAT_SECRET
* COS_SECRET_ID
* COS_SECRET_KEY
* VOLC_ACCESS_KEY
* VOLC_SECRET_KEY
* LIBLIB_API_KEY
* ALI_API_KEY

## CI/CD

输出 GitHub Actions：

* install
* lint
* test
* build
* docker build
* deploy

---

# 第十六部分：测试方案

## 单元测试

* 用户登录
* 点数扣减
* 支付回调
* AI任务状态转换

## 集成测试

* 完整生成流程
* 支付购买点数流程
* 广告奖励流程
* 失败重试流程

## 压测指标

必须达到：

* 图片上传压缩耗时 ≤ 1s
* AI生成平均耗时 4–10s
* 成功率 ≥ 95%
* 超时率 ≤ 2%
* 弱网状态友好提示

---

# 第十七部分：最终交付物

请按以下文件输出：

1. README.md
2. architecture.md
3. frontend-architecture.md
4. backend-architecture.md
5. database-schema.sql
6. redis-rabbitmq.md
7. ai-task-system.md
8. payment-credit-system.md
9. admin-system.md
10. openapi.yaml
11. docker-compose.yml
12. .env.example
13. github-actions.yml
14. test-plan.md

每个文件使用独立代码块输出。

代码块标题必须标明文件名。

---

# 输出风格要求

* 使用 Markdown
* 不要泛泛而谈
* 不要只给概念
* 所有设计必须围绕 AI影像写真馆
* 所有 API 必须可直接给前后端联调
* 所有表结构必须可直接执行
* 所有流程必须考虑失败、重试、幂等、补偿
* 所有支付与点数逻辑必须考虑并发安全
* 所有用户图片与人脸数据必须考虑隐私合规
* Figma 17个页面必须全部映射到页面路由、组件、接口和状态
* 输出内容以“可开发”为第一优先级

