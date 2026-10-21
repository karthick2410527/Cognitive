# Language plugin — research basis (summary of Doc 08)
## Frequency {#frequency}
Word frequency (Zipf) is the single best predictor of naming difficulty (SUBTLEX norms).
## Age of acquisition {#aoa}
Later-acquired words are retrieved less reliably and lost earlier (Kuperman et al. AoA norms).
## Imageability {#imageability}
Concrete, imageable words are easier to retrieve (Brysbaert concreteness norms).
## Semantic distance {#distance}
Close semantic competitors make recognition genuinely hard; distance is verified against the lexicon's category tree.
## Education and locale {#fairness}
Naming cutoffs can overestimate deficits with limited education (Li et al., 2022). Education, first language and test language are stored and reported; adjustment is never silent.
## References {#references}
- Li D, et al. Front Neurol. 2022;13:884460. https://doi.org/10.3389/fneur.2022.884460
- Troyer AK, Moscovitch M, Winocur G. Neuropsychology. 1997;11(1):138–146.
- SUBTLEX frequency norms; Kuperman et al. AoA norms; Brysbaert et al. concreteness norms.
- NOTE: the development lexicon in data/lexicon uses APPROXIMATE placeholder values; replace with the licensed norm files before calibration.


## Free-form written questions {#freeform}

`language_written` questions are written by the item-writer prompt in `src/generation/freeform.ts`; the
writer chooses the question format within this domain. Difficulty is requested as a label (easy /
medium / hard, mapped from the target θ) and the engine — not the writer — assigns the item's
difficulty. Because no rule can check a free-form question, every answer key is confirmed by a second,
independent model call that answers without seeing the key. Added at the product owner's request.
