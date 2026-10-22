// Exports every plugin design doc (plugins/<id>/doc.md) to Word, in the format of the supplied
// Memory Plugin doc: ../docs/plugins/<Name>PluginDocs.docx. The .md files stay the source of truth
// (the test suite checks them against each manifest). Uses macOS `textutil` for HTML → .docx.
// Usage: npm run docs:docx
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config';

const OUT = path.resolve(ROOT, '..', 'docs', 'plugins');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');

function toHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; ) {
    const l = lines[i]!;
    if (l.startsWith('# ')) { out.push(`<h1>${inline(l.slice(2))}</h1>`); i++; continue; }
    if (l.startsWith('## ')) { out.push(`<h2>${inline(l.slice(3))}</h2>`); i++; continue; }
    if (/^\s*- /.test(l)) {
      out.push('<ul>');
      let depth = 0;
      while (i < lines.length && /^\s*- /.test(lines[i]!)) {
        const d = lines[i]!.search(/\S/) >= 2 ? 1 : 0;
        if (d > depth) out.push('<ul>');
        if (d < depth) out.push('</ul>');
        depth = d;
        out.push(`<li>${inline(lines[i]!.replace(/^\s*- /, ''))}</li>`);
        i++;
      }
      if (depth) out.push('</ul>');
      out.push('</ul>');
      continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        if (!/^\|\s*-/.test(lines[i]!)) rows.push(lines[i]!.split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push('<table border="1" cellpadding="4" cellspacing="0">', ...rows.map((r, k) => `<tr>${r.map((c) => (k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`), '</table>');
      continue;
    }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    i++;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}code{font-family:Menlo,monospace;font-size:9.5pt}th{text-align:left}</style></head><body>${out.join('\n')}</body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const id of fs.readdirSync(config.PLUGINS_DIR).sort()) {
  const src = path.join(config.PLUGINS_DIR, id, 'doc.md');
  if (!fs.existsSync(src)) continue;
  const md = fs.readFileSync(src, 'utf8');
  const name = md.split('\n')[0]!.replace(/^# /, '').replace(/ Plugin$/, '').replace(/\s+/g, '');
  const html = path.join(OUT, `${name}PluginDocs.html`);
  const docx = path.join(OUT, `${name}PluginDocs.docx`);
  fs.writeFileSync(html, toHtml(md));
  try {
    execFileSync('textutil', ['-convert', 'docx', '-output', docx, html]);
    fs.rmSync(html);
    console.log(`${id}: ${path.relative(path.resolve(ROOT, '..'), docx)}`);
  } catch {
    console.log(`${id}: textutil unavailable (macOS only); wrote ${path.relative(path.resolve(ROOT, '..'), html)}`);
  }
}
