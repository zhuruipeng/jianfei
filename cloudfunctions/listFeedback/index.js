// cloudfunctions/listFeedback/index.js
// V1：管理员反馈列表 + 统计
// 鉴权：服务端校验 adminToken（环境变量 FEEDBACK_ADMIN_TOKEN），与前端隐藏无关
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const VALID_FILTERS = ['all', 'good', 'okay', 'difficult', 'unread'];
const RATING_LABEL = { good: '很好用', okay: '还可以', difficult: '有点麻烦' };

function maskUserId(uid) {
  if (!uid || typeof uid !== 'string') return '';
  if (uid.length <= 6) return uid;
  return uid.slice(0, 6) + '****';
}

function isAdmin(event) {
  const token = process.env.FEEDBACK_ADMIN_TOKEN;
  if (!token) return false;
  const input = event && event.adminToken;
  if (typeof input !== 'string' || input.length === 0) return false;
  if (input.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= input.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

exports.main = async (event, context) => {
  if (!isAdmin(event)) {
    return { success: false, code: 'UNAUTHORIZED', msg: '无权访问' };
  }
  const filter = (event && VALID_FILTERS.indexOf(event.filter) !== -1) ? event.filter : 'all';
  const page = Math.max(1, parseInt(event && event.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(event && event.pageSize, 10) || 20));

  // 构造查询条件
  let where = {};
  if (filter === 'good' || filter === 'okay' || filter === 'difficult') {
    where.rating = filter;
  } else if (filter === 'unread') {
    where.status = 'new';
  }

  // 统计：全部 + 各 rating + 未读
  let stats = { total: 0, good: 0, okay: 0, difficult: 0, unread: 0 };
  try {
    const tasks = [
      db.collection('feedback').count(),
      db.collection('feedback').where({ rating: 'good' }).count(),
      db.collection('feedback').where({ rating: 'okay' }).count(),
      db.collection('feedback').where({ rating: 'difficult' }).count(),
      db.collection('feedback').where({ status: 'new' }).count()
    ];
    const [t, g, o, d, u] = await Promise.all(tasks);
    stats.total = t.total; stats.good = g.total; stats.okay = o.total; stats.difficult = d.total; stats.unread = u.total;
  } catch (e) {
    console.warn('[listFeedback] stats failed', e && e.message);
  }

  // 列表：时间倒序
  let list = [];
  try {
    const skip = (page - 1) * pageSize;
    const r = await db.collection('feedback').where(where).orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();
    list = (r.data || []).map(item => ({
      id: item.id || item._id,
      anonymousUserIdMasked: maskUserId(item.anonymousUserId),
      rating: item.rating,
      ratingLabel: RATING_LABEL[item.rating] || item.rating,
      content: item.content || '',
      appVersion: item.appVersion || '',
      createdAt: item.createdAt,
      status: item.status || 'new'
    }));
  } catch (e) {
    console.error('[listFeedback] list failed', e && e.message);
    return { success: false, code: 'DB_READ_FAIL', msg: '读取失败' };
  }

  return {
    success: true,
    code: 'OK',
    filter,
    page,
    pageSize,
    stats,
    list
  };
};
