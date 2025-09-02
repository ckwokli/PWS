// Parallel Task API (runs + results), including Deep Research via processor selection
import { fetchWithTimeout, withRetry, fetchJson, safeReadText } from './http';

const BASE = (process.env.PWS_BASE_URL || 'https://api.parallel.ai/v1').replace(/\/$/, '')
  .replace(/\/v1beta$/, '/v1');
const API_KEY = process.env.PWS_API_KEY || '';

async function createTaskRun({ input, output_schema, processor = 'base' }) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${BASE}/tasks/runs`;
  const body = {
    input: String(input || '').slice(0, 4000),
    processor,
  };
  if (output_schema) body.task_spec = { output_schema };
  
  const res = await withRetry(
    async () => fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(body),
      },
      { timeoutMs: 12000, maxBytes: 1_000_000 }
    ),
    { retries: 2, baseBackoffMs: 600, shouldRetry: (err) => !err.status || (err.status >= 500 && err.status < 600) }
  );
  
  if (!res.ok) {
    const errorText = await safeReadText(res);
    throw new Error(`Task create error ${res.status}: ${errorText || res.statusText}`);
  }
  return await res.json();
}

async function getTaskResult(run_id) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${BASE}/tasks/runs/${encodeURIComponent(run_id)}/result`;
  return await withRetry(
    async () => fetchJson(url, { headers: { 'x-api-key': API_KEY } }, { timeoutMs: 12000, maxBytes: 1_000_000 }),
    { retries: 2, baseBackoffMs: 600, shouldRetry: (err) => !err.status || (err.status >= 500 && err.status < 600) }
  );
}

export async function runTaskAndWait({ input, output_schema, processor = 'base', pollMs = 1500, maxWaitMs = 120000 }) {
  const created = await createTaskRun({ input, output_schema, processor });
  const run_id = created.run_id || created.id || created.runId;
  if (!run_id) return { status: created.status || 'unknown', output: null };
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const out = await getTaskResult(run_id);
    if (out && out.status && String(out.status).toLowerCase() === 'completed') return out;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { status: 'timeout', output: null };
}

export async function runDeepResearch({ input, pollMs, maxWaitMs }) {
  return runTaskAndWait({ input, processor: 'ultra', pollMs, maxWaitMs });
}

export async function generateQueriesForClaim(claim) {
  const trimmed = String(claim || '').trim();
  if (!trimmed) return [];
  const output_schema = {
    type: 'object',
    properties: {
      queries: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 },
    },
    required: ['queries'],
    additionalProperties: false,
  };
  const instructions = [
    'Produce 3-5 diversified web search queries that would best verify the following factual claim.',
    'Mix entity, synonym, and context terms; include location or timeframe if implied.',
    'Avoid quotes and avoid overly long queries. Keep each under 120 characters.',
    'Return only JSON matching the output_schema. No prose.',
    '',
    `Claim: ${trimmed}`,
  ].join('\n');
  try {
    const out = await runTaskAndWait({ input: instructions, output_schema, processor: 'base', maxWaitMs: 90000 });
    const obj = out && (out.output || out.data || out.result || {});
    const arr = (obj.queries && Array.isArray(obj.queries)) ? obj.queries : [];
    const cleaned = arr.map(q => String(q || '').trim()).filter(Boolean).filter(q => q.length <= 200).slice(0, 5);
    return cleaned.length ? cleaned : [trimmed];
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[pws-task] query generation failed:', e?.message || e);
    return [trimmed];
  }
}
