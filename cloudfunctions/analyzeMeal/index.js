// cloudfunctions/analyzeMeal/index.js
// 云函数入口：V7 接入 AI 饮食分析 V1。
// 安全承诺：
//   - AI API Key 只从云函数环境变量（process.env.AI_API_KEY / AI_BASE_URL / AI_MODEL）读取
//   - 永远不把 key / 鉴权 / 模型原始响应 / 堆栈回传给前端
//   - 私有云图只生成临时下载 URL 传给视觉模型；不落永久公开地址
//   - 最小调用日志（anonymousUserId / mealRecordId / model / requestedAt / success / duration）
const cloud = require('wx-server-sdk');
const { analyzeMeal } = require('./services/ai/mealAnalyzer');
const { readProviderConfig } = require('./services/ai/provider');

// 最小后端 analyzing 防重锁：内存 LRU（同一次冷启动内），若 DB 可用则用 DB 兜底
const LRU = new Map(); // key = mealRecordId, value = { untilMs: number }
const LRU_TTL_MS = 120000;
function isAnalyzingLocal(mealRecordId) {
  const v = LRU.get(mealRecordId);
  if (!v) return false;
  if (Date.now() > v.untilMs) { LRU.delete(mealRecordId); return false; }
  return true;
}
function markAnalyzingLocal(mealRecordId) {
  LRU.set(mealRecordId, { untilMs: Date.now() + LRU_TTL_MS });
}
function clearAnalyzingLocal(mealRecordId) {
  LRU.delete(mealRecordId);
}

try {
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
} catch (e) {
  // ignore; 某些 SDK 环境下 init 失败也能跑，这里不 crash
}

/** 脱敏：永远只给前端这一句失败文案 */
const FAIL_MESSAGE = '这次没有分析成功，你的饮食记录和照片都已经保存，可以稍后重新试一次。';

// 标签键 -> 中文
const TAG_CN = {
  has_vegetables: '有蔬菜',
  has_protein:    '有蛋白质',
  has_staple:     '有主食',
  has_soup:       '有汤/粥/液体较多',
  has_fruit:      '有水果',
  has_snack:      '有零食',
  has_sugary:     '有明显高糖',
  has_oil:        '有明显高油',
  eating_out:     '外卖/外食',
};

function toTagCnList(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    if (TAG_CN[t]) out.push(TAG_CN[t]);
  }
  return out;
}

exports.main = async (event) => {
  const startedAt = Date.now();
  const mealRecordId = event && typeof event.mealRecordId === 'string' ? event.mealRecordId : '';
  const cloudImageId = event && typeof event.cloudImageId === 'string' ? event.cloudImageId : '';
  const anonymousUserId = event && typeof event.anonymousUserId === 'string' ? event.anonymousUserId : '';
  const mealType = event && typeof event.mealType === 'string' ? event.mealType : '';
  const foodText = event && typeof event.foodText === 'string' ? event.foodText : '';
  const satietyLevel = event && typeof event.satietyLevel === 'string' ? event.satietyLevel : '';
  const tagKeys = Array.isArray(event && event.tags) ? event.tags : [];
  const tagLabels = toTagCnList(tagKeys);

  // --------- 参数校验（空值直接返回 error，避免后续浪费调用） ---------
  if (!mealRecordId || !cloudImageId) {
    return { success: false, status: 'error', message: FAIL_MESSAGE };
  }

  // --------- 后端 analyzing 防重：本地 LRU 优先 + DB 兜底 ---------
  if (isAnalyzingLocal(mealRecordId)) {
    writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: false, durationMs: Date.now() - startedAt, model: '', error: 'LOCKED_LOCAL' });
    return { success: false, status: 'error', message: FAIL_MESSAGE };
  }
  markAnalyzingLocal(mealRecordId);
  let dbLockCleared = false;
  try {
    const db = cloud.database();
    const lockId = `lock_${mealRecordId}`;
    // 写入锁：2 分钟后过期（这里以 createdAt 判断，DB TTL 若后续开通可自动清理）
    try {
      await db.collection('ai_locks').add({
        data: { _id: lockId, mealRecordId, createdAt: Date.now(), until: Date.now() + LRU_TTL_MS },
      });
    } catch (addErr) {
      // 已存在或集合不存在：已存在直接拒；集合不存在忽略（继续走 LRU）
      if (addErr && addErr.errCode === -501001) {
        // duplicate: 视为 analyzing
        clearAnalyzingLocal(mealRecordId);
        writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: false, durationMs: Date.now() - startedAt, model: '', error: 'LOCKED_DB' });
        return { success: false, status: 'error', message: FAIL_MESSAGE };
      }
      // 其它错误（比如没开 DB/集合不存在）：不影响主流程，继续
    }

    // --------- 环境变量检查 ---------
    const cfg = readProviderConfig();
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
      writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: false, durationMs: Date.now() - startedAt, model: cfg.model, error: 'AI_NOT_CONFIGURED' });
      return { success: false, status: 'error', message: FAIL_MESSAGE };
    }

    // --------- 私有云图临时下载 URL（不要公开永久地址） ---------
    let tempImageUrl = '';
    try {
      const tmp = await cloud.getTempFileURL({ fileList: [cloudImageId] });
      const item = Array.isArray(tmp.fileList) ? tmp.fileList[0] : null;
      if (item && item.status === 0 && item.tempFileURL) {
        tempImageUrl = item.tempFileURL;
      } else {
        writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: false, durationMs: Date.now() - startedAt, model: cfg.model, error: 'GET_TEMP_URL' });
        return { success: false, status: 'error', message: FAIL_MESSAGE };
      }
    } catch (e) {
      writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: false, durationMs: Date.now() - startedAt, model: cfg.model, error: 'TEMP_URL_EXCEPTION' });
      return { success: false, status: 'error', message: FAIL_MESSAGE };
    }

    // --------- 调独立适配层 analyzeMeal ---------
    const analyzerRes = await analyzeMeal({
      imageUrl: tempImageUrl,
      mealType: mealType,
      foodText: foodText,
      satietyLevel: satietyLevel,
      tagLabels,
    });
    if (!analyzerRes.ok || !analyzerRes.analysis) {
      writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: false, durationMs: Date.now() - startedAt, model: analyzerRes.model || cfg.model, error: analyzerRes.error || 'ANALYZER_FAILED' });
      return { success: false, status: 'error', message: FAIL_MESSAGE };
    }

    writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: true, durationMs: Date.now() - startedAt, model: analyzerRes.model || cfg.model });
    return { success: true, status: 'ok', analysis: analyzerRes.analysis };
  } catch (e) {
    // 兜底：任何异常 → 脱敏，不写分析
    writeMinimalLog({ anonymousUserId, mealRecordId, requestedAt: new Date().toISOString(), success: false, durationMs: Date.now() - startedAt, model: '', error: 'UNEXPECTED' });
    return { success: false, status: 'error', message: FAIL_MESSAGE };
  } finally {
    clearAnalyzingLocal(mealRecordId);
    // 清理 DB 锁
    try {
      if (!dbLockCleared) {
        const db = cloud.database();
        const lockId = `lock_${mealRecordId}`;
        // 不 await：即使删失败也会在 2 分钟后自动过期
        db.collection('ai_locks').doc(lockId).remove().catch(() => { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }
};

/** 最小调用日志（结构化）：不打印图片、不打印 Key、不打印 Authorization、不打印整段饮食文本
 *  记录字段：anonymousUserId / mealRecordId / model / requestedAt / success / durationMs / error?
 */
function writeMinimalLog(rec) {
  try {
    console.info('[ai_call]', JSON.stringify({
      u: rec.anonymousUserId || '',
      m: rec.mealRecordId || '',
      model: rec.model || '',
      at: rec.requestedAt || new Date().toISOString(),
      ok: rec.success === true,
      ms: typeof rec.durationMs === 'number' ? rec.durationMs : 0,
      err: rec.error || '',
    }));
  } catch (e) { /* ignore */ }
}
