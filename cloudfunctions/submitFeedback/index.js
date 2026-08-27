// cloudfunctions/submitFeedback/index.js
// V1：用户反馈云端提交
// 安全承诺：
//   - 只接收 anonymousUserId / rating / content / appVersion，拒绝任何其他业务数据
//   - 防重复：同 anonymousUserId + 同 rating + 同 content 60秒内幂等
//   - 失败不写入，返回明确错误码供前端进 pending 队列
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const VALID_RATINGS = ['good', 'okay', 'difficult'];
const CONTENT_MAX = 300;
const DEDUP_WINDOW_MS = 60 * 1000;

function nowISO() {
  return new Date().toISOString();
}

function genId() {
  return 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function sanitize(input) {
  const allowed = { anonymousUserId: 1, rating: 1, content: 1, appVersion: 1, createdAt: 1, id: 1 };
  const out = {};
  for (const k of Object.keys(input || {})) {
    if (allowed[k]) out[k] = input[k];
  }
  return out;
}

function validate(event) {
  const errors = [];
  if (!event || typeof event.anonymousUserId !== 'string' || event.anonymousUserId.length === 0) {
    errors.push('anonymousUserId required');
  }
  if (!event || VALID_RATINGS.indexOf(event.rating) === -1) {
    errors.push('rating invalid');
  }
  if (event && event.content != null) {
    if (typeof event.content !== 'string') errors.push('content must be string');
    else if (event.content.length > CONTENT_MAX) errors.push('content too long');
  }
  return errors;
}

exports.main = async (event, context) => {
  // 1. 仅保留白名单字段
  const data = sanitize(event);
  // 2. 校验
  const errors = validate(data);
  if (errors.length > 0) {
    return { success: false, code: 'INVALID', msg: '参数不合法', errors };
  }
  // 3. 补全 id / createdAt / status
  if (!data.id) data.id = genId();
  if (!data.createdAt) data.createdAt = nowISO();
  data.status = 'new';
  // 4. 防重复：60秒内同用户同 rating 同 content → 幂等返回已有 id
  try {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const dup = await db.collection('feedback').where({
      anonymousUserId: data.anonymousUserId,
      rating: data.rating,
      content: data.content || '',
      createdAt: db.command.gte(since)
    }).limit(1).get();
    if (dup.data && dup.data.length > 0) {
      return { success: true, code: 'DUPLICATE', id: dup.data[0].id, msg: '已收到（重复提交已合并）' };
    }
  } catch (e) {
    // 防重查询失败不阻断主流程
    console.warn('[submitFeedback] dedup query failed', e && e.message);
  }
  // 5. 写入
  try {
    await db.collection('feedback').add({ data });
    // 最小日志：不写完整正文
    console.log('[submitFeedback] feedback submitted', data.id, data.rating, data.anonymousUserId);
    return { success: true, code: 'OK', id: data.id };
  } catch (e) {
    console.error('[submitFeedback] db.add failed', e && e.message);
    return { success: false, code: 'DB_WRITE_FAIL', msg: '保存失败' };
  }
};
