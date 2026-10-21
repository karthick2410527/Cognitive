// Delayed free recall is scored by the cross-session module's graded matcher (Doc 05 §10),
// never folded into the same-session memory θ.
import type { ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {};
export default scoring;
