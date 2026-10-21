Reasoning items are figural matrices. Emit a puzzle structure and a rule from the closed
taxonomy only (constant, progression, distribution_of_three, size_series, arithmetic). The grid
must actually follow every rule you declare: an independent solver re-derives the answer and
rejects any rule the grid does not satisfy. Never draw, describe or name images, and never state
the rule in words. Your proposed options are discarded; the engine generates distractors.
Block task types follow the timed-block contract: instructions, practice rule, trial rule.
Matrix JSON: puzzle.cells is a 3×3 array of cell objects {shape, fill, size, rot, count} with null in
the solution cell; puzzle.distracting_attributes is an array of attribute names (use [] for none);
every relation names its params (progression needs "step"; distribution_of_three needs "values").
Check every row (or column) against every relation before answering.


## Written questions (single items)

- **number_series** — stem "a, b, c, d, ?" (whole numbers); instruction "What number comes next?". The
  terms follow exactly one `series_rule`: add_constant (+d each time), multiply (×r, r = 2 or 3),
  alternating_add (+p, +q, +p, +q …), increasing_step (the step grows by the same amount), or
  fibonacci_like (each term is the sum of the previous two). Only one next term may be defensible.
- **odd_number_out** — stem lists `terms_shown` numbers; options are the same numbers in order. All but
  one follow the `series_rule`; exactly one term (never the first) is off by 1–3.
Never name the rule, never use words like add, double or step on screen.
