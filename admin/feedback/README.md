# 轻步 · 用户反馈管理员网页

本网页由 Flask 服务器自动托管（同源），不需要单独部署。

完整的部署和配置说明请看 [../server/README.md](../server/README.md)。

## 文件说明

```
admin/feedback/
├── index.html    # 页面结构（登录页 + 管理主页）
├── app.js        # 逻辑（fetch 调用同源 Flask API）
└── style.css     # 样式
```

## 工作方式

1. Flask 服务器启动后，访问 `https://你的域名/` 即打开本网页
2. 网页与 API 同源，fetch 请求自动带 session cookie，无需 CORS 配置
3. 网页不直接接触微信云开发，所有云函数调用都经 Flask 服务器中转

## 不再需要的东西

- ~~CloudBase JS SDK~~
- ~~匿名登录~~
- ~~Web 安全域名~~
- ~~在浏览器里存 adminToken~~
