// Parallel FindAll API integration (ingest -> run -> poll)
const ROOT = (process.env.PWS_BASE_URL || 'https://api.parallel.ai').replace(/\/$/, '');
const API_KEY = process.env.PWS_API_KEY || '';

async function ingestFindAll(query) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${ROOT}/v1beta/findall/ingest`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ query: String(query || '').slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`FindAll ingest error ${res.status}: ${await res.text().catch(()=>res.statusText)}`);
  return res.json(); // findall_spec
}

async function startFindAllRun({ findall_spec, processor = 'base', result_limit = 50 }) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${ROOT}/v1beta/findall/runs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ findall_spec, processor, result_limit }),
  });
  if (!res.ok) throw new Error(`FindAll run error ${res.status}: ${await res.text().catch(()=>res.statusText)}`);
  return res.json(); // { findall_id, status }
}

async function getFindAllRun(findall_id) {
  if (!API_KEY) throw new Error('Missing PWS_API_KEY');
  const url = `${ROOT}/v1beta/findall/runs/${encodeURIComponent(findall_id)}`;
  const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) throw new Error(`FindAll poll error ${res.status}: ${await res.text().catch(()=>res.statusText)}`);
  return res.json();
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
