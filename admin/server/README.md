# 轻步 · 用户反馈管理员后台

用户在小程序提交反馈后，反馈进入微信云开发云数据库 `feedback` 集合。本后台供管理员查看、筛选、标记反馈状态。

## 架构

```
管理员网页 (admin/feedback/)
    ↓ 账号密码登录 + session cookie
你的 Flask 服务器 (admin/server/)
    ↓ access_token（appid+secret 换取）
微信云开发 HTTP API (tcb/invokecloudfunction)
    ↓ callFunction
listFeedback / updateFeedbackStatus 云函数
    ↓ 服务端校验 FEEDBACK_ADMIN_TOKEN
云数据库 feedback 集合
```

**双层鉴权**：
1. Flask 服务器：管理员账号密码登录（session cookie）
2. 云函数服务端：`FEEDBACK_ADMIN_TOKEN` 校验（即使账号密码泄露，没有 token 也调不通云函数）

**不再需要**：CloudBase JS SDK、匿名登录、Web 安全域名。

---

## 一、前置：部署云函数 + 配置环境变量

### 1. 部署 3 个云函数

在微信开发者工具中，右键 `cloudfunctions/` 下三个目录，选择「上传并部署：云端安装依赖」：

- `cloudfunctions/submitFeedback`
- `cloudfunctions/listFeedback`
- `cloudfunctions/updateFeedbackStatus`

### 2. 创建云数据库集合 `feedback`

云开发控制台 → 数据库 → 新建集合 `feedback`，权限保持默认。

### 3. 配置云函数环境变量 `FEEDBACK_ADMIN_TOKEN`

云开发控制台 → 云函数 → 选中 `listFeedback` 和 `updateFeedbackStatus` → 配置 → 环境变量：

```
FEEDBACK_ADMIN_TOKEN = <一串随机字符串>
```

两个云函数配同一个 token。生成命令：

```bash
python -c "import secrets; print(secrets.token_hex(24))"
# 或
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

## 二、部署 Flask 服务器

### 1. 上传文件

把 `admin/server/` 目录上传到你的服务器（3 个文件）：

```
admin/server/
├── app.py              # Flask 主程序
├── requirements.txt    # Python 依赖
└── .env.example        # 环境变量示例
```

### 2. 安装依赖

```bash
cd admin/server
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

> 要求 Python 3.8+。

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入：

| 变量 | 说明 | 去哪拿 |
|---|---|---|
| `QINGBU_APPID` | 小程序 AppID | 微信公众平台 → 开发 → 开发设置 |
| `QINGBU_SECRET` | 小程序 AppSecret | 微信公众平台 → 开发 → 开发设置（注意保密） |
| `QINGBU_ENV_ID` | 云开发环境 ID | 云开发控制台顶部，形如 `prod-0xxxxxx` |
| `FEEDBACK_ADMIN_TOKEN` | 与云函数配置的同一个 token | 上一步生成的 |
| `ADMIN_USERNAME` | 管理员账号 | 自己定 |
| `ADMIN_PASSWORD` | 管理员密码 | 自己定，建议 ≥ 12 位 |
| `SESSION_SECRET` | session 签名密钥 | `python -c "import secrets; print(secrets.token_hex(32))"` |

### 4. 启动

**开发模式：**

```bash
python app.py
# 默认监听 0.0.0.0:5000
```

**生产模式（推荐 gunicorn）：**

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

**Nginx 反向代理（推荐 + HTTPS）：**

```nginx
server {
    listen 443 ssl;
    server_name admin.yourdomain.com;

    # ssl 证书配置...

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> 上线 HTTPS 后，在 `.env` 里设 `FORCE_HTTPS=1`，session cookie 才会走 Secure。

### 5. 验证

```bash
curl https://admin.yourdomain.com/health
# 应返回 {"ok":true}
```

---

## 三、访问管理员网页

Flask 服务器同时托管管理员网页（同源，免 CORS）。浏览器打开：

```
https://admin.yourdomain.com/
```

1. 首次打开显示登录页 → 输入 `.env` 里配的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`
2. 登录成功后显示统计 + 反馈列表
3. 可筛选、标记已读/已处理

---

## 四、功能说明

- **统计**：全部 / 很好用 / 还可以 / 有点麻烦 / 未读 五项计数
- **筛选**：全部 / 很好用 / 还可以 / 有点麻烦 / 未读
- **列表**：按提交时间倒序，展示 rating / 状态 / 时间 / 内容 / 脱敏用户 ID / 版本
- **状态流转**：`新反馈 → 已读 → 已处理`
- **脱敏**：`anonymousUserId` 只显示前 6 位 + `****`（如 `u_ab12****`）

---

## 五、安全说明

| 风险 | 应对 |
|---|---|
| 任何人知道网页 URL 都能访问 | 必须账号密码登录，session cookie 鉴权 |
| 账号密码泄露 | 还有云函数 `FEEDBACK_ADMIN_TOKEN` 第二层校验，改密码即可 |
| AppSecret 泄露 | 只在服务器 `.env`，不返回前端；泄露后去微信公众平台重置 |
| access_token 被刷 | 服务端线程安全缓存，不暴露给前端；每天调用次数有限但有充足额度 |
| 普通用户在小程序里看到管理员入口 | 不会。普通用户端只有「提交反馈」 |
| 反馈正文被写进普通日志 | 不会。服务器日志只记 `登录成功/失败` 和 `access_token 刷新`，不写反馈内容 |

---

## 六、文件清单

```
admin/
├── server/                  # Flask 服务器（你部署到自己服务器）
│   ├── app.py
│   ├── requirements.txt
│   ├── .env.example
│   └── README.md            # 本文档
└── feedback/                # 管理员网页（Flask 自动托管，同源）
    ├── index.html
    ├── app.js
    └── style.css

cloudfunctions/
├── submitFeedback/          # 普通用户提交（小程序端调用）
├── listFeedback/            # 管理员列表/统计（Flask 服务器调用）
└── updateFeedbackStatus/    # 管理员改状态（Flask 服务器调用）
```
