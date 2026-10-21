# Processing Speed plugin — research basis (summary of Doc 09)
## Substitution {#substitution}
SDMT-style substitution quantifies visuospatial processing speed in 90 s (van Oirschot et al., 2020). Key size, key position and density add load without adding decisions.
## Discriminability {#discriminability}
Shorter exposure and similar glyphs reduce per-trial discrimination speed (Memory reference §7).
## Choice {#choice}
Donders' choice cost grows with the number of alternatives; choice cost = choice − simple median RT.
## Duration {#duration}
90 s matches the SDMT convention; never above 120 s, to avoid vigilance decrement (Doc 09 §2.1).
## References {#references}
- van Oirschot P, et al. JMIR mHealth uHealth. 2020;8(10):e18160. https://mhealth.jmir.org/2020/10/e18160
- Seli P, et al. Front Psychol. 2013;4:265. https://doi.org/10.3389/fpsyg.2013.00265
- A digital substitution block is not the SDMT and must never be reported as one (van Oirschot et al., 2020).

## Written speed questions {#written-speed}

`code_match` (clerical speed: find the exact copy, as in perceptual-speed "identical pictures/numbers"
tests) and `quick_arithmetic` (number facility under time pressure) are single, time-limited items.
Difficulty comes mostly from the time limit; code length and operand size add load. They were added at
the product owner's request so processing speed has written questions. The original guideline
excluded multiple-choice items because one item carries little information; they are therefore kept
very short (≤ 15 s) so a session can include many, and the block tasks remain the primary measure.


## Free-form written questions {#freeform}

`speed_written` questions are written by the item-writer prompt in `src/generation/freeform.ts`; the
writer chooses the question format within this domain. Difficulty is requested as a label (easy /
medium / hard, mapped from the target θ) and the engine — not the writer — assigns the item's
difficulty. Because no rule can check a free-form question, every answer key is confirmed by a second,
independent model call that answers without seeing the key. Added at the product owner's request.
