import formidable from 'formidable';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { extractClaims } from '../../server/claims';
import { verifyWithPWS } from '../../server/pws';
import { runTaskAndWait, runDeepResearch, generateQueriesForClaim } from '../../server/pws-task';
import { runFindAllAndWait } from '../../server/pws-findall';
import { readFile } from 'node:fs/promises';
import { ApiError, badRequest, tooLarge, sendError, ok } from "../../server/errors";
import { fetchWithTimeout, safeReadText, isValidUrl } from "../../server/http";
const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_MODES = ['search', 'deep_research', 'task', 'findall'];
const MAX_LINK_LENGTH = 2048;

// Heuristic cleaner for PDF fallback when pdf-parse fails
function cleanPdfFallback(buffer) {
  const raw = buffer.toString('latin1');
  const ascii = raw.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ');
  const lines = ascii.split(/\r?\n/);
  const drop = /^(%PDF-|\d+\s+\d+\s+obj\b|endobj\b|stream\b|endstream\b|xref\b|trailer\b|startxref\b|%%EOF|\s*<<?\s*\/|\s*\[|\s*\]|\s*BT\b|\s*ET\b)/i;
  const keep = lines
    .map(s => s.trim())
    .filter(s => s.length >= 3 && s.length <= 800)
    .filter(s => /[A-Za-z]{3,}/.test(s))
    .filter(s => !drop.test(s))
    .slice(0, 2000);
  return keep.join('\n');
}

// Clean text produced by pdf-parse to remove leftover PDF tokens
function cleanPdfParsedText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const drop = /^(%PDF-|\d+\s+\d+\s+obj\b|endobj\b|stream\b|endstream\b|xref\b|trailer\b|startxref\b|%%EOF|^<<?\s*\/|^BT\b|^ET\b)/i;
  return lines
    .map(s => s.trim())
    .filter(s => s.length >= 3 && s.length <= 1000)
    .filter(s => /[A-Za-z]{3,}/.test(s))
    .filter(s => !drop.test(s))
    .join('\n');
}

export const config = { api: { bodyParser: false, responseLimit: 26214400 } }

async function parseFiles(files) {
  const texts = [];
  let totalSize = 0;
  for (const f of files) {
    const filepath = f.filepath || f.path;
    const mimetype = f.mimetype || f.type || '';
    const size = f.size || 0;
    totalSize += size;
    if (size > MAX_FILE_SIZE) {
      throw tooLarge(`File too large: ${f.originalFilename || f.name} (${Math.round(size/1024/1024)}MB > ${Math.round(MAX_FILE_SIZE/1024/1024)}MB)`);
    }
    if (totalSize > MAX_TOTAL_SIZE) {
      throw tooLarge(`Total upload size exceeds limit (${Math.round(totalSize/1024/1024)}MB > ${Math.round(MAX_TOTAL_SIZE/1024/1024)}MB)`);
    }
    const buf = await readFile(filepath);
    if (/pdf$/i.test(mimetype) || /\.pdf$/i.test(f.originalFilename || '')) {
      try {
        const out = await pdfParse(buf);
        let cleaned = cleanPdfParsedText(out.text || '');
        if (!cleaned || cleaned.trim().length < 20) {
          cleaned = cleanPdfFallback(buf);
        }
        texts.push(cleaned);
      } catch (e) {
        console.warn('[verify v1] pdf-parse failed:', e?.message || e);
        const fallback = cleanPdfFallback(buf);
        texts.push(fallback);
      }
    } else if (/officedocument\.wordprocessingml\.document|docx$/i.test(mimetype) || /\.docx$/i.test(f.originalFilename || '')) {
      const out = await mammoth.extractRawText({ buffer: buf });
      texts.push(out.value || '');
    } else {
      texts.push(buf.toString('utf8'));
    }
  }
  return texts.join('\n\n');
}

async function fetchChatGPTShared(link) {
  try {
    if (!isValidUrl(link)) { return ''; }
    const res = await fetchWithTimeout(link, { headers: { 'User-Agent': 'Mozilla/5.0' } }, { timeoutMs: 10000, maxBytes: 1000000 });
    if (!res.ok) return '';
    const html = await safeReadText(res, 1000000);
    const $ = cheerio.load(html);
    
    // Special handling for ChatGPT shared conversations
    const isChatGPTShare = /chat\.openai\.com\/share\//.test(link);
    if (isChatGPTShare) {
      // Try to parse structured data from __NEXT_DATA__ if present
      let structured = '';
      const nextDataRaw = $('#__NEXT_DATA__').first().text();
      if (nextDataRaw) {
        try {
          const nextData = JSON.parse(nextDataRaw);
          // Heuristic search for messages in Next data
          const msgs = [];
          const visit = (obj) => {
            if (!obj) return;
            if (Array.isArray(obj)) {
              for (const it of obj) visit(it);
              return;
            }
            if (typeof obj === 'object') {
              // common shapes: {message: {author:{role}, content: {parts:[...]}}}
              if (obj.author && obj.content && (obj.content.parts || obj.content.text || obj.content[0])) {
                const role = obj.author.role || obj.role || '';
                let text = '';
                if (Array.isArray(obj.content.parts)) text = obj.content.parts.join('\n');
                else if (typeof obj.content.text === 'string') text = obj.content.text;
                else if (Array.isArray(obj.content) && typeof obj.content[0]?.text === 'string') text = obj.content[0].text;
                if (text) msgs.push({ role, text });
              }
              for (const k of Object.keys(obj)) visit(obj[k]);
            }
          };
          visit(nextData);
          if (msgs.length) {
            structured = msgs.map(m => `${m.role ? m.role.toUpperCase() + ':' : ''} ${m.text}`.trim()).join('\n\n');
          }
        } catch {}
      }

      // Fallback to DOM-based extraction of conversation turns and links
      const parts = [];
      const anchors = new Set();
      $('[data-testid="conversation-turn"], [data-message-author-role]').each((_, el) => {
        const role = $(el).attr('data-message-author-role') || $(el).find('[data-message-author-role]').attr('data-message-author-role') || '';
        const txt = $(el).text().trim();
        if (txt && txt.length > 10) parts.push(`${role ? role.toUpperCase() + ':' : ''} ${txt}`.trim());
        $(el).find('a[href]').each((__, a) => {
          const href = $(a).attr('href');
          if (href && /^https?:\/\//.test(href)) anchors.add(href);
        });
      });
      if (parts.length === 0) {
        $('main, article, .prose').each((_, el) => {
          const txt = $(el).text().trim();
          if (txt && txt.length > 50) parts.push(txt);
          $(el).find('a[href]').each((__, a) => {
            const href = $(a).attr('href');
            if (href && /^https?:\/\//.test(href)) anchors.add(href);
          });
        });
      }

      const combined = [structured, parts.join('\n\n')].filter(Boolean).join('\n\n');
      const withLinks = anchors.size ? combined + '\n\nSources:\n' + Array.from(anchors).join('\n') : combined;

      const cleaned = withLinks
        .split('\n')
        .map(s => s.trim())
        .filter(s => s && !/(function\s*\(|var\s|const\s|let\s|import\(|export\s|window\.|document\.|__NEXT_DATA__|webpackJsonp|;\)|\{.*\}|^[\[{]{1}[^]*[\]}]{1}$)/i.test(s))
        .join('\n')
        .slice(0, 30000);
      return cleaned;
    }

    // Generic page fallback: strip chrome and collect body text
    $('script, style, noscript, template, header, footer, nav, aside').remove();
    const fallbackText = $('main').text() || $('article').text() || $('body').text();
    return fallbackText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 20000);
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendError(res, badRequest('Method Not Allowed', { method: req.method }));

    const form = formidable({ multiples: true, maxFiles: MAX_FILES, maxFileSize: MAX_FILE_SIZE, maxTotalFileSize: MAX_TOTAL_SIZE });
    form.parse(req, async (err, fields, files) => {
      try {
        if (err) {
          const msg = String(err?.message || err || '');
          const code = String(err?.code || '');
          if (msg.includes('maxFiles') || code === 'LIMIT_FILE_COUNT') {
            return sendError(res, tooLarge(`Too many files (${MAX_FILES} max)`));
          }
          if (msg.includes('maxFileSize') || code === 'ETOOBIG' || code === 'LIMIT_FILE_SIZE') {
            return sendError(res, tooLarge('File too large'));
          }
          if (msg.includes('maxTotalFileSize')) {
            return sendError(res, tooLarge('Total upload too large'));
          }
          return sendError(res, badRequest(msg));
        }
        const flist = Array.isArray(files.files) ? files.files : files.files ? [files.files] : [];
        if (flist.length > MAX_FILES) throw tooLarge(`Too many files (${flist.length} > ${MAX_FILES})`);

        const link = (fields.link && (Array.isArray(fields.link) ? fields.link[0] : fields.link)) || '';
        const mode = (fields.mode && (Array.isArray(fields.mode) ? fields.mode[0] : fields.mode)) || 'search';
        const output_schema = (fields.output_schema && (Array.isArray(fields.output_schema) ? fields.output_schema[0] : fields.output_schema)) || '';

        if (!ALLOWED_MODES.includes(mode)) throw badRequest(`Invalid mode: ${mode}`);
        if (link && (link.length > MAX_LINK_LENGTH || !isValidUrl(link))) throw badRequest('Invalid link URL');

        let combinedText = '';
        if (flist.length) combinedText += await parseFiles(flist);
        if (link) {
          const linkText = await fetchChatGPTShared(link);
          if (linkText) combinedText += (combinedText ? '\\n\\n' : '') + linkText;
        }

        if (!combinedText) return sendError(res, badRequest('No content to verify'));

        if (mode === 'deep_research') {
          const out = await runDeepResearch({ input: combinedText });
          return ok(res, {
            mode,
            source: { text: combinedText },
            deep_research: out?.output?.content || out?.output || null,
            basis: out?.output?.basis || [],
            status: out?.status,
            run_id: out?.run_id,
          });
        }

        if (mode === 'task') {
          const out = await runTaskAndWait({ input: combinedText, output_schema });
          return ok(res, {
            mode,
            source: { text: combinedText },
            output: out?.output || null,
            status: out?.status,
            run_id: out?.run_id,
          });
        }

        if (mode === 'findall') {
          const out = await runFindAllAndWait({ query: combinedText });
          return ok(res, {
            mode,
            source: { text: combinedText },
            results: out?.results || [],
            status: out?.status,
            findall_id: out?.findall_id,
          });
        }

        // Default: search
        const claims = extractClaims(combinedText).slice(0, 50);
        const items = [];
        for (const claim of claims) {
          const queries = await generateQueriesForClaim(claim);
          const result = await verifyWithPWS(
            claim,
            queries,
            { processor: 'base', max_results: 5, max_chars_per_result: 800, threshold: 0.3 }
          );
          items.push(result);
          await new Promise(r => setTimeout(r, 50));
        }
        return ok(res, { mode: 'search', source: { text: combinedText }, items });
      } catch (e) {
        return sendError(res, e instanceof ApiError ? e : new ApiError(500, 'server_error', e.message || 'Internal Error'));
      }
    });
  } catch (e) {
    return sendError(res, e instanceof ApiError ? e : new ApiError(500, 'server_error', e.message || 'Internal Error'));
  }
}
