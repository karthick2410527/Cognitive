import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ArrowRight } from 'lucide-react';
import { buttonCls, Card, Notice } from '../components/ui';

const DOMAINS = [
  ['Memory', 'Remember pictures, words or places, then pick them out after a short break.'],
  ['Attention', 'Keep focus during a stream of items and ignore distractions.'],
  ['Executive function', 'Work out patterns, hold things in mind, and resist the obvious wrong answer.'],
  ['Language', 'Recognise word meanings and how words relate to each other.'],
  ['Processing speed', 'Carry out very easy steps as quickly as you can.'],
];

export function Home() {
  return (
    <Layout>
      <div className="space-y-8">
        <div className="space-y-4">
          <p className="eyebrow">Adaptive cognitive tasks</p>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Five short sets of tasks that adjust to you as you go.</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted">
            Each answer helps choose the next question, so the session stays at a level that is neither too easy nor too hard. A standard session takes about 25 minutes, and you can stop between tasks.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link to="/start" className={buttonCls('primary', 'lg')}>Begin <ArrowRight size={16} /></Link>
            <Link to="/history" className={buttonCls('secondary', 'lg')}>My history</Link>
          </div>
        </div>
        <Notice title="This is not a diagnosis">
          Cognimetric produces scores on these tasks, not medical findings. No normative sample has been collected yet, so results cannot be compared with people of your age or education.
        </Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          {DOMAINS.map(([t, d], i) => (
            <Card key={t} className="!p-5">
              <p className="mb-1 font-mono text-xs text-faint">0{i + 1}</p>
              <h2 className="mb-1 text-lg font-semibold">{t}</h2>
              <p className="text-muted">{d}</p>
            </Card>
          ))}
          <Card className="!p-5">
            <h2 className="mb-1 text-lg font-semibold">Your data</h2>
            <p className="text-muted">No name, email or date of birth is collected. Answers to the follow-up questions are encrypted and deleted after use.</p>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
