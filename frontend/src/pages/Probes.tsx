// Cross-session delayed-recall probes: free recall, days after the session (Doc 05 §10).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Layout } from '../components/Layout';
import { Button, Card, Notice, Spinner, inputCls } from '../components/ui';

export function Probes() {
  const [probes, setProbes] = useState<{ probe_id: string; question: string }[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<{ due_at: string }[]>([]);
  useEffect(() => {
    void api<{ probes: { probe_id: string; question: string }[]; upcoming: { due_at: string }[] }>('GET', '/me/probes/due').then((r) => { setProbes(r.probes); setUpcoming(r.upcoming); }).catch((e) => setError(e.message));
  }, []);
  const send = async (id: string) => {
    try {
      const r = await api<{ grade: string }>('POST', `/probes/${id}/respond`, { answer: answers[id] ?? '' });
      setDone({ ...done, [id]: r.grade });
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Layout>
      <h1 className="mb-2 text-3xl font-semibold">Follow-up questions</h1>
      <p className="mb-6 text-muted">Some sessions end with a few questions about that day. A week or two later they are asked again here. Answer from memory; do not look anything up.</p>
      {error && <Notice tone="bad" title="Something went wrong">{error}</Notice>}
      {!probes ? <Spinner /> : !probes.length ? (
        <Card><p className="text-lg">Nothing is due right now.</p><p className="mt-1 text-muted">{upcoming.length ? `Your next follow-up question is due on ${new Date(upcoming[0]!.due_at).toLocaleDateString()}.` : 'Follow-up questions appear here on the date shown at the end of your report.'}</p></Card>
      ) : (
        <div className="space-y-4">
          {probes.map((p, i) => (
            <Card key={p.probe_id}>
              <label htmlFor={`a${i}`} className="mb-2 block text-lg font-bold">{p.question}</label>
              {done[p.probe_id] ? <p className="text-good font-bold">Saved. Thank you.</p> : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input id={`a${i}`} className={inputCls} value={answers[p.probe_id] ?? ''} onChange={(e) => setAnswers({ ...answers, [p.probe_id]: e.target.value })} maxLength={300} autoComplete="off" />
                  <Button onClick={() => send(p.probe_id)}>Save</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
