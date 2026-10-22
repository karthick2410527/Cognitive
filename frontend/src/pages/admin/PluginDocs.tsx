// Admin → Test designs: renders backend/plugins/<id>/doc.md — the same files the backend test checks
// against each manifest, so what is shown here is what the code does.
import { Fragment, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DOMAINS, DomainIcon } from '../../components/domains';

const FILES = import.meta.glob('../../../../backend/plugins/*/doc.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const docFor = (id: string) => Object.entries(FILES).find(([p]) => p.includes(`/plugins/${id}/`))?.[1] ?? null;

/** Inline markup: `code`, bare URLs, and the "[We do not do this]" marker. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|https?:\/\/\S+|\[We do not do this\])/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('http')) return <a key={i} href={part} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\//, '')}</a>;
    if (part === '[We do not do this]') return <span key={i} className="no">we do not do this</span>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Bullet = { text: string; children: Bullet[] };

/** A small Markdown subset: #/## headings, nested "- " lists, pipe tables, paragraphs. */
function Markdown({ source }: { source: string }) {
  const out: ReactNode[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (line.startsWith('# ')) { out.push(<h1 key={i}>{inline(line.slice(2))}</h1>); i++; continue; }
    if (line.startsWith('## ')) { out.push(<h2 key={i}>{inline(line.slice(3))}</h2>); i++; continue; }
    if (/^\s*- /.test(line)) {
      const root: Bullet[] = [];
      const start = i;
      while (i < lines.length && /^\s*- /.test(lines[i]!)) {
        const depth = lines[i]!.search(/\S/) >= 2 ? 1 : 0;
        const b = { text: lines[i]!.replace(/^\s*- /, ''), children: [] };
        if (depth && root.length) root[root.length - 1]!.children.push(b); else root.push(b);
        i++;
      }
      const list = (bs: Bullet[]): ReactNode => <ul>{bs.map((b, j) => <li key={j}>{inline(b.text)}{b.children.length > 0 && list(b.children)}</li>)}</ul>;
      out.push(<Fragment key={start}>{list(root)}</Fragment>);
      continue;
    }
    if (line.startsWith('|')) {
      const start = i;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        if (!/^\|\s*-/.test(lines[i]!)) rows.push(lines[i]!.split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={start} className="overflow-x-auto">
          <table>
            <thead><tr>{head!.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.trim()) out.push(<p key={i}>{inline(line)}</p>);
    i++;
  }
  return <>{out}</>;
}

export function PluginDocs() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);
  return (
    <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Plugins" className="lg:sticky lg:top-8 lg:self-start">
          <p className="eyebrow mb-3">Test designs</p>
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {DOMAINS.map((d) => (
              <li key={d.id}>
                <a href={`#${d.id}`} className="flex items-center gap-2 rounded px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-sunken hover:text-ink">{d.name}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-8">
          <header className="max-w-2xl">
            <p className="eyebrow mb-1.5">Plugin docs</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">How each test works</h2>
            <p className="mt-3 text-lg leading-relaxed text-muted">One short design note per plugin: what it tests, how questions are asked, what makes a question easy or hard, and the research behind it. The test suite fails if a note and its plugin's manifest disagree; export to Word with npm run docs:docx.</p>
          </header>
          {DOMAINS.map((d) => {
            const src = docFor(d.id);
            return (
              <article key={d.id} id={d.id} className="panel scroll-mt-6 p-6 sm:p-8">
                <div className="mb-4 flex items-center gap-3"><DomainIcon id={d.id} /><span className="font-mono text-xs uppercase tracking-wider text-faint">{d.id}</span></div>
                <div className="doc">{src ? <Markdown source={src} /> : <p>No design doc yet.</p>}</div>
              </article>
            );
          })}
        </div>
    </div>
  );
}
