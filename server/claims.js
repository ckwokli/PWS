export function extractClaims(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();

  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map(s => s.trim())
    .filter(Boolean);

  const looksLikeCode = (s) => /[{\[\];)(]|function\s|=>|\bvar\b|\bconst\b|\blet\b|window\.|document\.|__NEXT_DATA__/i.test(s);
  const symbolRatio = (s) => {
    const symbols = (s.match(/[^\w\s.,:;\-()'"%$]/g) || []).length;
    return symbols / Math.max(1, s.length);
  };

  let claims = sentences
    .filter(s => s.length >= 30 && s.length <= 600)
    .filter(s => !looksLikeCode(s))
    .filter(s => symbolRatio(s) < 0.15)
    .filter(s => /[a-zA-Z]{6,}/.test(s))
    .filter(s => /[\.!?]/.test(s) || /\d/.test(s));

  if (claims.length >= 3) return claims.slice(0, 200);

  // Secondary segmentation for list/label-like PDFs
  const rawLines = String(text || '').split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const labelRe = /^(address|website|phone|fax|email|hours|specialty|services|clinic|doctor|provider)\s*[:\-]/i;
  const bulletRe = /^([\-•\*\u2022\u25CF])\s+/;
  const midDotRe = /\s*\u00B7\s*/g;
  const lineChunks = rawLines
    .map(l => l.replace(midDotRe, ' • '))
    .flatMap(l => l.split(/\s•\s|;\s*/))
    .map(s => s.trim())
    .filter(Boolean);
  const labelClaims = lineChunks
    .filter(s => s.length >= 20 && s.length <= 300)
    .filter(s => !looksLikeCode(s))
    .filter(s => symbolRatio(s) < 0.25)
    .filter(s => labelRe.test(s) || bulletRe.test(s) || /https?:\/\//i.test(s))
    .map(s => s.replace(bulletRe, '').trim());
  claims = [...claims, ...labelClaims];
  if (claims.length >= 3) return claims.slice(0, 200);

  const paras = text
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 40 && !looksLikeCode(p) && symbolRatio(p) < 0.15)
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
  return paras;
}
