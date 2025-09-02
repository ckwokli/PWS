// Parallel Search API integration (v1)
// Docs: https://docs.parallel.ai/api-reference/search-api/search
import { fetchWithTimeout, withRetry, safeReadText } from './http';

const ENV_BASE = process.env.PWS_BASE_URL;
const API_KEY = process.env.PWS_API_KEY || '';

function resolveBaseUrl() {
  const fallback = 'https://api.parallel.ai/v1beta';
  if (!ENV_BASE) return fallback;
  try {
    const u = new URL(ENV_BASE);
    if (u.protocol !== 'https:' || !/parallel\.ai$/i.test(u.hostname)) return fallback;
    return ENV_BASE.replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

async function callParallelSearch(objective, queries, { processor = 'base', max_results = 5, max_chars_per_result = 800 } = {}) {
  if (!API_KEY) {
    return { evidence: [], confidence: 0 };
  }
  const base = resolveBaseUrl();
  if (process.env.NODE_ENV !== 'production') {
    try {
      const host = new URL(base).host;
      console.debug(`[PWS v1] Using base: ${host}; key length: ${API_KEY.length}`);
    } catch {}
  }
  const url = `${base}/search`;
  const body = {
    objective: String(objective || '').slice(0, 500),
    search_queries: Array.isArray(queries) && queries.length ? queries.slice(0, 5) : [String(objective || '').slice(0, 200)],
    processor,
    max_results,
    max_chars_per_result,
  };
  
  const res = await withRetry(
    async () => fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: 12000, maxBytes: 1_000_000 }
    ),
    {
      retries: 2,
      baseBackoffMs: 600,
      shouldRetry: (err) => !err.status || (err.status >= 500 && err.status < 600)
    }
  );

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(`Parallel Search error ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const evidence = results.slice(0, max_results).map(r => ({
    url: r.url,
    snippet: Array.isArray(r.excerpts) ? r.excerpts.filter(Boolean).join(' … ') : '',
    title: r.title,
  }));
  const excerptCount = results.reduce((acc, r) => acc + ((r.excerpts || []).length), 0);
  const text = evidence.map(e => e.snippet).join(' ').toLowerCase();
  const claimTokens = String(objective || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
  const uniqueTokens = Array.from(new Set(claimTokens));
  const overlap = uniqueTokens.length ? uniqueTokens.filter(t => text.includes(t)).length / uniqueTokens.length : 0;

  const domainTrustScore = (() => {
    const trustDomain = (host) => {
      if (!host) return 0.2;
      if (/\.gov$/i.test(host)) return 1.0;
      if (/\.edu$/i.test(host)) return 0.9;
      if (/(who\.int|nih\.gov|cdc\.gov|europa\.eu|un\.org)$/i.test(host)) return 0.95;
      if (/(wikipedia\.org)$/i.test(host)) return 0.6;
      return 0.4;
    };
    const hosts = results.map(r => { try { return new URL(r.url).host; } catch { return ''; } }).filter(Boolean);
    if (!hosts.length) return 0;
    const avg = hosts.reduce((a, h) => a + trustDomain(h), 0) / hosts.length;
    return Math.min(1, Math.max(0, avg));
  })();

  const excerptFactor = Math.tanh(excerptCount / 5);
  const confidence = Math.max(0, Math.min(1, (overlap * 0.6) + (domainTrustScore * 0.25) + (excerptFactor * 0.15)));
  return { evidence, confidence };
}

export async function verifyWithPWS(claim, queries, opts = {}) {
  try {
    const { evidence, confidence } = await callParallelSearch(claim, queries && queries.length ? queries : [claim], opts);
    const threshold = opts.threshold ?? 0.3;
    const supported = evidence.length > 0 && confidence >= threshold;
    return { claim, status: supported ? 'supported' : 'insufficient', confidence, evidence };
  } catch (e) {
    return { claim, status: 'insufficient', confidence: 0, evidence: [], error: e.message };
  }
}
