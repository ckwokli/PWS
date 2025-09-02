// Parallel FindAll API integration (ingest -> run -> poll)
import { fetchWithTimeout, withRetry, fetchJson, safeReadText } from './http';

// Normalize base URL to always point at /v1beta
const ENV_BASE = process.env.PWS_BASE_URL || 'https://api.parallel.ai';
const BASE = ENV_BASE.replace(/\/$/, '')
  .replace(/\/v1$/, '/v1beta')
  .replace(/\/v1beta$/, '/v1beta');
const API_KEY = process.env.PWS_API_KEY || '';

async function ingestFindAll(query) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${BASE}/findall/ingest`;

  const res = await withRetry(
    () =>
      fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
          body: JSON.stringify({ query: String(query || '').slice(0, 2000) }),
        },
        { timeoutMs: 12000, maxBytes: 1_000_000 }
      ),
    {
      retries: 2,
      baseBackoffMs: 600,
      shouldRetry: (err) => !err.status || (err.status >= 500 && err.status < 600),
    }
  );

  if (!res.ok) {
    const errorText = await safeReadText(res);
    throw new Error(`FindAll ingest error ${res.status}: ${errorText || res.statusText}`);
  }
  return res.json();
}

async function startFindAllRun({ findall_spec, processor = 'base', result_limit = 50 }) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${BASE}/findall/runs`;

  const res = await withRetry(
    () =>
      fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
          body: JSON.stringify({ findall_spec, processor, result_limit }),
        },
        { timeoutMs: 12000, maxBytes: 1_000_000 }
      ),
    {
      retries: 2,
      baseBackoffMs: 600,
      shouldRetry: (err) => !err.status || (err.status >= 500 && err.status < 600),
    }
  );

  if (!res.ok) {
    const errorText = await safeReadText(res);
    throw new Error(`FindAll run error ${res.status}: ${errorText || res.statusText}`);
  }
  return res.json();
}

async function getFindAllRun(findall_id) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${BASE}/findall/runs/${encodeURIComponent(findall_id)}`;

  return withRetry(
    () =>
      fetchJson(
        url,
        { headers: { 'x-api-key': API_KEY } },
        { timeoutMs: 12000, maxBytes: 1_000_000 }
      ),
    {
      retries: 2,
      baseBackoffMs: 600,
      shouldRetry: (err) => !err.status || (err.status >= 500 && err.status < 600),
    }
  );
}

export async function runFindAllAndWait({ query, processor = 'base', result_limit = 20, pollMs = 2000, maxWaitMs = 120000 }) {
  const spec = await ingestFindAll(query);
  const started = await startFindAllRun({ findall_spec: spec, processor, result_limit });
  const id = started.findall_id;
  if (!id) return { status: started.status || 'unknown', results: [] };
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const out = await getFindAllRun(id);
    if (!out.is_active && !out.are_enrichments_active) return out;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { status: 'timeout', results: [] };
}
