# Language Plugin

- Word meaning (Hard, knowing a rare word. E.g. which word means "a long, boring speech"?)
- Word links (Easy, seeing which words go together. E.g. cup goes with saucer, not with tiger)

## How we ask questions

- Names of people, brands or places [We do not do this].
- Idioms, proverbs, slang – only some cultures know them [We do not do this].
- Wrong answers that are a regional word for the right one [We do not do this].
- Options of different length or form that give the answer away [We do not do this].
- Odd one out – which word does not belong?
- Closest meaning – which option is closest in meaning to this word?
- Definition – read a short definition, pick the word.
  - Easy – common words learned early, wrong answers unrelated
  - Hard – rarer words learned later, wrong answers from the same narrow group

## Types

- Odd one out (`semantic_odd_one_out`)
- Closest meaning (`semantic_association`)
- Definition (`word_definition_choice`)
- Written – a written multiple-choice language question (`language_written`)

## Easy → Hard

| Lever | Easy | Hard |
| --- | --- | --- |
| `word_frequency` – how common the words are | High | Low |
| `age_of_acquisition` – when people learn the word | Early | Late |
| `imageability` – how easy it is to picture | High | Medium |
| `option_semantic_distance` – how close the wrong answers are | Unrelated | Same narrow group |
| `option_count` – choices | 3 | 4 |
| `time_limit_ms` – time for a written question | 35 s | 25 s |

## Reference

- Boston Naming Test (recognition form); Pyramids and Palm Trees (semantic association)
- Semantic tests in cognitive screening (Li et al., 2022) – https://doi.org/10.3389/fneur.2022.884460
- Clustering and switching in verbal fluency (Troyer, Moscovitch & Winocur, 1997, Neuropsychology 11(1):138–146)
- Word norms: SUBTLEX frequency, Kuperman age of acquisition, Brysbaert concreteness
