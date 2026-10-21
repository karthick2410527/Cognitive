# Executive Function plugin — research basis (summary of Doc 07)
## Rule count {#rule-count}
Figural difficulty is driven by rule count, operation type, analogical direction and distracting attributes (Yang et al., 2021; Sandia).
## Arity {#arity}
Unary, binary and ternary relations draw on different resources (Wang & Su, in Yang et al., 2021).
## Organisation {#organisation}
Separation → integration → embedding (Hornke & Habon, in Yang et al., 2021). Only separation is rendered in svg-2.0.
## Distracting attributes {#distracting}
Attributes that vary without a rule raise difficulty substantially; capped at 2.
## Distractors {#distractors}
Single-attribute distractors create a context-blind shortcut; fair sampling drops context-blind accuracy below 20 % (RAVEN-FAIR, Impartial-RAVEN).
## Time {#time}
Time pressure reduces strategy use (Doc 07 §3).
## Interference {#interference}
Literacy-free spatial and size Stroop analogues preserve interference logic (Doc 07 §2.1).
## Speed–accuracy {#sato}
Error counts are confounded with speed; residualise and use a deadline (Seli et al., 2013).
## n-back {#nback}
Load on updating scales with n; n±1 lures index imprecise updating; score d′, not accuracy (Doc 07 §5.2).
## References {#references}
- Miyake A, et al. Cognitive Psychology. 2000;41(1):49–100.
- Yang Y, et al. arXiv:2201.08450. https://arxiv.org/pdf/2201.08450
- Seli P, et al. Front Psychol. 2013;4:265. https://doi.org/10.3389/fpsyg.2013.00265

## Number series {#number-series}

`number_series` and `odd_number_out` are inductive-reasoning items in the number-series tradition
(Thurstone's Primary Mental Abilities "number series", the series subtests of Cattell's and many
aptitude batteries). Difficulty rises with the complexity of the rule (constant step → constant
ratio → alternating steps → second-order step → recursive sum) and falls with the number of terms
that evidence the rule. Terms stay below 2000 so arithmetic does not dominate. Added at the product
owner's request so that executive function has written questions; numbers are used without any
cultural content, and the rule is never stated on screen.


## Free-form written questions {#freeform}

`executive_written` questions are written by the item-writer prompt in `src/generation/freeform.ts`; the
writer chooses the question format within this domain. Difficulty is requested as a label (easy /
medium / hard, mapped from the target θ) and the engine — not the writer — assigns the item's
difficulty. Because no rule can check a free-form question, every answer key is confirmed by a second,
independent model call that answers without seeing the key. Added at the product owner's request.
