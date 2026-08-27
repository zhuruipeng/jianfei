// cloudfunctions/updateFeedbackStatus/index.js
// V1：管理员更新反馈状态 new → read → resolved
// 鉴权：服务端校验 adminToken
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const VALID_STATUS = ['new', 'read', 'resolved'];

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
  const id = event && event.id;
  const status = event && event.status;
  if (!id || typeof id !== 'string') {
    return { success: false, code: 'INVALID', msg: '缺少 id' };
  }
  if (VALID_STATUS.indexOf(status) === -1) {
    return { success: false, code: 'INVALID', msg: '状态不合法' };
  }
  try {
    // 按 id 更新（id 是业务 id，不是 _id）
    const r = await db.collection('feedback').where({ id }).limit(1).get();
    if (!r.data || r.data.length === 0) {
      return { success: false, code: 'NOT_FOUND', msg: '反馈不存在' };
    }
    const docId = r.data[0]._id;
    await db.collection('feedback').doc(docId).update({ data: { status } });
    console.log('[updateFeedbackStatus] updated', id, '->', status);
    return { success: true, code: 'OK', id, status };
  } catch (e) {
    console.error('[updateFeedbackStatus] failed', e && e.message);
    return { success: false, code: 'DB_UPDATE_FAIL', msg: '更新失败' };
  }
};
