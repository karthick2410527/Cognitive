// Recognition scoring: accuracy per probe; the item contributes u = proportion of probes correct.
import { scoreChoiceGeneric, type ScoringModule } from '@cognimetric/core';

const scoring: ScoringModule = {
  scoreChoice: (input) => {
    const base = scoreChoiceGeneric(input);
    const wrong = base.per_probe.filter((c) => !c).length;
    return { ...base, derived: { ...base.derived, foil_confusion_rate: base.per_probe.length ? wrong / base.per_probe.length : null } };
  },
};

export default scoring;
