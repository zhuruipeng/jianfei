// services/ai/provider.js - OpenAI Chat Completions 兼容视觉模型层（可切通义/豆包/DeepSeek）
// 切换方式：改云函数环境变量 AI_BASE_URL / AI_MODEL / AI_API_KEY 即可。
// ⚠️ 密钥只在此模块读 process.env；永远不要打印或返回给前端。
const https = require('https');
const { URL } = require('url');

/** 配置（优先环境变量）*/
function readProviderConfig() {
  const key = (process.env.AI_API_KEY || '').trim();
  const base = (process.env.AI_BASE_URL || '').trim().replace(/\/$/, '');
  const model = (process.env.AI_MODEL || '').trim();
  return {
    apiKey: key,
    baseUrl: base || 'https://api.openai.com',
    model: model || 'gpt-4o-mini',
  };
}

/** 做一次 HTTPS JSON 请求（这里只用于调用自己的 AI Provider，超时 60s）*/
function httpsJsonRequest(options) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(options.url);
      const req = https.request({
        method: options.method || 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + (u.search || ''),
        headers: options.headers || {},
        timeout: options.timeout || 60000,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data || 'null'); } catch (e) { /* ignore */ }
          resolve({ statusCode: res.statusCode || 0, body: json, rawText: data });
        });
      });
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch (e) { /* ignore */ } });
      req.on('error', (err) => reject(err));
      if (options.body) req.write(options.body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 调用视觉模型：messages 标准 OpenAI 风格；统一返回 { ok, content, error }
 * @param {Array<any>} messages  [{ role:'system', content:string }, { role:'user', content:[{type:'text',text:''}, {type:'image_url', image_url:{url:''}}] }]
 * @param {object} opts { temperature, maxTokens, responseFormatJson? }
 */
async function callChat(messages, opts) {
  const cfg = readProviderConfig();
  if (!cfg.apiKey) {
    return { ok: false, error: 'AI_NOT_CONFIGURED' };
  }
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.2;
  const maxTokens = typeof opts.maxTokens === 'number' ? opts.maxTokens : 900;
  const bodyObj = {
    model: cfg.model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };
  if (opts && opts.responseFormatJson === true) {
    // gpt-4o/兼容模型支持 response_format={type:'json_object'}；不支持的厂商会自动忽略也不报错
    bodyObj.response_format = { type: 'json_object' };
  }
  const url = `${cfg.baseUrl}/v1/chat/completions`;
  const bodyStr = JSON.stringify(bodyObj);
  try {
    const resp = await httpsJsonRequest({
      method: 'POST',
      url,
      timeout: 70000,
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });
    // 不打印 resp.body，避免把敏感内容漏到日志
    if (resp.statusCode >= 200 && resp.statusCode < 300 && resp.body && resp.body.choices && Array.isArray(resp.body.choices)) {
      const first = resp.body.choices[0] || {};
      const msg = first.message || {};
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content && content.length > 0) return { ok: true, content, model: cfg.model };
    }
    // 错误：只保留错误类型（statusCode / code 标签），绝不把原始 body 带到上层
    const errCode = resp.body && resp.body.error && typeof resp.body.error.code === 'string'
      ? resp.body.error.code
      : 'HTTP_' + (resp.statusCode || 0);
    return { ok: false, error: errCode };
  } catch (e) {
    const tag = (e && e.message && /timeout/i.test(String(e.message))) ? 'TIMEOUT' : 'NETWORK';
    return { ok: false, error: tag };
  }
}

module.exports = {
  readProviderConfig,
  callChat,
};
