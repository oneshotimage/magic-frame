# 开发历史

## 2026-05-31 - 初始化 AI影像写真馆全栈 MVP

任务：基于后端架构文档、Swagger 文档、前端架构文档和 Figma 视觉，实现可运行的前后端 MVP。

改动项：

- 新增全栈 MVP 页面 `public/mvp.html`、`public/mvp.css`、`public/mvp.js`。
- 实现 17 个小程序页面对应的 SPA 流程：启动页、首页、风格选择、上传、确认、协议、生成中、结果、预览、保存成功、分享海报、购买、广告奖励、我的、订单、FAQ、隐私协议。
- 基于 Figma 暖琥珀视觉落地移动端样式：暖琥珀主按钮、奶油背景、24px 卡片圆角、999px 胶囊按钮、玻璃拟态浮层。
- 扩展 `server.js`，补齐核心业务 API：登录、用户、次数、上传、生成任务、订单、支付回调、分享、反馈。
- 后端生成链路支持 KL API `gpt-image-2` 的 `/v1/images/edits`；未配置 `KL_API_TOKEN` 或 `KL_API_KEY` 时返回本地模拟作品，方便完整流程验证。
- 实现生成任务异步处理、任务轮询、四风格结果展示、成功后扣减 1 次、失败不扣次数。
- 更新 `public/index.html`，增加“全栈MVP”入口。
- 生成并补充研发文档：后端架构、接口 Swagger、前端架构、DOCX 转 Markdown。

验证：

- `node --check server.js` 通过。
- `node --check public/mvp.js` 通过。
- `http://localhost:4174/mvp.html` 返回 200。
- 登录、套餐查询、上传、创建生成任务、轮询成功路径 smoke test 通过。
