# 轻步管理员后台 · 本地一键启动（Windows）

零基础也能跑起来。跟着做就行，不需要懂 Python / 服务器。

---

## 你最终能得到什么

双击一个文件 → 自动启动 → 浏览器打开 → 输入账号密码 → 看到所有用户反馈，能筛选、标记已读。

**只在你本机有效**，关掉窗口就停。换电脑要重新弄一次。

---

## 前提：先完成这两件事（只需做一次）

### 事情1：部署云函数 + 配置 token

在微信开发者工具里：

1. 左侧找到 `cloudfunctions` 文件夹展开
2. 对下面三个文件夹，每个**右键 → 上传并部署：云端安装依赖**：
   - `submitFeedback`
   - `listFeedback`
   - `updateFeedbackStatus`
3. 等右下角提示"上传成功"

### 事情2：在云开发控制台配 token + 建集合

1. 微信开发者工具 顶部点 **云开发** 按钮
2. **数据库** → **+** 新建集合，名字填 `feedback`，确定
3. 左侧 **云函数** → 点 `listFeedback` → 右上角 **配置** → **环境变量** → 添加：
   - 名字：`FEEDBACK_ADMIN_TOKEN`
   - 值：随便打一串你自己能记住的字母数字（比如 `qb2026admin_token_xxx_abc123`），**记下来**
   - 保存
4. 同样给 `updateFeedbackStatus` 也加一个**完全相同**的环境变量（名字和值都一样）

> 这串 token 后面要填到本地配置里。

---

## 正式开始：3 步跑起来

### 第1步：填配置

1. 用记事本（或任何编辑器）打开：
   ```
   e:\wks\pinduoduo\qing-yi-dian\admin\server\config.env
   ```
2. 填这几个值（等号右边）：

   ```
   QINGBU_APPID=你的小程序AppID
   QINGBU_SECRET=你的小程序AppSecret
   QINGBU_ENV_ID=你的云开发环境ID
   FEEDBACK_ADMIN_TOKEN=刚才在云函数里配的那串token
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=你定一个密码（至少8位）
   SESSION_SECRET=双击 generate_secret.bat 生成一串，复制过来
   ```

3. **去哪拿这些值**：
   - `QINGBU_APPID`：微信公众平台 (mp.weixin.qq.com) → 开发 → 开发设置 → AppID
   - `QINGBU_SECRET`：同上页面 → AppSecret → 点"重置"→ 复制（只显示一次，记得存）
   - `QINGBU_ENV_ID`：微信开发者工具 → 云开发控制台 → 顶部环境名旁边那串，形如 `prod-0xxxxxx`
   - `FEEDBACK_ADMIN_TOKEN`：你在事情2里配的那串
   - `SESSION_SECRET`：双击 `admin\server\generate_secret.bat`，它会打印一行，复制等号后面的内容

4. 保存文件

> ⚠️ 等号两边**不要加空格**，**不要加引号**。例如：
> ✅ 正确：`QINGBU_APPID=wx1234567890abcdef`
> ❌ 错误：`QINGBU_APPID = "wx1234567890abcdef"`

### 第2步：双击启动

双击这个文件：
```
e:\wks\pinduoduo\qing-yi-dian\admin\server\start.bat
```

**第一次运行会**：
- 自动创建虚拟环境（约10秒）
- 自动安装依赖（约30秒，从网上下载，需要联网）
- 启动服务
- 3秒后自动打开浏览器

**看到这样的提示就成功了**：
```
============================================================
  服务已启动！

  浏览器访问：http://127.0.0.1:5000
  用 config.env 里的账号密码登录

  关闭本窗口即停止服务
============================================================
```

> 这个黑色窗口**不要关**，关了服务就停了。最小化就行。

### 第3步：登录看反馈

浏览器会自动打开 `http://127.0.0.1:5000`：

1. 输入你在 config.env 里设的账号密码
2. 点登录
3. 看到反馈列表

---

## 以后再用

以后想看反馈，**只需要**：

1. 双击 `start.bat`
2. 浏览器自动打开，登录即可

不用再填配置，不用再装依赖。配置已经存好了。

---

## 常见问题

### Q: 双击 start.bat 闪一下就关了

说明有错误。改这样操作：
1. 打开 cmd（Win+R → 输入 cmd → 回车）
2. 拖动 `start.bat` 到黑窗口里 → 回车
3. 错误会停在屏幕上，拍照发我

### Q: 提示"缺少必要环境变量"

说明 config.env 没填完整，或者有空格/引号。按上面"第1步"重新检查。

### Q: 提示"没找到 Python"

先装 Python：
1. 去 https://www.python.org/downloads/ 下载
2. 安装时**务必勾选** "Add Python to PATH"
3. 装完重新双击 start.bat

### Q: 启动后浏览器打开但显示"无法访问"

等几秒，服务启动需要点时间。如果还不行，手动在浏览器输入 `http://127.0.0.1:5000`。

### Q: 登录提示"账号或密码不正确"

config.env 里的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 就是登录用的，检查是否填对、有没有多余空格。

### Q: 列表显示"加载失败：CLOUD_CALL_FAIL"

通常是这几个原因：
1. `QINGBU_APPID` / `QINGBU_SECRET` 填错 → 去微信公众平台核对
2. `QINGBU_ENV_ID` 填错 → 去云开发控制台核对
3. 云函数没部署 → 回去看"事情1"
4. `FEEDBACK_ADMIN_TOKEN` 跟云函数里配的不一致 → 回去核对

### Q: 提交了反馈但列表是空的

去云开发控制台 → 数据库 → `feedback` 集合看看有没有数据。如果集合是空的，说明小程序端提交没成功，检查云函数 `submitFeedback` 是否部署了。

### Q: 想换电脑用

把整个 `admin\server\` 文件夹复制过去，重新填 `config.env`，双击 `start.bat`。虚拟环境（venv 文件夹）不用复制，会自动重建。

### Q: 关了窗口再双击 start.bat 提示端口被占用

上次的进程没退干净。打开任务管理器 → 找 `python.exe` → 结束任务 → 重新双击。

---

## 文件说明

```
admin\server\
├── start.bat              ← 双击这个启动
├── generate_secret.bat    ← 双击生成随机密钥（首次配置用）
├── config.env             ← 你填配置的地方（记事本打开）
├── app.py                 ← 服务程序（不用动）
├── requirements.txt       ← 依赖清单（不用动）
├── .env.example           ← 配置示例（参考用，不用动）
├── README-本地启动.md      ← 本文档
└── venv\                  ← 自动生成，不用管
```

---

## 安全说明

- `config.env` 里有你的 AppSecret，**不要发给别人，不要传到 GitHub**
- 本地启动只在你电脑上能访问（127.0.0.1），外网访问不到
- 关掉黑色窗口，服务立即停止
