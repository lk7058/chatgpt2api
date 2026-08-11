<h1 align="center">ChatGPT2API</h1>

<p align="center">基于 <a href="https://github.com/basketikun/chatgpt2api">basketikun/chatgpt2api</a> 二次开发的 ChatGPT 账号池代理服务，提供 OpenAI 兼容的图片生成/编辑 API，并内置邮箱账号体系、签到奖励、额度系统与 Web 管理面板。</p>

> [!NOTE]
> **原作者声明**
>
> 本项目源自 [https://github.com/basketikun/chatgpt2api](https://github.com/basketikun/chatgpt2api)，在其基础上进行了功能定制与增强开发。
> 感谢原作者的出色工作！原项目能力与社区支持请访问原作者仓库。

> [!WARNING]
> 免责声明：
>
> 本项目涉及对 ChatGPT 官网文本生成、图片生成与图片编辑等相关接口的逆向研究，仅供个人学习、技术研究与非商业性技术交流使用。
>
> - 严禁将本项目用于任何商业用途、盈利性使用、批量操作、自动化滥用或规模化调用。
> - 严禁将本项目用于破坏市场秩序、恶意竞争、套利倒卖、二次售卖相关服务，以及任何违反 OpenAI 服务条款或当地法律法规的行为。
> - 严禁将本项目用于生成、传播或协助生成违法、暴力、色情、未成年人相关内容，或用于诈骗、欺诈、骚扰等非法或不当用途。
> - 使用者应自行承担全部风险，包括但不限于账号被限制、临时封禁或永久封禁以及因违规使用等所导致的法律责任。
> - 本项目基于对 ChatGPT 官网相关能力的逆向研究实现，存在账号受限、临时封禁或永久封禁的风险。请勿使用你自己的重要账号、常用账号或高价值账号进行测试。

---

## ✨ 功能特性

### 邮箱账号体系

- **纯邮箱注册**：注册只需邮箱 + 验证码 + 密码，无需用户名
- **邮箱登录**：使用绑定邮箱 + 密码登录，支持大小写不敏感
- **找回密码**：通过绑定邮箱接收验证码重置密码，重置后自动注销所有登录会话
- **绑定邮箱**：用户中心自助绑定/更换邮箱（需邮箱验证码确认）
- **人机验证**：支持 Cloudflare Turnstile（需 HTTPS 部署）

### 签到与奖励

- **每日签到**：每天首次签到赠送固定额度（可在后台配置）
- **连续签到奖励**：支持配置里程碑档位（如连续 3 天 +5、7 天 +20、30 天 +100），每轮连续签到各档位可各领一次
- **签到日历**：用户中心展示近 60 天签到记录与下一个奖励里程碑

### 额度系统

- 注册赠送、签到赠送、管理员分配、充值卡兑换多种额度来源
- 额度流水明细与汇总统计
- 模型额度权重配置（按模型扣减，支持前缀匹配）

### OpenAI 兼容 API

- `POST /v1/images/generations` 图片生成
- `POST /v1/images/edits` 图片编辑（支持文件上传 / 图片 URL / 多图组图）
- `POST /v1/chat/completions` 文本、网页搜索与图片场景
- `POST /v1/responses` Responses API 兼容
- `GET /v1/models` 模型列表
- 支持 `n` 多图生成、流式输出、可编辑 PPT / PSD 生成

### 在线画图工作台

- 内置画图界面，支持生成、图片编辑与多图组图编辑
- 支持 `gpt-image-2`、`codex-gpt-image-2`、`auto`、`gpt-5` 系列模型
- 图片会话历史回看、服务端缓存、进度追踪、懒加载

### 号池管理

- 多账号轮询、自动刷新（邮箱/额度/恢复时间）
- Token 失效自动剔除、限流账号自动刷新、异常账号自动重登
- 全局 HTTP / HTTPS / SOCKS5 / SOCKS5H 代理 + WARP / FlareSolverr 稳定代理运行时
- 支持本地 CPA JSON / 远程 CPA / sub2api / access_token 四种导入方式
- 账号搜索、筛选、批量操作、导出

### 系统管理

- 用户管理：创建（邮箱）、额度分配、启停、重置密码、删除
- 图片管理：缩略图、WebDAV 存储、标签、批量清理
- 定时备份：支持 Cloudflare R2 存储、可选加密、自动轮替
- 第三方 API / sub2api / CPA 池配置
- 操作日志与健康监控面板

### 安全加固

- 登录失败自动锁定（IP + 账号维度）、验证码发送限流与冷却
- 服务端图片 URL 抓取 SSRF 防护（拒绝内网/保留地址）
- 密钥脱敏：配置接口不回传 SMTP / R2 / WebDAV 明文凭据
- 会话 30 天自动过期、密码最少 8 位、PBKDF2 12 万次迭代存储
- 静态资源长缓存 + gzip 压缩、安全响应头

---

## 🚀 安装教程

### 环境要求

- 服务器：Linux（推荐 2 核 2G 以上）
- Docker 19.03+ 与 Docker Compose v2
- 域名（可选但推荐，Turnstile 人机验证与安全传输需要 HTTPS）

### 1. 获取代码

```bash
git clone https://github.com/lk7058/chatgpt2api.git
cd chatgpt2api
```

### 2. 配置 config.json

复制示例并编辑：

```bash
cp .env.example .env  # 如需要环境变量
# 编辑 config.json 中的关键项
```

`config.json` 必填项：

```jsonc
{
  "auth-key": "换成你自己的随机密钥",   // 必填：管理员主密钥（所有 API 请求的 Bearer 凭证）
  "admin_account": {
    "username": "admin",              // 管理员内部账号
    "email": "admin@example.com",     // 管理员邮箱（用于邮箱登录/找回）
    "password": "请设置强密码"          // 管理员登录密码
  },
  "smtp": {                            // 邮箱验证码必填（注册/找回密码/绑定邮箱）
    "enabled": true,
    "host": "smtp.example.com",
    "port": 465,
    "username": "no-reply@example.com",
    "password": "smtp密码",
    "from": "no-reply@example.com",
    "from_name": "chatgpt2api",
    "use_ssl": true
  },
  "registration_enabled": true,        // 是否开放注册
  "turnstile": {                       // 可选：Cloudflare Turnstile 人机验证（需 HTTPS）
    "enabled": true,
    "site_key": "0x4AAAA...",
    "secret_key": "0x4AAAA..."
  },
  "checkin_bonus_quota": 2,            // 可选：每日签到赠送额度
  "checkin_streak_bonuses": [          // 可选：连续签到奖励档位
    { "days": 3, "bonus": 5 },
    { "days": 7, "bonus": 20 }
  ]
}
```

> `auth-key` 也可通过环境变量 `CHATGPT2API_AUTH_KEY` 覆盖。

### 3. 构建并启动

```bash
docker build -t chatgpt2api:custom .
docker compose up -d
```

启动后：

- Web 面板：`http://服务器IP:3000`
- API 地址：`http://服务器IP:3000/v1`
- 数据目录：`./data`（账号、用户、图片索引等）

### 4. 配置 HTTPS 反向代理（强烈推荐）

由于 Turnstile 人机验证要求 HTTPS，且生产环境应避免明文传输，建议使用 Nginx / 1Panel OpenResty / Caddy 反代：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_http_version 1.1;
    }
}
```

并修改 `config.json`：

```jsonc
{ "base_url": "https://your-domain.com" }
```

> `base_url` 用于生成图片等资源的公开 URL，**每个部署者填自己的域名**。留空时系统会使用请求来源地址（Host 头），如果请求经第三方转发，图片 URL 会显示为转发入口的域名 —— 建议始终填写自己的域名。

同时建议将 Docker 端口映射收敛为仅本机监听，避免绕过反代直连 HTTP：

```yaml
ports:
  - "127.0.0.1:3000:80"
```

### 5. 存储后端（可选）

支持通过环境变量 `STORAGE_BACKEND` 切换：

- `json` - 本地 JSON 文件（默认）
- `sqlite` - 本地 SQLite（`DATABASE_URL=sqlite:////app/data/accounts.db`）
- `postgres` - 外部 PostgreSQL（`DATABASE_URL=postgresql://user:pass@host:5432/dbname`）
- `git` - Git 私有仓库（`GIT_REPO_URL` + `GIT_TOKEN`）

```yaml
environment:
  - STORAGE_BACKEND=sqlite
  - DATABASE_URL=sqlite:////app/data/accounts.db
```

### 6. WARP / FlareSolverr 稳定代理部署

图片链路常遇 Cloudflare 拦截时可启用：

```bash
cp .env.example .env
docker compose -f docker-compose.warp.yml up -d --build
```

### 7. 更新

```bash
git pull
docker build -t chatgpt2api:custom .
docker compose up -d
```

---

## 🖥 API 使用

所有 AI 接口都需要请求头：

```http
Authorization: Bearer <auth-key>
```

### 图片生成 `POST /v1/images/generations`

```bash
curl http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只漂浮在太空里的猫",
    "n": 1,
    "response_format": "b64_json"
  }'
```

### 图片编辑 `POST /v1/images/edits`

支持 multipart 文件上传：

```bash
curl http://localhost:3000/v1/images/edits \
  -H "Authorization: Bearer <auth-key>" \
  -F "model=gpt-image-2" \
  -F "prompt=把这张图改成赛博朋克夜景风格" \
  -F "n=1" \
  -F "image=@./input.png"
```

也支持 JSON 图片 URL：

```bash
curl http://localhost:3000/v1/images/edits \
  -H "Authorization: Bearer <auth-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "把这张图改成赛博朋克夜景风格",
    "images": [
      {"image_url": "https://example.com/input.png"}
    ]
  }'
```

### 聊天补全 `POST /v1/chat/completions`

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "messages": [
      {"role": "user", "content": "生成一张雨夜东京街头的赛博朋克猫"}
    ],
    "n": 1
  }'
```

### Responses API `POST /v1/responses`

```bash
curl http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-5",
    "input": "生成一张未来感城市天际线图片",
    "tools": [{"type": "image_generation"}]
  }'
```

> 模型列表以 `GET /v1/models` 返回为准，可接入 Cherry Studio、New API 等上游客户端。

---

## 📄 目录结构

```
├── api/          # FastAPI 路由与业务接口
├── services/     # 账号池、用户、图片、日志、备份等核心服务
├── web/          # Next.js 前端（静态导出）
├── data/         # 运行时数据（账号、用户、图片索引、日志）
├── config.json   # 主配置
├── Dockerfile    # 容器镜像
└── docker-compose.yml
```

---

## 🔗 相关链接

- 原作者项目：[basketikun/chatgpt2api](https://github.com/basketikun/chatgpt2api)

## Contributors

感谢原项目所有贡献者：

<a href="https://github.com/basketikun/chatgpt2api/graphs/contributors">
  <img alt="Contributors" src="https://contrib.rocks/image?repo=basketikun/chatgpt2api" />
</a>
