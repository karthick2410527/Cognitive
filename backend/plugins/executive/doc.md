# Executive Function Plugin

- Reasoning (Hard, finding a rule nobody tells you. E.g. which number comes next: 2, 4, 8, 16, ?)
- Control (Easy, holding back the obvious answer. E.g. press the side the arrow points to, not the side it is on)

## How we ask questions

- Rule written on screen – then it is reading, not reasoning [We do not do this].
- "None of the above" or "I don't know" options [We do not do this].
- Rules needing school or cultural knowledge – calendars, money, alphabet order [We do not do this].
- Pattern grid – a 3 × 3 grid with one piece missing; pick the piece that fits.
- Number row – pick the next number, or the one number that breaks the rule.
- Interference – answer the arrow's direction, ignore the side it appears on.
- Back-matching – press when the shape is the same as the one 1 or 2 steps back.
  - Easy – one simple rule (add the same number), many terms shown, slow pace
  - Hard – two or three rules at once, growing steps, look-alike wrong answers, fast pace

## Types

- Pattern grid – complete the 3 × 3 grid (`matrix_completion`)
- Interference – Stroop-like arrows and digits (`interference_block`)
- Back-matching – n-back with shapes (`n_back_block`)
- Next number – number series (`number_series`)
- Odd number out – the number that breaks the rule (`odd_number_out`)
- Written – a written multiple-choice reasoning question (`executive_written`)

## Easy → Hard

| Lever | Easy | Hard |
| --- | --- | --- |
| `rule_count` – rules in the grid | 1 | 3 |
| `option_count` – choices | 4 | 5–6 |
| `distractor_distance` – how close wrong answers are | Far | Minimal |
| `series_rule` – the number rule | Add the same number | Growing step |
| `terms_shown` – numbers shown | 6 | 5 |
| `n` – steps back to match | 1 | 2 |
| `lure_rate` – near-matches that trick you | 5 % | 25 % |
| `congruency_ratio` – trials where side and direction agree | 80 % | 50 % |
| `time_limit_ms` – time for a written question | 45–50 s | 30–40 s |

## Reference

- Unity and diversity of executive functions (Miyake et al., 2000, Cognitive Psychology 41(1):49–100)
- Raven's Progressive Matrices – pattern-grid reasoning; generated matrices (Yang et al., 2022) – https://arxiv.org/pdf/2201.08450
- Stroop Color and Word Test; Wisconsin Card Sorting Test; n-back
- Number series (Thurstone's Primary Mental Abilities)
