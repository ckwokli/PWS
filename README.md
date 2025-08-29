# Parallel Verifier v1

Apple-like UI to verify ChatGPT content using Parallel Web Systems (PWS) and visualize side-by-side diffs.

## Features

- Clean, minimal UI inspired by apple.com (Tailwind CSS)
- Drag-and-drop uploads (PDF, DOCX, TXT/MD)
- ChatGPT shared link parsing (assistant replies prioritized)
- Claim extraction and verification via Parallel Search API
- Side-by-side diff view: ChatGPT extracted text vs Parallel evidence snippets
- API toggles: Search (wired), Deep Research/Task (UI placeholders)

## Quick start

1. Install Node.js (if npm not found)
   - macOS (Homebrew):
     brew install node
   - Or use nvm:
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
     nvm install --lts

2. Install deps

   npm install

3. Configure env

   Create `.env.local` with:

   PWS_API_KEY=YOUR_PARALLEL_API_KEY
   # Optional; defaults to https://api.parallel.ai/v1beta if missing/invalid
   PWS_BASE_URL=https://api.parallel.ai/v1beta

4. Run dev server

   npm run dev

5. Open the app

   http://localhost:3000

## Notes

- We do not store or commit env files. `.env.local` is gitignored.
- The diff view is token-based to highlight differences quickly; feel free to swap in a more advanced diff later.
- Only Search is wired on the backend. The UI toggles for Deep Research/Task are placeholders for future PWS endpoints.
