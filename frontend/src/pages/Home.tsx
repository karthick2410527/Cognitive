// Landing page: its own top navigation (no app sidebar), hero with a product preview, feature bento,
// how-it-works, the five areas, and a closing call to action. Every claim here is true of the app.
import { Link } from 'react-router-dom';
import { Accessibility, ArrowRight, Check, Lock, PenLine, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { useAuth } from '../auth';
import { ThemeSwitcher, Wordmark } from '../components/Layout';
import { buttonCls } from '../components/ui';
import { DOMAINS, DomainIcon } from '../components/domains';

function SiteNav() {
  const { me } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-line/60 bg-paper/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Sections" className="hidden items-center gap-1 text-sm text-muted md:flex">
          <a href="#product" className="rounded-lg px-3 py-1.5 hover:bg-surface hover:text-ink">Product</a>
          <a href="#how" className="rounded-lg px-3 py-1.5 hover:bg-surface hover:text-ink">How it works</a>
          <a href="#areas" className="rounded-lg px-3 py-1.5 hover:bg-surface hover:text-ink">What we measure</a>
          <a href="#privacy" className="rounded-lg px-3 py-1.5 hover:bg-surface hover:text-ink">Privacy</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {me ? (
            <>
              <Link to="/history" className="btn-quiet hidden min-h-[38px] px-3 text-sm sm:inline-flex">Dashboard</Link>
              <Link to="/start" className="btn-primary min-h-[38px] px-4 text-sm">New session</Link>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-quiet min-h-[38px] px-3 text-sm">Sign in</Link>
              <Link to="/register" className="btn-primary min-h-[38px] px-4 text-sm">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Product preview: a framed question card with the live domain panel beside it. */
function ProductPreview() {
  return (
    <div className="relative mx-auto mt-16 max-w-5xl text-left" aria-hidden="true">
      <div className="glow absolute inset-x-10 -top-10 h-72" />
      <div className="mock relative">
        <div className="mock-bar"><i /><i /><i /><span className="ml-3 rounded-md bg-surface px-3 py-0.5 font-mono text-[0.6875rem] text-faint">cognimetric · session</span></div>
        <div className="grid gap-5 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_230px]">
          <div>
            <div className="mb-4 flex items-center justify-between font-mono text-xs text-muted">
              <span>Question <b className="text-ink">7</b> of up to 36</span><span>19%</span>
            </div>
            <div className="progress-track mb-5"><div className="progress-fill" style={{ width: '19%' }} /></div>
            <div className="qcard text-left">
              <div className="qcard-meta"><span><span className="text-accent">Memory</span> · Q7 · story recognition</span><span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent">live</span></div>
              <div className="qcard-body !py-5">
                <div className="phase-steps !mb-4"><span className="phase-step phase-step-done"><span className="phase-dot">✓</span>Read</span><span className="phase-rule" /><span className="phase-step phase-step-done"><span className="phase-dot">✓</span>Short break</span><span className="phase-rule" /><span className="phase-step phase-step-on"><span className="phase-dot">3</span>Answer</span></div>
                <p className="qcard-prompt mb-4">What colour was the umbrella?</p>
                <div className="grid gap-2.5">
                  {['green', 'teal', 'purple'].map((o, i) => (
                    <div key={o} className={`optrow min-h-[48px] ${i === 1 ? 'optrow-selected' : ''}`}><span className="optrow-key">{'ABC'[i]}</span><span className="font-medium">{o}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="hidden space-y-2 md:block">
            <p className="eyebrow mb-2">Domains</p>
            {DOMAINS.map((d, i) => (
              <div key={d.id} className={`domain-row ${i === 0 ? 'domain-row-active' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="domain-row-name text-left">{d.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[0.625rem] font-medium ${i < 2 ? 'bg-accent/10 text-accent' : 'bg-sunken text-muted'}`}>{i < 2 ? 'more' : 'fewer'}</span>
                </div>
                <div className="domain-bar-track"><div className="domain-bar-fill" style={{ width: `${[38, 52, 71, 64, 80][i]}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Floating callout */}
      <div className="panel absolute -left-8 bottom-10 hidden items-center gap-3 px-4 py-3 lg:flex">
        <span className="icon-tile !h-8 !w-8"><TrendingUp size={16} /></span>
        <div className="text-left"><p className="text-sm font-semibold">Correct, next one is harder</p><p className="text-xs text-muted">Difficulty adapts after every answer</p></div>
      </div>
    </div>
  );
}

/** Illustrative staircase: difficulty steps up after a right answer and down after a wrong one. */
function AdaptiveSpark() {
  const steps = [0, 1, 2, 1, 2, 3, 2.5, 3, 2.75, 3, 2.9];
  const W = 420, H = 120;
  const x = (i: number) => 10 + (i * (W - 20)) / (steps.length - 1);
  const y = (v: number) => H - 14 - (v / 3.2) * (H - 30);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-6 w-full" aria-hidden="true">
      <line x1={10} x2={W - 10} y1={y(2.9)} y2={y(2.9)} stroke="rgb(var(--c-accent))" strokeOpacity={0.35} strokeDasharray="4 5" />
      <text x={W - 10} y={y(2.9) - 7} textAnchor="end" fontSize={11} fill="var(--muted)">your level</text>
      <polyline points={steps.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {steps.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={4} fill="var(--surface)" stroke="rgb(var(--c-accent))" strokeWidth={2} />)}
    </svg>
  );
}

const STEPS: [string, string, string][] = [
  ['Set up in two minutes', 'Pick a session and tell us about eyesight, reading and hands, so every task suits you.', '01'],
  ['Take the session', 'About 25 minutes of questions and short timed tasks. Take a break whenever you like and resume within 24 hours.', '02'],
  ['See your profile', 'A score for each area with an honest precision range, and how it changes across sessions.', '03'],
];

export function Home() {
  const { me } = useAuth();
  const cta = me ? '/start' : '/register';
  return (
    <div className="min-h-screen overflow-x-hidden">
      <SiteNav />
      <main id="main">
        {/* Hero */}
        <section className="relative">
          <div className="hero-grid pointer-events-none absolute inset-0 h-[720px]" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-24">
            <span className="badge"><span className="badge-dot" /> New questions written and checked live</span>
            <h1 className="mx-auto mt-6 max-w-4xl text-[2.6rem] font-semibold leading-[1.04] sm:text-6xl lg:text-[4.5rem]">
              <span className="text-shine">Understand how your mind works,</span>{' '}
              <span className="text-accent-shine">in 25 minutes.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
              Cognimetric measures memory, attention, reasoning, language and speed with tasks that adapt after every answer, so the session stays challenging without becoming overwhelming.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link to={cta} className={`${buttonCls('primary', 'lg')} px-7`}>Start a session <ArrowRight size={17} /></Link>
              <a href="#how" className={`${buttonCls('secondary', 'lg')} px-7`}>See how it works</a>
            </div>
            <ul className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted">
              {['No email or real name', 'Take breaks between tasks', 'Works on phone and computer'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5"><Check size={15} className="text-accent" /> {t}</li>
              ))}
            </ul>
            <ProductPreview />
          </div>
        </section>

        {/* Facts strip */}
        <section aria-label="At a glance" className="border-y border-line/60 bg-surface/40">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-4 py-10 sm:px-6 md:grid-cols-4">
            {[['5', 'areas of thinking'], ['29', 'question formats'], ['≈25 min', 'standard session'], ['0', 'personal identifiers']].map(([v, l]) => (
              <div key={l} className="text-center">
                <dt className="sr-only">{l}</dt>
                <dd className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{v}</dd>
                <dd className="mt-1 text-sm text-muted">{l}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Bento */}
        <section id="product" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Product</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">A test that meets you where you are</h2>
            <p className="mt-4 text-lg text-muted">Fixed tests waste half their questions on things that are far too easy or far too hard. Cognimetric spends every question where it learns the most.</p>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-6">
            <div className="bento md:col-span-4">
              <span className="icon-tile"><TrendingUp size={19} /></span>
              <h3 className="mt-5 text-xl font-semibold">Adapts after every answer</h3>
              <p className="mt-2 max-w-md text-muted">Right answers step the difficulty up, misses step it down, and the session settles on your level. Areas that are still uncertain get more questions; settled ones get fewer.</p>
              <AdaptiveSpark />
            </div>
            <div className="bento md:col-span-2">
              <span className="icon-tile"><PenLine size={19} /></span>
              <h3 className="mt-5 text-xl font-semibold">Written for you, then checked</h3>
              <p className="mt-2 text-muted">An AI writer drafts each new question; a second, independent check must reach the same answer before you see it.</p>
              <div className="mt-6 space-y-2 text-sm">
                {['Writer drafts the question', 'Checker answers it blind', 'Rules check reading level and format'].map((t, i) => (
                  <div key={t} className="flex items-center gap-3 rounded-xl border border-line/80 bg-paper/60 px-3 py-2.5"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 font-mono text-[0.6875rem] text-accent">{i + 1}</span>{t}</div>
                ))}
              </div>
            </div>
            <div className="bento md:col-span-2">
              <span className="icon-tile"><Sparkles size={19} /></span>
              <h3 className="mt-5 text-xl font-semibold">More than multiple choice</h3>
              <p className="mt-2 text-muted">Stories, sounds, pictures, number patterns and quick timed tasks, about 70 % written questions and 30 % visual tasks.</p>
            </div>
            <div className="bento md:col-span-2">
              <span className="icon-tile"><Accessibility size={19} /></span>
              <h3 className="mt-5 text-xl font-semibold">Built for everyone</h3>
              <p className="mt-2 text-muted">Light, low-glare and high-contrast themes, larger text and buttons, and sound-based memory tasks for people who find reading hard.</p>
            </div>
            <div id="privacy" className="bento scroll-mt-20 md:col-span-2">
              <span className="icon-tile"><Lock size={19} /></span>
              <h3 className="mt-5 text-xl font-semibold">Private by design</h3>
              <p className="mt-2 text-muted">A username is all you need. Answers about your day are encrypted and deleted after use.</p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-y border-line/60 bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="max-w-2xl">
              <p className="eyebrow">How it works</p>
              <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">Three steps. No preparation.</h2>
            </div>
            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {STEPS.map(([t, d, n]) => (
                <li key={n} className="bento">
                  <span className="font-display text-5xl font-semibold text-accent/25">{n}</span>
                  <h3 className="mt-4 text-xl font-semibold">{t}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Areas */}
        <section id="areas" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">What we measure</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">Five areas, one clear picture</h2>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DOMAINS.map((d) => (
              <div key={d.id} className="bento transition-transform duration-200 hover:-translate-y-0.5">
                <DomainIcon id={d.id} />
                <h3 className="mt-5 text-lg font-semibold">{d.name}</h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">{d.blurb}</p>
                <div className="mt-5 flex flex-wrap gap-1.5">{d.types.map((t) => <span key={t} className="chip">{t}</span>)}</div>
              </div>
            ))}
            <div className="bento flex flex-col justify-between" style={{ background: 'linear-gradient(160deg, rgb(var(--c-accent) / 0.12), rgb(var(--c-surface)) 60%)' }}>
              <div>
                <span className="icon-tile"><ShieldCheck size={19} /></span>
                <h3 className="mt-5 text-lg font-semibold">Honest results</h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">Every score comes with how precise it is. An area that could not be measured fairly says so instead of guessing.</p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-accent/25 px-6 py-16 text-center sm:px-12" style={{ background: 'radial-gradient(800px 300px at 50% 0%, rgb(var(--c-accent) / 0.22), transparent 70%), rgb(var(--c-surface))' }}>
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold sm:text-5xl">Ready when you are.</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-muted">One session, about 25 minutes, and a clear picture of five areas of thinking.</p>
            <Link to={cta} className={`${buttonCls('primary', 'lg')} mt-8 px-8`}>Start a session <ArrowRight size={17} /></Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-md space-y-2">
            <Wordmark />
            <p className="text-sm text-muted">Cognimetric produces scores on tasks, not medical findings. No normative sample has been collected yet, so results cannot be compared with people of your age or education.</p>
          </div>
          <div className="w-32"><ThemeSwitcher /></div>
        </div>
      </footer>
    </div>
  );
}
