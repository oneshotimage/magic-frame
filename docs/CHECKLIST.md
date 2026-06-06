# AI 影像写真馆验收清单

## 开发前

- [ ] 已阅读 `AGENTS.md`。
- [ ] 已阅读 `README.md` 和 `backend/README.md`。
- [ ] 已确认当前工作区是否有未提交改动。
- [ ] 已确认本次修改范围：小程序、FastAPI、Node 后端、后台、部署或文档。
- [ ] 已确认不会回滚用户已有改动。

## 小程序

- [ ] 微信开发者工具可导入 `frontend/weapp`。
- [ ] `frontend/weapp/app.js` 的 `apiBaseUrl` 指向当前后端。
- [ ] 未登录进入首页不会自动跳登录页。
- [ ] 触发制作、作品、充值等受保护操作时才引导登录。
- [ ] 微信一键登录成功后保存 `accessToken` 和 `refreshToken`。
- [ ] 登录失败时 loading 会结束，并展示明确错误。
- [ ] 自定义导航栏在状态栏安全区以下。
- [ ] 固定底部操作区不遮挡底部安全区。
- [ ] 首页、作品集、我的页面使用自定义 tabbar。
- [ ] 主按钮使用 `app-button`。
- [ ] 分享按钮 `open-type="share"` 可触发分享。

## 图片链路

- [ ] 上传图片成功后后端返回可访问 URL 或 imageId。
- [ ] 创建生成任务成功。
- [ ] 生成中页能轮询到最终状态。
- [ ] 结果页展示生成图。
- [ ] 后台管理页展示同一生成图。
- [ ] 分享页展示生成图或海报图。
- [ ] 真机可加载图片，不显示破损缺省图。
- [ ] 图片 URL 使用 HTTP/HTTPS，不直接使用 base64 `data:` URL。
- [ ] 云托管正式环境图片存储在 COS 或其他持久对象存储。

## 后端

- [ ] `GET /health` 返回成功。
- [ ] `GET /config/runtime` 能看到 KL、数据库、对象存储配置状态。
- [ ] `POST /auth/wechat-login` 成功或返回明确错误。
- [ ] `POST /upload/image` 成功。
- [ ] `POST /upload/validate` 成功。
- [ ] `POST /generation/create` 成功创建任务。
- [ ] `GET /generation/{taskId}` 返回任务状态和结果。
- [ ] 失败任务保留错误摘要。
- [ ] `GET /generation/history` 返回历史作品。
- [ ] `POST /share/create-poster` 返回海报 URL 或明确失败。
- [ ] `/admin` 可访问。
- [ ] `/admin/api/*` 关键接口可访问。

## 部署

- [ ] Dockerfile 构建上下文正确。
- [ ] 云托管服务启动端口读取 `${PORT}`。
- [ ] 健康检查路径配置为 `/health`。
- [ ] 已配置 `PUBLIC_BASE_URL`。
- [ ] 已配置 `KL_API_TOKEN`。
- [ ] 已配置 `AI_MOCK_GENERATION=0`。
- [ ] 已配置 `AI_UNLIMITED_CREDITS=0`。
- [ ] 已配置数据库。
- [ ] 已配置 COS 或等价对象存储。
- [ ] 小程序合法域名包含后端域名和图片域名。

## 测试命令

- [ ] `python3 -m pytest backend/test_api.py`
- [ ] `node --check frontend/weapp/components/nav-bar/index.js`
- [ ] `node --check frontend/weapp/components/app-button/index.js`
- [ ] `node --check frontend/weapp/components/app-tabbar/index.js`
- [ ] `for f in frontend/weapp/pages/*/index.js; do node --check "$f" || exit 1; done`
- [ ] 小程序开发者工具预览通过。
- [ ] 真机登录、生成、结果、分享、作品集通过。

## 上线前

- [ ] 管理员默认密码已修改。
- [ ] KL API Token 未写入代码仓库。
- [ ] `.env` 未提交。
- [ ] 生成失败不会扣减额度。
- [ ] 生成成功会正确扣减额度。
- [ ] 支付成功会正确增加额度。
- [ ] 用户协议、隐私政策、内容授权文案完整。
- [ ] 后台能定位每个失败任务原因。
- [ ] 文档已同步最新接口、部署和环境变量。
