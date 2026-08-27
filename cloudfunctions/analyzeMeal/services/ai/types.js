// services/ai/types.js - 独立适配层：内部类型（给 analyzer/provider 使用）
// （云函数是 Node.js CommonJS，不跑 tsc，这里仅用作运行时常量 + 白名单枚举集合）

const PORTION_LEVEL_SET = new Set(['light', 'appropriate', 'heavy', 'unknown']);
const VEG_SET = new Set(['low', 'adequate', 'unknown']);
const PROTEIN_SET = VEG_SET;
const STAPLE_SET = new Set(['low', 'adequate', 'high', 'unknown']);
const SUGARY_SET = new Set(['yes', 'no', 'unknown']);
const CONFIDENCE_SET = new Set(['low', 'medium', 'high']);

const DEFAULT_ANALYSIS = {
  foods: [],
  portionLevel: 'unknown',
  vegetables: 'unknown',
  protein: 'unknown',
  stapleFood: 'unknown',
  sugaryDrink: 'unknown',
  summary: '',
  primarySuggestion: '',
  confidence: 'low',
  analyzedAt: '',
};

module.exports = {
  PORTION_LEVEL_SET,
  VEG_SET,
  PROTEIN_SET,
  STAPLE_SET,
  SUGARY_SET,
  CONFIDENCE_SET,
  DEFAULT_ANALYSIS,
};
