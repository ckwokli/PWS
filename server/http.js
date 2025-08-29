/**
 * HTTP utilities with timeout, retry, and size limiting capabilities
 */
import { tooLarge, serverError } from './errors';

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitteredBackoff(baseMs) { return baseMs * (0.8 + Math.random() * 0.4); }

export async function withRetry(doFn, options = {}) {
  const { retries = 2, baseBackoffMs = 500, shouldRetry = () => true } = options;
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await doFn(); } catch (e) { last = e; if (attempt < retries && shouldRetry(e)) await sleep(jitteredBackoff(baseBackoffMs * Math.pow(2, attempt))); else break; }
  }
  throw last;
}

export async function fetchWithTimeout(url, options = {}, config = {}) {
  const { timeoutMs = 10000, maxBytes = 1_000_000 } = config;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const len = res.headers.get('content-length');
    if (len && parseInt(len, 10) > maxBytes) throw tooLarge(`Response size exceeds limit (${len} > ${maxBytes} bytes)`);
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw e;
  } finally { clearTimeout(id); }
}

export async function safeReadText(response, maxBytes = 1_000_000) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    let total = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes) { reader.cancel(); throw tooLarge(`Response size exceeds limit (${total} > ${maxBytes} bytes)`);} chunks.push(value);} 
    const all = new Uint8Array(total); let pos = 0; for (const c of chunks) { all.set(c, pos); pos += c.length; }
    return new TextDecoder().decode(all);
  }
  const text = await response.text(); if (text.length > maxBytes) throw tooLarge(`Response size exceeds limit (${text.length} > ${maxBytes} bytes)`); return text;
}

export async function fetchJson(url, options = {}, config = {}) {
  const res = await fetchWithTimeout(url, options, config);
  if (!res.ok) throw serverError(`HTTP error ${res.status}: ${res.statusText}`);
  const text = await safeReadText(res, config.maxBytes ?? 1_000_000);
  try { return JSON.parse(text); } catch (e) { throw serverError('Invalid JSON response', { error: e.message }); }
}

export function isValidUrl(url, allowedDomains = null) {
  try { const u = new URL(url); if (u.protocol !== 'https:') return false; if (allowedDomains && allowedDomains.length) { return allowedDomains.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`)); } return true; } catch { return false; }
}
