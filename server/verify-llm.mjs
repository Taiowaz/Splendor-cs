// 验证环境变量里配置的 LLM 接口能否用作游戏 AI。
// 配好三个环境变量后运行：npm run verify:llm
//   LLM_API_KEY   密钥（只放服务端，绝不进客户端 / 仓库）
//   LLM_BASE_URL  OpenAI 兼容接口根地址（以 /v1 结尾，脚本自动补 /chat/completions）
//   LLM_MODEL     模型名（填你的服务商给的那个名字）

const KEY = process.env.LLM_API_KEY
const BASE = process.env.LLM_BASE_URL
const MODEL = process.env.LLM_MODEL

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }

if (!KEY) fail('缺少 LLM_API_KEY。先 export LLM_API_KEY="你的密钥"')
if (!BASE) fail('缺少 LLM_BASE_URL。先 export LLM_BASE_URL="接口根地址（以 /v1 结尾）"')
if (!MODEL) fail('缺少 LLM_MODEL。先 export LLM_MODEL="模型名"')

const endpoint = BASE.replace(/\/+$/, '') + '/chat/completions'

async function chat(messages, extra = {}) {
  const t0 = Date.now()
  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, ...extra }),
      signal: AbortSignal.timeout(30000),
    })
  } catch (err) {
    fail(`请求失败（${err.name}）：${err.message}｜检查 LLM_BASE_URL 是否正确、网络是否可达`)
  }
  const ms = Date.now() - t0
  const text = await res.text()
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status} ${res.statusText}｜${ms}ms\n${text.slice(0, 600)}`)
    e.status = res.status
    throw e
  }
  let data
  try { data = JSON.parse(text) } catch { fail(`响应不是 JSON（${ms}ms）：${text.slice(0, 300)}`) }
  return { data, ms }
}

console.log(`→ 接口：${endpoint}`)
console.log(`→ 模型：${MODEL}\n`)

// 1) 连通性
try {
  const { data, ms } = await chat(
    [{ role: 'user', content: '只回复两个字：可用' }],
    { max_tokens: 20, temperature: 0 },
  )
  const reply = data.choices?.[0]?.message?.content?.trim()
  console.log(`✓ 连通性通过｜${ms}ms｜模型回复：「${reply}」`)
  if (data.usage) console.log(`  用量：${JSON.stringify(data.usage)}`)
} catch (err) {
  fail(`连通性测试失败：${err.message}`)
}

// 2) 结构化动作输出（游戏 AI 真正要用的能力）
const actionPrompt = [
  '你是桌游「学术宝石」的 AI 玩家。只输出一个 JSON 对象，不要任何解释或代码块标记。',
  '动作 schema：{"action":"take","tokens":{"data":1,"compute":1,"citation":1}}',
  'action 只能是 buy / take / reserve 之一。',
  '当前银行各色充足，请你拿三种不同资源各一枚。',
].join('\n')

let act
try {
  act = await chat([{ role: 'user', content: actionPrompt }], {
    max_tokens: 120, temperature: 0, response_format: { type: 'json_object' },
  })
} catch (err) {
  // 有些兼容接口不支持 response_format，去掉它重试一次
  if (err.status && err.status >= 400 && err.status < 500) {
    console.log('  （接口不支持 response_format，改用纯提示词重试）')
    act = await chat([{ role: 'user', content: actionPrompt }], { max_tokens: 120, temperature: 0 })
  } else {
    fail(`结构化输出测试失败：${err.message}`)
  }
}

const raw = act.data.choices?.[0]?.message?.content?.trim()
let parsed
try { parsed = JSON.parse(raw) } catch { fail(`动作输出不是合法 JSON：${raw}`) }
if (!['buy', 'take', 'reserve'].includes(parsed.action)) {
  fail(`动作类型非法（应为 buy/take/reserve）：${JSON.stringify(parsed)}`)
}
console.log(`✓ 结构化动作通过｜${act.ms}ms｜${JSON.stringify(parsed)}`)
console.log('\n全部通过：接口可用，且能产出符合游戏动作 schema 的 JSON，可以接入 AI 对抗。')