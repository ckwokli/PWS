import { useCallback, useMemo, useState } from 'react';
import DiffView from '../components/DiffView';

const apiOptions = [
  { key: 'search', label: 'Search', desc: 'Evidence-backed web search' },
  { key: 'deep_research', label: 'Deep Research', desc: 'Multi-hop research (placeholder)' },
  { key: 'task', label: 'Task', desc: 'Task execution (placeholder)' },
  { key: 'findall', label: 'FindAll', desc: 'Entity discovery (placeholder)' },
];

export default function Home() {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState([]);
  const [link, setLink] = useState('');
  const [mode, setMode] = useState('search');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [outputSchema, setOutputSchema] = useState('');

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const onFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selected]);
  };

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    setError('');
    setResults(null);
    if (files.length === 0 && !link) {
      setError('Add at least one file or a ChatGPT shared link.');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      if (link) fd.append('link', link);
      fd.append('mode', mode);
      if (mode === 'task' && outputSchema) fd.append('output_schema', outputSchema);
      const res = await fetch('/api/verify', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data);
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const chatgptText = results?.source?.text || '';
  const rightText = useMemo(() => {
    if (!results) return '';
    const m = results.mode || mode;
    if (m === 'search') {
      const parts = [];
      for (const it of results.items || []) {
        for (const ev of it?.evidence || []) {
          if (ev?.snippet) parts.push(ev.snippet);
        }
      }
      return parts.join(' \n\n');
    }
    if (m === 'deep_research') {
      const basisExcerpts = (results.basis || []).flatMap(b => b.citations?.flatMap(c => c.excerpts || []) || []);
      const contentStr = typeof results.deep_research === 'string' ? results.deep_research : JSON.stringify(results.deep_research || {}, null, 2);
      return [contentStr, basisExcerpts.join(' ')].filter(Boolean).join('\n\n');
    }
    if (m === 'task') {
      return typeof results.output === 'string' ? results.output : JSON.stringify(results.output || {}, null, 2);
    }
    if (m === 'findall') {
      const names = (results.results || []).map(r => `${r.name || r.entity_id || ''} (Score: ${r.score ?? ''})`).join('\n');
      return names;
    }
    return '';
  }, [results, mode]);

  return (
    <div className="min-h-screen bg-white">
      {/* Top Nav (Apple-like minimal) */}
      <header className="border-b border-gray-200/60 bg-white/80 backdrop-blur">
        <div className="container-max flex items-center justify-between py-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-black" />
            <span className="font-semibold tracking-tight">Parallel Verifier v1</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-gray-600">
            <span>Overview</span>
            <span>Technology</span>
            <span>Contact</span>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="container-max py-12 sm:py-16">
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-appleGray">Verify with confidence.</h1>
          <p className="mt-4 text-gray-600 max-w-2xl mx-auto">Upload content or paste a ChatGPT shared link. We extract claims and verify them using Parallel’s Search API. Compare side-by-side with ChatGPT output to see the difference.</p>
        </div>

        {/* Controls Card */}
        <div className="card mt-8 p-6">
          {/* API toggles */}
          <div className="flex flex-wrap items-center gap-3">
            {apiOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setMode(opt.key)}
                className={`px-4 py-2 rounded-full border transition ${mode === opt.key ? 'bg-black text-white border-black' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-2">
            {mode === 'search' ? 'Evidence-backed web search via Parallel.' : 'Placeholder—UI ready, backend integration pending.'}
          </p>

          {/* Inputs */}
          <div className="grid md:grid-cols-2 gap-6 mt-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-2xl p-6 ${dragOver ? 'border-black bg-gray-50' : 'border-gray-300'}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Upload files</h3>
                  <p className="text-sm text-gray-500">PDF, DOCX, TXT/MD. Max 10MB each.</p>
                </div>
                <label className="button-primary cursor-pointer">
                  <input type="file" multiple onChange={onFileChange} className="hidden" />
                  <span>Select Files</span>
                </label>
              </div>
              {files.length > 0 && (
                <ul className="mt-4 divide-y divide-gray-200">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between py-2 text-sm">
                      <span className="truncate mr-3">{f.name} ({Math.round(f.size/1024)} KB)</span>
                      <button onClick={() => removeFile(i)} className="text-gray-600 hover:text-black">Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-gray-200 p-6">
              <h3 className="font-semibold">ChatGPT shared link</h3>
              <input
                className="input mt-3"
                placeholder="Paste ChatGPT shared link (optional)"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              {mode === 'task' && (
                <div className="mt-3">
                  <label className="text-sm font-medium text-gray-700">Task Output Schema (optional)</label>
                  <textarea
                    className="input mt-1 h-28"
                    placeholder="e.g., The founding date of the company in the format MM-YYYY"
                    value={outputSchema}
                    onChange={(e) => setOutputSchema(e.target.value)}
                  />
                </div>
              )}
              <button onClick={submit} disabled={loading} className="button-primary mt-4">
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              {error && <p className="text-red-600 mt-3 text-sm">{error}</p>}
            </div>
          </div>
        </div>
      </section>

      {/* Results & Diffs */}
      {results && (
        <section className="container-max pb-16">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: Results (wide) */}
            <div className="lg:col-span-2 space-y-6">
              <div className="card p-6">
                <h3 className="font-semibold mb-3">Side-by-side comparison</h3>
                <DiffView leftTitle="ChatGPT (extracted text)" rightTitle="Parallel (results)" leftText={chatgptText} rightText={rightText} />
              </div>

              {results.mode === 'search' && (
                <div className="card p-6">
                  <h3 className="font-semibold">Per-claim verification</h3>
                  <div className="mt-4 space-y-4">
                    {results.items?.map((item, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-sm uppercase tracking-wide text-gray-500">Claim</div>
                          <div className="text-sm">Status: <span className={`font-medium ${item.status === 'supported' ? 'text-green-700' : 'text-gray-700'}`}>{item.status}</span> · Confidence: {Math.round((item.confidence||0)*100)}%</div>
                        </div>
                        <p className="mt-2 text-gray-900">{item.claim}</p>
                        {item.evidence?.length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {item.evidence.map((ev, i) => (
                              <li key={i} className="rounded-lg bg-gray-50 p-3">
                                <a href={ev.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 hover:underline">{ev.title || ev.url}</a>
                                {ev.snippet && <div className="text-sm text-gray-700 mt-1">{ev.snippet}</div>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.mode === 'deep_research' && (
                <div className="card p-6">
                  <h3 className="font-semibold">Deep Research Output</h3>
                  <pre className="mt-3 text-sm whitespace-pre-wrap">{typeof results.deep_research === 'string' ? results.deep_research : JSON.stringify(results.deep_research || {}, null, 2)}</pre>
                  {Array.isArray(results.basis) && results.basis.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold">Evidence</h4>
                      <ul className="mt-2 space-y-2">
                        {results.basis.map((b, i) => (
                          <li key={i} className="rounded-lg bg-gray-50 p-3 text-sm">
                            <div className="font-medium">Field: {b.field}</div>
                            <div>Confidence: {b.confidence}</div>
                            <div className="text-gray-700">{b.reasoning}</div>
                            {(b.citations || []).map((c, j) => (
                              <div key={j} className="mt-1">
                                <a href={c.url} className="text-blue-700 hover:underline" target="_blank" rel="noreferrer">{c.title || c.url}</a>
                                {c.excerpts && <div className="text-gray-700">{c.excerpts.join(' ')}</div>}
                              </div>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {results.mode === 'task' && (
                <div className="card p-6">
                  <h3 className="font-semibold">Task Output</h3>
                  <pre className="mt-3 text-sm whitespace-pre-wrap">{typeof results.output === 'string' ? results.output : JSON.stringify(results.output || {}, null, 2)}</pre>
                </div>
              )}

              {results.mode === 'findall' && (
                <div className="card p-6">
                  <h3 className="font-semibold">FindAll Results</h3>
                  <ul className="mt-3 space-y-2">
                    {(results.results || []).map((r, i) => (
                      <li key={i} className="rounded-lg bg-gray-50 p-3 text-sm">
                        <div className="font-medium">{r.name || r.entity_id}</div>
                        {typeof r.score !== 'undefined' && <div>Score: {r.score}</div>}
                        {(r.filter_results || []).map((fr, j) => (
                          <div key={j} className="mt-1 text-gray-700">{fr.key}: {fr.value} — {fr.reasoning} {fr.citations && (<a className="text-blue-700 hover:underline" href={`${fr.citations.split(',')[0]}`} target="_blank" rel="noreferrer">source</a>)}</div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right: Summary (skinny) */}
            <div className="card p-6">
              <h3 className="font-semibold">Summary</h3>
              <div className="mt-3 text-sm text-gray-700">
                {results.mode === 'search' && (
                  <>
                    <div>Claims analyzed: <strong>{results.summary?.claims || 0}</strong></div>
                    <div>Supported: <strong>{results.summary?.supported || 0}</strong></div>
                    <div>Insufficient: <strong>{results.summary?.insufficient || 0}</strong></div>
                  </>
                )}
                {results.mode === 'findall' && (
                  <>
                    <div>Status: <strong>{results.meta?.status}</strong></div>
                    <div>Results: <strong>{(results.results || []).length}</strong></div>
                    <div>Pages read: <strong>{results.meta?.pages_read}</strong></div>
                  </>
                )}
                {results.mode === 'deep_research' && (
                  <>
                    <div>Status: <strong>{results.status}</strong></div>
                  </>
                )}
                {results.mode === 'task' && (
                  <>
                    <div>Status: <strong>{results.status}</strong></div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-gray-200/60 py-10 text-center text-sm text-gray-500">
        <div className="container-max">Built with Parallel Search API. This UI mirrors Apple’s clean aesthetic.</div>
      </footer>
    </div>
  );
}
