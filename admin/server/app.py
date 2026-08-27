"""
轻步 · 用户反馈 管理员后台服务（Flask）

架构：
    管理员网页 → 本服务 (Flask) → 微信云开发 HTTP API → 云函数 → 云数据库

安全：
    - 管理员账号密码登录（session cookie 鉴权）
    - 服务端持有 FEEDBACK_ADMIN_TOKEN，调云函数时二次校验（双层鉴权）
    - appid/secret/access_token 只在服务端，绝不返回前端
    - access_token 线程安全缓存，提前 5 分钟刷新

环境变量（见 .env.example）：
    QINGBU_APPID          小程序 appid
    QINGBU_SECRET         小程序 secret（微信公众平台 → 开发 → 开发设置）
    QINGBU_ENV_ID         云开发环境 id
    FEEDBACK_ADMIN_TOKEN  与云函数环境变量配置的同一个 token
    ADMIN_USERNAME        管理员账号
    ADMIN_PASSWORD        管理员密码
    SESSION_SECRET        session 签名密钥（随机长串）
"""

import os
import json
import time
import threading
import secrets
import logging
from functools import wraps

import requests
from flask import Flask, request, jsonify, session, send_from_directory
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# 配置
# ============================================================
APPID = os.getenv("QINGBU_APPID", "")
SECRET = os.getenv("QINGBU_SECRET", "")
ENV_ID = os.getenv("QINGBU_ENV_ID", "")
ADMIN_TOKEN = os.getenv("FEEDBACK_ADMIN_TOKEN", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
SESSION_SECRET = os.getenv("SESSION_SECRET", "")

# 启动时校验必要配置（友好提示，不抛 traceback）
_MISSING = [k for k, v in {
    "QINGBU_APPID": APPID,
    "QINGBU_SECRET": SECRET,
    "QINGBU_ENV_ID": ENV_ID,
    "FEEDBACK_ADMIN_TOKEN": ADMIN_TOKEN,
    "ADMIN_PASSWORD": ADMIN_PASSWORD,
    "SESSION_SECRET": SESSION_SECRET,
}.items() if not v]
if _MISSING:
    # 用友好中文提示，不抛 traceback，零基础用户也能看懂
    print("")
    print("=" * 60)
    print("  启动失败：配置没填完整")
    print("=" * 60)
    print("")
    print("  以下配置项还是空的（在 admin\\server\\config.env 里填）：")
    for k in _MISSING:
        print("    - " + k)
    print("")
    print("  填好后保存，再双击 start.bat")
    print("")
    import sys
    sys.exit(1)

app = Flask(__name__, static_folder=None)
app.secret_key = SESSION_SECRET
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("FORCE_HTTPS", "0") == "1",  # 上线 HTTPS 后设 1
    PERMANENT_SESSION_LIFETIME=3600 * 8,  # 8 小时
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("feedback-admin")


# ============================================================
# access_token 线程安全缓存
# ============================================================
_token_lock = threading.Lock()
_token_cache = {"token": "", "expires_at": 0}


def get_access_token():
    """获取并缓存微信 access_token（有效期 7200 秒，提前 5 分钟刷新）"""
    with _token_lock:
        now = time.time()
        if _token_cache["token"] and now < _token_cache["expires_at"] - 300:
            return _token_cache["token"]

        url = (
            "https://api.weixin.qq.com/cgi-bin/token"
            f"?grant_type=client_credential&appid={APPID}&secret={SECRET}"
        )
        resp = requests.get(url, timeout=10)
        data = resp.json()
        if "access_token" not in data:
            errcode = data.get("errcode", "")
            errmsg = data.get("errmsg", "")
            logger.error("获取 access_token 失败: %s %s", errcode, errmsg)
            raise RuntimeError(f"获取 access_token 失败: {errmsg}")
        _token_cache["token"] = data["access_token"]
        _token_cache["expires_at"] = now + data.get("expires_in", 7200)
        logger.info("access_token 已刷新")
        return _token_cache["token"]


def _clear_token_cache():
    """access_token 失效时清缓存，下次重新获取"""
    with _token_lock:
        _token_cache["token"] = ""
        _token_cache["expires_at"] = 0


def invoke_cloud_function(name, data, _retry=True):
    """通过微信 HTTP API 调用云函数。

    正确格式（微信官方文档）：
        POST https://api.weixin.qq.com/tcb/invokecloudfunction
            ?access_token=ACCESS_TOKEN&env=ENV&name=FUNCTION_NAME
        body = 云函数 event（JSON 字符串）

    云函数收到的 event 就是 body 反序列化后的对象。
    注意：env 和 name 必须在 query string，不能在 body，否则报
          "function name foramt invalid"。
    """
    token = get_access_token()
    url = (
        "https://api.weixin.qq.com/tcb/invokecloudfunction"
        f"?access_token={token}&env={ENV_ID}&name={name}"
    )
    # body 就是云函数的 event，用 data= 传原始 JSON 字符串
    body = json.dumps(data, ensure_ascii=False)
    resp = requests.post(url, data=body, timeout=15)
    result = resp.json()

    errcode = result.get("errcode", -1)
    # access_token 过期/失效 → 清缓存重试一次
    if errcode in (40001, 42001) and _retry:
        logger.warning("access_token 失效 (%s)，清缓存重试", errcode)
        _clear_token_cache()
        return invoke_cloud_function(name, data, _retry=False)

    if errcode != 0:
        errmsg = result.get("errmsg", "unknown")
        logger.error("调用云函数 %s 失败: %s %s", name, errcode, errmsg)
        raise RuntimeError(f"调用云函数失败: {errmsg}")

    resp_data = result.get("resp_data", "")
    try:
        return json.loads(resp_data)
    except (json.JSONDecodeError, ValueError):
        logger.error("云函数 %s 返回非 JSON: %s", name, resp_data[:200])
        return {"success": False, "error": "INVALID_RESPONSE"}


# ============================================================
# 登录鉴权
# ============================================================
def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("admin_logged_in"):
            return jsonify({"success": False, "error": "UNAUTHORIZED"}), 401
        return f(*args, **kwargs)
    return wrapper


# ============================================================
# API 路由
# ============================================================
@app.post("/api/admin/login")
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "")
    password = data.get("password", "")
    if not (secrets.compare_digest(username, ADMIN_USERNAME) and
            secrets.compare_digest(password, ADMIN_PASSWORD)):
        logger.warning("登录失败: username=%s", username)
        return jsonify({"success": False, "error": "INVALID_CREDENTIALS"}), 401
    session.permanent = True
    session["admin_logged_in"] = True
    session["username"] = username
    logger.info("管理员登录成功: %s", username)
    return jsonify({"success": True, "username": username})


@app.post("/api/admin/logout")
def logout():
    session.clear()
    return jsonify({"success": True})


@app.get("/api/admin/session")
def check_session():
    if session.get("admin_logged_in"):
        return jsonify({"logged_in": True, "username": session.get("username", "")})
    return jsonify({"logged_in": False}), 401


@app.get("/api/admin/feedback")
@login_required
def list_feedback():
    """获取反馈列表 + 统计（调 listFeedback 云函数）"""
    filter_type = request.args.get("filter", "all")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("page_size", 20, type=int)
    try:
        result = invoke_cloud_function("listFeedback", {
            "adminToken": ADMIN_TOKEN,
            "filter": filter_type,
            "page": page,
            "pageSize": page_size,
        })
        return jsonify(result)
    except RuntimeError as e:
        return jsonify({"success": False, "error": "CLOUD_CALL_FAIL", "message": str(e)}), 502


@app.post("/api/admin/feedback/<fid>/status")
@login_required
def update_status(fid):
    """更新反馈状态（调 updateFeedbackStatus 云函数）"""
    data = request.get_json(silent=True) or {}
    status = data.get("status", "")
    if status not in ("read", "resolved"):
        return jsonify({"success": False, "error": "INVALID_STATUS"}), 400
    try:
        result = invoke_cloud_function("updateFeedbackStatus", {
            "adminToken": ADMIN_TOKEN,
            "id": fid,
            "status": status,
        })
        return jsonify(result)
    except RuntimeError as e:
        return jsonify({"success": False, "error": "CLOUD_CALL_FAIL", "message": str(e)}), 502


# ============================================================
# 健康检查 + 静态网页托管（同源，免 CORS）
# ============================================================
@app.get("/health")
def health():
    return jsonify({"ok": True})


# 让 Flask 同时托管管理员网页（admin/feedback/ 目录），同源调用 API 免 CORS
_WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "feedback")


@app.get("/")
def serve_index():
    return send_from_directory(_WEB_DIR, "index.html")


@app.get("/<path:filename>")
def serve_static(filename):
    """托管 app.js / style.css 等静态文件"""
    # 只允许 feedback 目录下的已知文件，防路径穿越
    safe_files = {"app.js", "style.css"}
    if filename in safe_files:
        return send_from_directory(_WEB_DIR, filename)
    return jsonify({"error": "NOT_FOUND"}), 404


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
