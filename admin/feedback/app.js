/* 轻步 · 用户反馈 管理员网页
 * V2：通过自己的 Flask 服务器中转调云函数（账号密码登录 + session cookie 鉴权）
 * 不再依赖 CloudBase JS SDK / 匿名登录 / Web 安全域名
 */
(function () {
  'use strict';

  var PAGE_SIZE = 20;

  var state = {
    filter: 'all',
    page: 1,
    stats: null,
    list: [],
    loggedIn: false
  };

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  function cacheEls() {
    ['loginPage', 'loginForm', 'loginUser', 'loginPass', 'btnLogin', 'loginError',
     'topbar', 'topUser', 'btnLogout', 'main',
     'statTotal', 'statGood', 'statOkay', 'statDifficult', 'statUnread',
     'list', 'btnPrev', 'btnNext', 'pageInfo', 'toast'
    ].forEach(function (k) { els[k] = $(k); });
  }

  // ---------- 工具 ----------
  function showToast(msg, ms) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    setTimeout(function () { els.toast.classList.add('hidden'); }, ms || 2200);
  }

  function showLoginError(msg) {
    if (!els.loginError) return;
    els.loginError.textContent = msg;
    els.loginError.classList.remove('hidden');
  }
  function hideLoginError() {
    if (els.loginError) els.loginError.classList.add('hidden');
  }

  function showLoginPage() {
    els.loginPage.classList.remove('hidden');
    els.topbar.classList.add('hidden');
    els.main.classList.add('hidden');
    els.loginPass.value = '';
    hideLoginError();
  }

  function showMainPage() {
    els.loginPage.classList.add('hidden');
    els.topbar.classList.remove('hidden');
    els.main.classList.remove('hidden');
  }

  // ---------- fetch 封装（同源，cookie 自动带） ----------
  function apiGet(path) {
    return fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(handleResp);
  }

  function apiPost(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body ? JSON.stringify(body) : '{}'
    }).then(handleResp);
  }

  function handleResp(resp) {
    return resp.json().then(function (data) {
      if (resp.status === 401) {
        // session 失效 → 回登录页
        state.loggedIn = false;
        showLoginPage();
        return { success: false, error: 'UNAUTHORIZED' };
      }
      return data;
    }).catch(function () {
      return { success: false, error: 'NETWORK_ERROR' };
    });
  }

  // ---------- 登录 ----------
  function doLogin(e) {
    if (e) e.preventDefault();
    var username = (els.loginUser.value || '').trim();
    var password = els.loginPass.value || '';
    if (!username || !password) {
      showLoginError('请填写账号和密码');
      return;
    }
    els.btnLogin.disabled = true;
    els.btnLogin.textContent = '登录中...';
    hideLoginError();

    apiPost('/api/admin/login', { username: username, password: password }).then(function (r) {
      els.btnLogin.disabled = false;
      els.btnLogin.textContent = '登录';
      if (r && r.success === true) {
        state.loggedIn = true;
        els.topUser.textContent = r.username || username;
        showMainPage();
        loadList();
      } else {
        showLoginError('账号或密码不正确');
      }
    }).catch(function () {
      els.btnLogin.disabled = false;
      els.btnLogin.textContent = '登录';
      showLoginError('网络异常，请稍后再试');
    });
  }

  function doLogout() {
    apiPost('/api/admin/logout').then(function () {
      state.loggedIn = false;
      showLoginPage();
    }).catch(function () { showLoginPage(); });
  }

  // ---------- 渲染 ----------
  var RATING_LABEL = { good: '很好用', okay: '还可以', difficult: '有点麻烦' };
  var STATUS_LABEL = { new: '未读', read: '已读', resolved: '已处理' };
  var STATUS_CLASS = { new: 'st-new', read: 'st-read', resolved: 'st-resolved' };

  function renderStats() {
    var s = state.stats || { total: 0, good: 0, okay: 0, difficult: 0, unread: 0 };
    els.statTotal.textContent = s.total;
    els.statGood.textContent = s.good;
    els.statOkay.textContent = s.okay;
    els.statDifficult.textContent = s.difficult;
    els.statUnread.textContent = s.unread;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
    } catch (e) { return iso; }
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderList() {
    if (!state.list || state.list.length === 0) {
      els.list.innerHTML = '<div class="empty muted">这里还没有反馈。</div>';
      return;
    }
    var html = '';
    state.list.forEach(function (it) {
      var ratingLabel = RATING_LABEL[it.rating] || it.rating;
      var statusLabel = STATUS_LABEL[it.status] || it.status;
      var statusClass = STATUS_CLASS[it.status] || 'st-new';
      var content = it.content && it.content.length > 0 ? esc(it.content) : '<span class="muted">（没有填写文字内容）</span>';
      var actions = '';
      if (it.status === 'new') {
        actions = '<button class="btn-secondary sm" data-act="read" data-id="' + esc(it.id) + '">标记已读</button>'
                + '<button class="btn-secondary sm" data-act="resolved" data-id="' + esc(it.id) + '">标记已处理</button>';
      } else if (it.status === 'read') {
        actions = '<button class="btn-secondary sm" data-act="resolved" data-id="' + esc(it.id) + '">标记已处理</button>';
      } else {
        actions = '<span class="muted small">已处理</span>';
      }
      html += ''
        + '<div class="fb-item ' + statusClass + '">'
        + '  <div class="fb-head">'
        + '    <span class="fb-tag ' + it.rating + '">' + esc(ratingLabel) + '</span>'
        + '    <span class="fb-status ' + statusClass + '">' + esc(statusLabel) + '</span>'
        + '    <span class="fb-time muted">' + esc(fmtTime(it.createdAt)) + '</span>'
        + '  </div>'
        + '  <div class="fb-content">' + content + '</div>'
        + '  <div class="fb-meta muted">'
        + '    <span>用户：' + esc(it.anonymousUserIdMasked || '') + '</span>'
        + '    <span>版本：' + esc(it.appVersion || '—') + '</span>'
        + '  </div>'
        + '  <div class="fb-actions">' + actions + '</div>'
        + '</div>';
    });
    els.list.innerHTML = html;
  }

  function renderPager() {
    els.pageInfo.textContent = '第 ' + state.page + ' 页';
    els.btnPrev.disabled = state.page <= 1;
    els.btnNext.disabled = !state.list || state.list.length < PAGE_SIZE;
  }

  // ---------- 数据 ----------
  function loadList() {
    els.list.innerHTML = '<div class="empty muted">加载中...</div>';
    apiGet('/api/admin/feedback?filter=' + encodeURIComponent(state.filter) +
           '&page=' + state.page + '&page_size=' + PAGE_SIZE).then(function (r) {
      if (!r || r.success !== true) {
        if (r && r.error === 'UNAUTHORIZED') return;  // 已被 handleResp 跳转登录
        showToast('加载失败：' + (r && r.error ? r.error : '未知错误'));
        state.list = [];
        state.stats = r && r.stats ? r.stats : state.stats;
        renderList();
        return;
      }
      state.stats = r.stats || state.stats;
      state.list = r.list || [];
      renderStats();
      renderList();
      renderPager();
    });
  }

  function updateStatus(id, status) {
    apiPost('/api/admin/feedback/' + encodeURIComponent(id) + '/status', { status: status }).then(function (r) {
      if (r && r.success === true) {
        showToast('已更新');
        loadList();
      } else if (r && r.error === 'UNAUTHORIZED') {
        return;
      } else {
        showToast('更新失败：' + (r && r.error ? r.error : '未知错误'));
      }
    });
  }

  // ---------- 事件 ----------
  function bindEvents() {
    els.loginForm.addEventListener('submit', doLogin);
    els.btnLogout.addEventListener('click', doLogout);

    // 筛选
    Array.prototype.forEach.call(document.querySelectorAll('.filter-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var f = btn.getAttribute('data-filter');
        if (state.filter === f) return;
        state.filter = f;
        state.page = 1;
        Array.prototype.forEach.call(document.querySelectorAll('.filter-btn'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        loadList();
      });
    });

    els.btnPrev.addEventListener('click', function () {
      if (state.page <= 1) return;
      state.page--;
      loadList();
    });
    els.btnNext.addEventListener('click', function () {
      if (!state.list || state.list.length < PAGE_SIZE) return;
      state.page++;
      loadList();
    });

    // 列表内按钮（事件委托）
    els.list.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      var btn = t.closest ? t.closest('button[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      if (!act || !id) return;
      if (act === 'read') updateStatus(id, 'read');
      else if (act === 'resolved') updateStatus(id, 'resolved');
    });
  }

  // ---------- 启动：先检查 session ----------
  document.addEventListener('DOMContentLoaded', function () {
    cacheEls();
    bindEvents();
    apiGet('/api/admin/session').then(function (r) {
      if (r && r.logged_in === true) {
        state.loggedIn = true;
        els.topUser.textContent = r.username || '';
        showMainPage();
        loadList();
      } else {
        showLoginPage();
      }
    }).catch(function () {
      showLoginPage();
    });
  });
})();
