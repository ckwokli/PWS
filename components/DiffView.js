import React from 'react';

function tokenize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
}

function computeDiff(aText, bText) {
  const a = tokenize(aText);
  const b = tokenize(bText);
  const setB = new Set(b);
  const setA = new Set(a);
  const aTokens = a.map((w) => ({ w, type: setB.has(w) ? 'keep' : 'unique' }));
  const bTokens = b.map((w) => ({ w, type: setA.has(w) ? 'keep' : 'unique' }));
  return { aTokens, bTokens };
}

export default function DiffView({ leftTitle = 'ChatGPT', rightTitle = 'Parallel', leftText = '', rightText = '' }) {
  const { aTokens, bTokens } = computeDiff(leftText, rightText);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{leftTitle}</h3>
          <span className="badge">Left</span>
        </div>
        <div className="prose max-w-none leading-relaxed">
          {aTokens.map((t, i) => (
            <span key={i} className={t.type === 'unique' ? 'bg-red-50 text-red-800 rounded px-0.5' : ''}>
              {t.w + ' '}
            </span>
          ))}
        </div>
      </div>
      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{rightTitle}</h3>
          <span className="badge">Right</span>
        </div>
        <div className="prose max-w-none leading-relaxed">
          {bTokens.map((t, i) => (
            <span key={i} className={t.type === 'unique' ? 'bg-green-50 text-green-800 rounded px-0.5' : ''}>
              {t.w + ' '}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
