// Presentation metadata for the five domains: icon, one-line description and the question types
// each plugin doc lists (backend/plugins/<id>/doc.md). Plugin ids are data here, not engine logic.
import { Brain, Crosshair, Gauge, Languages, Puzzle, type LucideIcon } from 'lucide-react';

export interface DomainMeta { id: string; name: string; icon: LucideIcon; blurb: string; types: string[] }

export const DOMAINS: DomainMeta[] = [
  { id: 'memory', name: 'Memory', icon: Brain, blurb: 'See, hear or read something, take a short break, then pick out what was there.', types: ['Image', 'Word', 'Audio', 'Story', 'Spatial', 'Daily life'] },
  { id: 'attention', name: 'Attention', icon: Crosshair, blurb: 'Keep focus during a stream of items and ignore what does not matter.', types: ['Stream', 'Arrows', 'Search', 'Code check', 'Letter count'] },
  { id: 'executive', name: 'Executive function', icon: Puzzle, blurb: 'Find unstated rules, hold things in mind and resist the obvious wrong answer.', types: ['Pattern grid', 'Next number', 'Odd number out', 'Interference', 'Back-matching'] },
  { id: 'language', name: 'Language', icon: Languages, blurb: 'Recognise word meanings and how words relate to each other.', types: ['Odd one out', 'Closest meaning', 'Definition'] },
  { id: 'processing_speed', name: 'Processing speed', icon: Gauge, blurb: 'Carry out very easy steps as quickly and accurately as you can.', types: ['Reaction', 'Choice reaction', 'Symbol to digit', 'Copy check', 'Quick sum'] },
];

export const domainMeta = (id: string) => DOMAINS.find((d) => d.id === id);

export function DomainIcon({ id, size = 18 }: { id: string; size?: number }) {
  const Icon = domainMeta(id)?.icon ?? Brain;
  return <span className="domain-icon" aria-hidden="true"><Icon size={size} /></span>;
}
