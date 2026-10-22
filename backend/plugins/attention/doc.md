# Attention Plugin

- Sustained attention (Hard, keeping focus for a whole minute. E.g. press for every shape except the rare one)
- Selective attention (Easy, picking out what matters. E.g. which way does the middle arrow point?)

## How we ask questions

- No time limit at hard levels – people slow down and the attention cost disappears [We do not do this].
- Colour only – a difference you can only see in colour fails colour-blind people for the wrong reason [We do not do this].
- Rules you must remember – the rule always stays on screen [We do not do this].
- Stream – shapes flash one after another; press for each one, hold back on the rare target.
- Arrows – the middle arrow, with side arrows pointing the same or the other way.
- Search – is the target shape somewhere in the grid?
- Checking – which row has two codes that are not the same? How many times does this letter appear?
  - Easy – short codes and lines, letters that look different, slow pace
  - Hard – long codes and lines, look-alike letters (O/Q, E/F), fast pace

## Types

- Stream – press for all except the target (`sustained_response_block`)
- Arrows – middle arrow among side arrows (`flanker_block`)
- Search – find the target shape in a grid (`visual_search_block`)
- Code check – find the row whose two codes differ (`mismatch_pair`)
- Letter count – count one letter in a line (`letter_count`)
- Written – a written multiple-choice attention question (`attention_written`)

## Easy → Hard

| Lever | Easy | Hard |
| --- | --- | --- |
| `target_rate` – how often the rare target comes | 1 in 4 | 1 in 9 |
| `isi_ms` – gap between shapes | 1.8 s | 1.15 s |
| `response_deadline_ms` – time to answer each shape | 3 s | 0.9–1 s |
| `congruency_ratio` – side arrows that agree | 70 % | 50 % |
| `set_sizes` – shapes in the search grid | 8, 16 | 12, 24, 36 |
| `code_length` – characters to compare | 4 | 8 |
| `difference_confusability` – how alike the changed character is | Clearly different | Look-alike (O/Q) |
| `line_length` – letters in the counting line | 12 | 26 |
| `time_limit_ms` – time for a written question | 30–35 s | 16–25 s |

## Reference

- Sustained Attention to Response Task (Seli et al., 2013) – https://doi.org/10.3389/fpsyg.2013.00265
- Flanker / Attention Network Test (Fan et al., 2002, J Cogn Neurosci 14(3):340–347)
- Attention Network Test in older adults (Ishigami & Klein, 2011) – https://doi.org/10.3389/fnagi.2011.00017
- Letter cancellation and clerical checking tests (Minnesota Clerical Test)
