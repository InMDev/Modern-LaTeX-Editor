# Modern LaTex

Bidirectional LaTeX and rich-text editor

<p align="center">
   <a href="https://inmdev.github.io/Modern-LaTex-Editor/">
      <strong>Try now: Click Here</strong>
   </a>
   <br/>
   <br/>
   <img src="./assets/demo.png" alt="Modern LaTeX Editor demo" width="800" />

</p>

### Main Features:
   <br/>
   <img src="./assets/demo2.png" alt="Modern LaTeX Editor toolbar and preview" width="800" />
   <br/>

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Build for production:
   ```bash
   npm run build
   ```
4. Preview the production build locally:
   ```bash
   npm run preview
   ```

## Testing

Run the Vitest suite:
```bash
npm test
```
---
## 🤝 How to Contribute

We welcome contributions! Here are the two main ways you can help improve the project:

### 🚀 New Features
Check out our **[Feature Roadmap & Backlog](https://docs.google.com/spreadsheets/d/1TP4IJ8-a9CupWvt0BwB0bs37mfrjxELOIep4t1ylcZo/edit?usp=sharing)** to see what is currently planned or to find ideas to work on.

### Bug Reports
If you find a bug, please open a new Issue. When reporting a bug, please copy and fill out the template below so we can reproduce it easily:

**Steps to Reproduce:**
1. Go to...
2. Click on...
3. Scroll down to...
4. See error...

**Expected Behavior:**
[Describe what you expected to happen]

**Actual Behavior:**
[Describe what actually happened]

---

## Project Structure

- `src/App.jsx` — UI for the live LaTeX editor.
- `src/main.jsx` — React entry point.
- `src/index.css` — Tailwind base and global styles.
- `src/constants/math.js` — math groups, defaults, and symbols.
- `src/constants/flags.js` — feature flags for the toolbar.
- `tests/lib/latex.test.js` — LaTeX helper tests.

## Tooling

- Vite for dev/build.
- Tailwind CSS with Typography plugin.
- React 18 with lucide-react icons.
- Vitest for testing.

## API proxy and compilers

The app talks to online LaTeX compilers through the dev server proxy:

- /api/latexonline → https://latexonline.cc (enabled by default)
- /api/rtex → https://rtex.probably.rocks (optional)

RTeX is disabled by default to avoid DNS errors if the host is unreachable. To enable it:

1) For one run: VITE_ENABLE_RTEX=true npm run dev

2) Or create a .env.local with:

   VITE_ENABLE_RTEX=true

Then restart the dev server. If rtex.probably.rocks is down, keep this flag false and rely on latexonline.

### In-browser WASM LaTeX (experimental)

You can run LaTeX entirely in the browser using a WebAssembly engine to avoid network calls:

- Option A: pdftex-wasm (pdfTeX compiled to WASM)
- Option B: SwiftLaTeX/TeXLive WASM distributions

Enable the flag and point to an engine:

1) Set `VITE_USE_WASM_LATEX=true` (e.g., in `.env.local`).
2) Provide a module to import via `VITE_WASM_LATEX_MODULE` OR load a global engine with a `<script>` tag.
   - If using a module, set `VITE_WASM_LATEX_MODULE` to the ESM id/URL and ensure it exposes either `PDFTeX.new().compile()` or a `compile()` function returning a Uint8Array/base64 PDF.
   - If using a global (e.g., SwiftLaTeX), ensure `window.SwiftLaTeX.compile()` is available; no module path needed.

Notes:
- WASM TeX engines are large; first load may be slow.
- Not all LaTeX packages are supported depending on the bundle.
- On failure, the app will fall back to online compilers if enabled.

## Environment variables

Configure behavior via `.env.local` (see `.env.example`):

- `VITE_ENABLE_RTEX` (default: `false`)
   - Enables the `/api/rtex` proxy and allows using the RTeX fallback service.

- `VITE_USE_WASM_LATEX` (default: `false`)
   - Run LaTeX compilation fully in the browser using a WebAssembly engine.
   - Preferred for diagnostics/export when enabled; falls back otherwise.

- `VITE_WASM_LATEX_MODULE` (optional)
   - ESM module id/URL that exports either `PDFTeX.new().compile()` or a `compile()` that returns a PDF as `Uint8Array` or base64.
   - If omitted, you can load a global engine (e.g., `window.SwiftLaTeX`) via `<script>`.

## Export and logs

- Export tries in order:
   1) WASM (if `VITE_USE_WASM_LATEX=true` and an engine is available)
   2) `latexonline.cc` via proxy
   3) `rtex.probably.rocks` via proxy (if `VITE_ENABLE_RTEX=true`)
- When a compile fails, the app opens the log modal and shows the server/compiler output.

## Troubleshooting

- Seeing HTML/404 parsed as JSON in logs?
   - Ensure the Vite proxy is active (restart dev server) and you’re calling `/api/latexonline` or `/api/rtex` from the client.

- DNS error `getaddrinfo ENOTFOUND rtex.probably.rocks` in dev?
   - Set `VITE_ENABLE_RTEX=false` (default) or ensure the host is reachable, then restart dev server.

- WASM import error or module not found?
   - Set `VITE_WASM_LATEX_MODULE` to a valid module id/URL or load a global engine. Keep `VITE_USE_WASM_LATEX=false` if you don’t need in-browser compilation.

## Production deployment

- The Vite proxy is dev-only. For production, add equivalent rewrites or a minimal backend:
   - Reverse proxy `/api/latexonline` → `https://latexonline.cc`
   - Optionally `/api/rtex` → `https://rtex.probably.rocks`
- Alternatively, use a serverless function to call third-party APIs and avoid CORS.
