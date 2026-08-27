// services/ai/mealAnalyzer.js - 业务唯一入口：analyzeMeal(input)
// 职责：Prompt 组装 + 视觉模型调用 + JSON 解析 + 严格枚举校验
// 规则：
//  - 永远不输出精确卡路里、克数、分数
//  - 无法确认的字段返回 unknown / 空数组，绝不乱猜
//  - 永远只给 1 条 primarySuggestion（温和语气，不羞辱）
//  - 非饮食照片：全 unknown + summary 写"无法确认这是一张可分析的饮食照片"

const { callChat } = require('./provider');
const {
  PORTION_LEVEL_SET,
  VEG_SET,
  PROTEIN_SET,
  STAPLE_SET,
  SUGARY_SET,
  CONFIDENCE_SET,
  DEFAULT_ANALYSIS,
} = require('./types');

const SATIETY_LABEL_CN = {
  seven_tenths: '用户自己感觉约七分饱',
  just_right:   '用户自己感觉刚刚好',
  a_little_full: '用户自己感觉有点撑',
  overfull:     '用户自己感觉吃撑了',
};

function pad(n) { return String(n).padStart(2, '0'); }
function getAnalyzedAt(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 把客户端枚举（标签/饱腹）转 AI 易理解中文，保持短句 */
function buildContextText(ctx) {
  const lines = [];
  if (ctx.mealType && typeof ctx.mealType === 'string') {
    const mt = { breakfast: '这是用户的「早餐」记录', lunch: '这是用户的「午餐」记录', dinner: '这是用户的「晚餐」记录' }[ctx.mealType];
    if (mt) lines.push(mt);
  }
  if (ctx.foodText && typeof ctx.foodText === 'string' && ctx.foodText.trim().length > 0) {
    lines.push(`用户填写的食物：${ctx.foodText.trim()}`);
  }
  if (ctx.satietyLevel && SATIETY_LABEL_CN[ctx.satietyLevel]) {
    lines.push(SATIETY_LABEL_CN[ctx.satietyLevel]);
  }
  if (Array.isArray(ctx.tagLabels) && ctx.tagLabels.length > 0) {
    lines.push(`用户标记的结构标签：${ctx.tagLabels.join('、')}。这些辅助你判断结构，请不要忽略。`);
  }
  if (lines.length === 0) {
    lines.push('（用户没有填写额外的文字说明，请主要根据照片谨慎判断。）');
  }
  return lines.join('\n');
}

/** 系统指令（严格定性，不精确数字，不羞辱，unknown 优先） */
const SYSTEM_PROMPT = `你是一个饮食记录辅助工具。
你的任务不是进行医学诊断，也不是提供精确热量或重量计算。
只根据用户提供的饮食照片和文字记录，完成：
1. 只列出你能合理确认的主要食物（foods 数组，看不清不要勉强写）。
2. 粗略判断这一餐整体分量（portionLevel）：light=偏少，appropriate=合适，heavy=偏多，unknown=无法判断。
3. 判断蔬菜量（vegetables）、蛋白质量（protein）、主食量（stapleFood）的大致结构，无法判断一律 unknown。
4. 是否含糖饮料（sugaryDrink）：yes/no/unknown。
5. summary：用一两句简短中文，温和地描述你对这一餐的观察（不要给数字，不要打分）。
6. primarySuggestion：只给一条、最多40字、非常温和、容易执行的下一餐小调整建议；如果整体已经非常均衡就写"下一餐保持类似搭配就很好"之类的正向反馈。
规则：
- 无法确认的必须返回 unknown，不要猜测。
- 不要输出任何精确卡路里、克数、营养素数值、分数、等级。
- 不要推荐极端节食或惩罚式建议，不要因为一顿饭评价用户的减肥成功或失败。
- 如果你无法确认这是一张可以分析的饮食照片（比如人物、风景、宠物、截图、空盘子、极模糊）：
  foods=[]，portionLevel/vegetables/protein/stapleFood/sugaryDrink 全部 unknown，
  summary="暂时无法确认这是一张可以分析的饮食照片"，primarySuggestion="下次可以把饭菜拍得更清晰一点就更好啦"，confidence=low。
输出必须是纯 JSON 对象（不要代码块，不要 Markdown，不要多余文字），严格符合 schema。`;

/** JSON schema 描述（写入 user 提示，辅助模型对齐枚举） */
const SCHEMA_HINT = `严格按以下 JSON Schema 输出：
{
  "foods": string[],                 // 只列能合理确认的主食/菜/肉/饮料等，最多 10 项
  "portionLevel": "light"|"appropriate"|"heavy"|"unknown",
  "vegetables": "low"|"adequate"|"unknown",
  "protein": "low"|"adequate"|"unknown",
  "stapleFood": "low"|"adequate"|"high"|"unknown",
  "sugaryDrink": "yes"|"no"|"unknown",
  "summary": string,                 // 1~2 句中文观察
  "primarySuggestion": string,       // 仅 1 条，最多 40 字，温和
  "confidence": "low"|"medium"|"high"
}
不需要输出 analyzedAt 字段。`;

/** 二次 normalize AI 输出：白名单校验、兜底 unknown、文本长度限制。失败返回 null */
function normalizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw;
  const foodsArr = Array.isArray(r.foods) ? r.foods.filter(x => typeof x === 'string' && x.trim().length > 0) : [];
  const foods = foodsArr.slice(0, 10).map(s => String(s).trim().slice(0, 20));
  const portionLevel = PORTION_LEVEL_SET.has(r.portionLevel) ? r.portionLevel : 'unknown';
  const vegetables = VEG_SET.has(r.vegetables) ? r.vegetables : 'unknown';
  const protein = PROTEIN_SET.has(r.protein) ? r.protein : 'unknown';
  const stapleFood = STAPLE_SET.has(r.stapleFood) ? r.stapleFood : 'unknown';
  const sugaryDrink = SUGARY_SET.has(r.sugaryDrink) ? r.sugaryDrink : 'unknown';
  let summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (summary.length === 0) summary = '（没有可总结的观察）';
  summary = summary.slice(0, 160);
  let primarySuggestion = typeof r.primarySuggestion === 'string' ? r.primarySuggestion.trim() : '';
  if (primarySuggestion.length === 0) primarySuggestion = '下一餐保持轻松心态就很好，不必追求完美。';
  primarySuggestion = primarySuggestion.slice(0, 80);
  const confidence = CONFIDENCE_SET.has(r.confidence) ? r.confidence : 'low';
  // 过滤可能泄露的数字型结论（简单 heuristic：不允许"kcal/卡路/g/克"出现在总结/建议里）
  const strip = (s) => s.replace(/\d+\s*kcal/ig, '').replace(/\d+\s*卡/g, '').replace(/\d+\s*g/g, '').replace(/\d+\s*克/g, '');
  return {
    foods,
    portionLevel,
    vegetables,
    protein,
    stapleFood,
    sugaryDrink,
    summary: strip(summary),
    primarySuggestion: strip(primarySuggestion),
    confidence,
  };
}

/** 尝试从文本里提取 JSON（兼容模型偶尔先讲一句话再给 JSON） */
function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (e) { /* ignore */ }
  const idx = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (idx === -1 || last === -1 || last <= idx) return null;
  const slice = text.substring(idx, last + 1);
  try { return JSON.parse(slice); } catch (e) { return null; }
}

/**
 * 主入口：analyzeMeal
 * @param {object} input
 * @param {string} input.imageUrl - 临时可访问的私有图片 URL（由云函数自己生成，到期失效，不永久公开）
 * @param {string} input.mealType - breakfast/lunch/dinner
 * @param {string} [input.foodText] - 用户自填文字
 * @param {string} [input.satietyLevel] - 用户饱腹枚举
 * @param {string[]} [input.tagLabels] - 用户选中的标签中文名（已转）
 * @returns {Promise<{ok:boolean, analysis?: object, error?: string, model?: string}>}
 */
async function analyzeMeal(input) {
  if (!input || !input.imageUrl || typeof input.imageUrl !== 'string') {
    return { ok: false, error: 'NO_IMAGE' };
  }
  const ctxText = buildContextText({
    mealType: input.mealType,
    foodText: input.foodText,
    satietyLevel: input.satietyLevel,
    tagLabels: input.tagLabels,
  });

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: `${SCHEMA_HINT}\n\n用户补充信息：\n${ctxText}` },
        { type: 'image_url', image_url: { url: input.imageUrl, detail: 'low' } },
      ],
    },
  ];

  const res = await callChat(messages, { temperature: 0.2, maxTokens: 900, responseFormatJson: true });
  if (!res.ok) {
    return { ok: false, error: res.error || 'PROVIDER_FAILED' };
  }
  const parsed = extractJSON(res.content);
  const normalized = normalizeAnalysis(parsed);
  if (!normalized) {
    return { ok: false, error: 'INVALID_JSON' };
  }
  const analysis = {
    ...DEFAULT_ANALYSIS,
    ...normalized,
    analyzedAt: getAnalyzedAt(new Date()),
  };
  return { ok: true, analysis, model: res.model };
}

module.exports = {
  analyzeMeal,
  // 导出给单测/未来校验
  _normalizeAnalysis: normalizeAnalysis,
  _extractJSON: extractJSON,
  _getAnalyzedAt: getAnalyzedAt,
  _buildContextText: buildContextText,
};
