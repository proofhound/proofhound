import { createServer } from 'node:http';
import { FAKE_LLM_PORT, OPT_MARKER, ANS_OPEN, ANS_CLOSE, BASELINE_WRONG } from './fake-llm-contract.mjs';

// --- optimizer step detection (mirrors packages/optimization-strategy fake-llm-adapter detectStep) ---
function detectStep(systemPrompt) {
  if (systemPrompt.includes('混淆对分析子任务')) return 'confusion';
  if (systemPrompt.includes('回归样本分析子任务')) return 'regression';
  if (systemPrompt.includes('错误模式分析汇总师')) return 'summarize';
  if (systemPrompt.includes('首版提示词草拟工程师')) return 'generateInitial';
  if (systemPrompt.includes('提示词改写工程师')) return 'generate';
  return 'inference';
}

// Minimal valid JSON for each optimizer step (parsers accept these; see plan §fixtures-judgment).
const OPTIMIZER_RESPONSES = {
  // The generated prompt MUST keep the {{text}} placeholder and carry the marker + <ANS> tags so the
  // round-2 inference is judged correct → accuracy hits the goal → optimization succeeds.
  generate: JSON.stringify({
    newPromptBody: `判断输入并输出分类。${OPT_MARKER} 输入：${ANS_OPEN}{{text}}${ANS_CLOSE}`,
    changeSummary: '注入判别标记，按输入直接给出分类',
    variablesUsed: ['text'],
  }),
  generateInitial: JSON.stringify({
    newPromptBody: `判断输入并输出分类。${OPT_MARKER} 输入：${ANS_OPEN}{{text}}${ANS_CLOSE}`,
    variables: [{ name: 'text', type: 'text', required: true }],
    outputSchema: { fields: [{ key: 'decision', isJudgment: true, value: 'A | B' }] },
    changeSummary: '首版：按输入直接给出分类',
  }),
  confusion: JSON.stringify({
    confusionPair: 'B→A',
    errorPatterns: [{ label: 'B 被误判为 A', count: 1, reason: '模型偏向 A', exampleSampleIds: [] }],
    suggestedChanges: [{ section: '任务说明', change: '强化判别', rationale: '减少偏移' }],
  }),
  regression: JSON.stringify({
    errorPatterns: [{ label: '回归到错', count: 1, reason: '边界丢失', exampleSampleIds: [] }],
    suggestedChanges: [{ section: '示例区', change: '恢复边界示例', rationale: '避免回归' }],
  }),
  summarize: JSON.stringify({
    summary: '本轮失败集中在分类边界，建议直接按输入判定。',
    evidenceBundleVersion: 1,
    errorPatterns: [
      {
        patternId: 'p1',
        label: '分类错误',
        count: 1,
        affectedCount: 1,
        reason: '边界不清',
        exampleSampleIds: [],
        source: 'confusion',
        bucketKey: 'B→A',
      },
    ],
    suggestedChanges: [
      {
        changeId: 'c1',
        section: '任务说明',
        change: '强化判别',
        rationale: '减少偏移',
        addressesPatternIds: ['p1'],
        affectedCount: 1,
        priority: 'high',
      },
    ],
    conflicts: [],
  }),
};

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
  return '';
}

function decisionForInference(allText) {
  if (allText.includes(OPT_MARKER)) {
    const m = new RegExp(`${ANS_OPEN}([\\s\\S]*?)${ANS_CLOSE}`, 'u').exec(allText);
    if (m && m[1]) return m[1].trim();
  }
  return BASELINE_WRONG;
}

function buildContent(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemPrompt = messages
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content))
    .join('\n');
  const step = detectStep(systemPrompt);
  if (step !== 'inference') return OPTIMIZER_RESPONSES[step];
  const allText = messages.map((m) => textOf(m.content)).join('\n');
  return JSON.stringify({ decision: decisionForInference(allText) });
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      body = {};
    }
    const content = buildContent(body);
    const payload = {
      id: 'fake-cmpl',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

server.listen(FAKE_LLM_PORT, '127.0.0.1', () => {
  console.log(`[fake-llm] listening on http://127.0.0.1:${FAKE_LLM_PORT}`);
});
