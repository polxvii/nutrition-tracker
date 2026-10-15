// Builds docs/architecture.html from docs/ARCHITECTURE.md so the diagrams can be
// viewed in any browser without GitHub. ARCHITECTURE.md is the single source of
// truth — edit it, then run:  node docs/build-diagrams.mjs
// The HTML loads Mermaid from a CDN (needs internet to render).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const md = readFileSync(join(here, 'ARCHITECTURE.md'), 'utf8')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Walk the markdown: "## " headings start a section; ```mermaid fences are
// diagrams; plain lines right after a diagram become its caption.
const sections = []
let cur = null
let inFence = false
let buf = []
for (const line of md.split(/\r?\n/)) {
  if (inFence) {
    if (line.trim() === '```') {
      cur?.diagrams.push(buf.join('\n'))
      inFence = false
      buf = []
    } else buf.push(line)
    continue
  }
  if (line.startsWith('## ')) {
    cur = { title: line.slice(3).trim(), diagrams: [], notes: [] }
    sections.push(cur)
  } else if (line.trim() === '```mermaid') {
    inFence = true
  } else if (cur && line.trim() && !line.startsWith('#')) {
    cur.notes.push(line.trim())
  }
}

// Minimal inline markdown for captions: `code`, **bold**, [text](link).
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^- /, '• ')

const stamp = new Date().toISOString().slice(0, 10)
const body = sections
  .filter((s) => s.diagrams.length)
  .map(
    (s) => `
  <section>
    <h2>${esc(s.title)}</h2>
    ${s.diagrams.map((d) => `<pre class="mermaid">${esc(d)}</pre>`).join('\n    ')}
    ${s.notes.length ? `<div class="notes">${s.notes.map((n) => `<p>${inline(n)}</p>`).join('')}</div>` : ''}
  </section>`
  )
  .join('\n')

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nutrition Tracker — Architecture</title>
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
  header { padding: 24px 32px; background: #0f172a; color: #f8fafc; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header p { margin: 0; color: #94a3b8; font-size: 13px; }
  main { max-width: 1100px; margin: 0 auto; padding: 16px 24px 48px; }
  section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin: 16px 0; }
  h2 { font-size: 17px; margin: 0 0 12px; }
  pre.mermaid { background: transparent; margin: 0; text-align: center; }
  .notes { margin-top: 12px; font-size: 13px; color: #475569; }
  .notes p { margin: 4px 0; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Nutrition Tracker — Architecture</h1>
  <p>Generated ${stamp} from docs/ARCHITECTURE.md · edit the .md, then run <code>node docs/build-diagrams.mjs</code></p>
</header>
<main>
${body}
</main>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
  mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'strict', flowchart: { htmlLabels: true } })
</script>
</body>
</html>
`

writeFileSync(join(here, 'architecture.html'), html)
console.log(`architecture.html written — ${sections.filter((s) => s.diagrams.length).length} sections`)
