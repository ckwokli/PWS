// Parallel Task API (runs + results), including Deep Research via processor selection
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Task create error ${res.status}: ${await res.text().catch(()=>res.statusText)}`);
  const data = await res.json();
  return data; // expect { run_id, status }
}

async function getTaskResult(run_id) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${BASE}/tasks/runs/${encodeURIComponent(run_id)}/result`;
  const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) throw new Error(`Task result error ${res.status}: ${await res.text().catch(()=>res.statusText)}`);
  return res.json();
}

export async function runTaskAndWait({ input, output_schema, processor = 'base', pollMs = 1500, maxWaitMs = 120000 }) {
  const created = await createTaskRun({ input, output_schema, processor });
  const run_id = created.run_id || created.id || created.runId;
  if (!run_id) return { status: created.status || 'unknown', output: null };
  const deadline = Date.now() + maxWaitMs;
  // simple polling
  while (Date.now() < deadline) {
    const out = await getTaskResult(run_id);
    if (out && out.status && String(out.status).toLowerCase() === 'completed') return out;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { status: 'timeout', output: null };
}

// Convenience: Deep Research runs via ultra processor
export async function runDeepResearch({ input, pollMs, maxWaitMs }) {
  return runTaskAndWait({ input, processor: 'ultra', pollMs, maxWaitMs });
}

// Generate 3–5 diversified search queries for a given claim
export async function generateQueriesForClaim(claim) {
  const trimmed = String(claim || '').trim();
  if (!trimmed) return [];
  const output_schema = {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 5,
      },
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
    const cleaned = arr
      .map(q => String(q || '').trim())
      .filter(Boolean)
      .filter(q => q.length <= 200)
      .slice(0, 5);
    return cleaned.length ? cleaned : [trimmed];
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[pws-task] query generation failed:', e?.message || e);
    }
    return [trimmed];
  }
}
