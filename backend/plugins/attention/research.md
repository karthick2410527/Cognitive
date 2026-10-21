# Attention plugin — research basis (summary of Doc 06)

## Duration {#duration}
Vigilance decrement grows with time on task; a 90-second block cannot show it (Doc 06 §4).
## Target rate {#target-rate}
SART uses ~11 % no-go trials over 630 trials (Seli et al., 2013); rarer targets are harder.
## Timing {#timing}
Shorter ISI / exposure and jitter reduce preparation (Doc 06 §4).
## Speed–accuracy trade-off {#sato}
SART commission errors correlate with RT at r = 0.77; after controlling RT, instructed speed
effects vanish (Seli et al., 2013). Residualise on RT; enforce a deadline above θ = 0.5.
## Flanker {#flanker}
Executive-control network effect from flanker incongruency (Fan et al., 2002; Ishigami & Klein, 2011).
## Difference scores {#difference-scores}
Single-session reliability of network scores is modest; ≥ 40 trials per condition (Ishigami & Klein, 2011).
## Search {#search}
RT slope across set size indexes search efficiency independent of motor speed (Doc 06 §5).
## Practice {#practice}
Practice before every block with a pass gate; practice never enters a score (Doc 10 §3.2).
## References {#references}
- Fan J, et al. J Cogn Neurosci. 2002;14(3):340–347.
- Ishigami Y, Klein RM. Front Aging Neurosci. 2011;3:17. https://doi.org/10.3389/fnagi.2011.00017
- Seli P, et al. Front Psychol. 2013;4:265. https://doi.org/10.3389/fpsyg.2013.00265

## Written checking {#written-checking}

`mismatch_pair` is a clerical-checking item (name/number comparison, as in the Minnesota Clerical Test
and the "same–different" checking subtests of aptitude batteries). Difficulty rises with the number of
characters to compare and with how alike the changed character is to the original (shape confusions
such as O/Q, E/F, S/5 slow and impair detection). Added at the product owner's request so that every
domain has written questions; it is a single-item measure and carries less information than a block.

## Written counting {#written-counting}

`letter_count` is a cancellation/counting item (letter cancellation tests). Scanning time grows with line
length and errors grow when the other letters share features with the target. Same caveat as above.


## Free-form written questions {#freeform}

`attention_written` questions are written by the item-writer prompt in `src/generation/freeform.ts`; the
writer chooses the question format within this domain. Difficulty is requested as a label (easy /
medium / hard, mapped from the target θ) and the engine — not the writer — assigns the item's
difficulty. Because no rule can check a free-form question, every answer key is confirmed by a second,
independent model call that answers without seeing the key. Added at the product owner's request.
