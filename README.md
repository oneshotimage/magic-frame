# AI 影像写真馆模型可行性测试台

一个零依赖本地网页版测试平台，用于验证 KL API 聚合的 Liblib、即梦、GPT Image 2、Nano Banana 是否满足 MVP 的图生图写真生成要求。

## 启动

```bash
npm start
```

打开：

```text
http://localhost:4173
```

## 目录结构

```text
backend/
└── server.js              # 本地 API 服务、KL API 代理、MVP 业务接口

frontend/
└── public/                # 静态前端页面与样式脚本

docs/                      # PRD、架构文档、Swagger、开发历史
```

也可以用环境变量启动，避免每次在页面输入 Token：

```bash
KL_API_TOKEN="你的 KL API Token" npm start
```

## 使用流程

1. 默认处于「模拟模式」，可直接点击「运行测试」体验队列、指标和 CSV 导出。
2. 上传授权人像样本，建议首轮 5 张有效人像 + 3 张异常输入。
3. `Base URL` 默认是 KL 文档中的 `https://api.kl-api.info`。
4. 在「模型路由」里确认每个模型的 `model id`、`endpoint path` 和适配器。
5. 在「KL API 配置」里填写 Token/Key。认证方式固定为 `Authorization: Bearer <token>`。
6. 如接口要求公网图片 URL，在「公开图片 URL」里填写图床地址；否则上传本地图片即可。
7. 打开「真实请求」，点击「运行测试」。
8. 测试完成后点击「导出 CSV」，得到 `model_results_YYYY-MM-DD.csv`。

## KL 预设

当前内置的 KL 预设：

| 模型 | 默认 endpoint | 适配器 | 说明 |
| --- | --- | --- | --- |
| 即梦 Seedream | `/v1/images/generations` | `openai-json` | OpenAI 兼容 JSON 图片生成/图生图 |
| GPT Image 2 | `/v1/images/edits` | `openai-edit` | OpenAI 图片编辑 multipart |
| Nano Banana | `/fal-ai/nano-banana/edit` | `fal-queue` | fal 队列提交 + 轮询结果 |
| Liblib | `/v1/images/generations` | `template-json` | 先走可配置 JSON 模板，按 KL 文档微调 |

说明：Apifox 文档入口为 `https://kl-api.apifox.cn/doc-7164777`。不同模型字段如果变更，优先在页面里改 endpoint、model id、适配器和模板，无需改代码。

## 请求模板变量

请求 JSON 模板支持以下变量：

- `{{model}}`
- `{{prompt}}`
- `{{image}}`
- `{{style}}`
- `{{sample}}`
- `{{size}}`

默认模板：

```json
{
  "model": "{{model}}",
  "image": "{{image}}",
  "prompt": "{{prompt}}",
  "size": "1024x1024",
  "response_format": "url",
  "n": 1
}
```

Nano Banana 已支持「提交任务 + 轮询任务」。如果其它 KL 模型也返回异步任务 ID，可以把该模型的适配器改成 `fal-queue` 或按响应结构扩展 `backend/server.js`。

## 已实现能力

- 4 模型 × 4 风格测试矩阵
- 样本图片本地上传和标签标注
- Prompt 可编辑和重置
- 模拟模式与真实 KL 请求模式
- 本地 Node 代理，避免浏览器 CORS，并避免 Key 直接打到第三方页面
- OpenAI JSON、OpenAI multipart edit、fal queue、可配置 JSON 模板四种适配器
- 测试队列、成功率、15 秒完成率、P95、成本统计
- 输出对比区和 CSV 导出
