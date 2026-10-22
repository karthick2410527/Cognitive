# Memory Plugin

- Recall (Hard, asking a question with no help. E.g. What did you eat yesterday?)
- Recognition (Easy, seeing something again. E.g. Did I see this before?)

## How we ask questions

- Yes/No – Did you see this? People can guess easily [We do not do this].
- Choice – Which of these did you see?
  - Easy – fewer choices (2), wrong answers look totally different
  - Hard – more choices (4), wrong answers look almost the same
- Show → wait → pick: show the items, give a short break task, then ask.
- Random pop – items pop up in random places; we always say first that a memory test is coming.
- Real daily life – what they wore, ate, who they met [store the answer]. Wait some days (5–30). Ask again – same question, no options.
  - Ask things that change every day, not habits (not "what do you eat for breakfast") [We do not do this].

## Types

- Image – pictures, objects (`image_recognition_forced_choice`)
- Word – written words (`word_recognition_forced_choice`)
- Audio – sounds, not words: bell, horn, knock (`audio_recognition_forced_choice`)
- Story – short story, asked about its details (`story_recognition_forced_choice`)
- Spatial – where something was, not what (`spatial_location_recognition`)
- Daily life – real-life question asked again days later (`autobiographical_delayed_recall`)
- Written – a written multiple-choice memory question (`memory_written`)

## Easy → Hard

| Lever | Easy | Hard |
| --- | --- | --- |
| `set_size` – items shown | 1–2 | 6–10 |
| `option_count` – choices | 2 | 4 |
| `foil_similarity` – how alike the wrong answers are | Totally different (apple vs hammer) | Almost the same (apple vs near-identical apple) |
| `exposure_ms` – time each item is shown | 3–9 s | 2–3.5 s |
| `position_policy` – where pictures appear | Middle of the screen | Random place |
| `delay_ms` – wait before the questions | 12 s | 30 s |
| `retrieval_cue` – hint at the question | "It was number 2" | No hint |
| `delay_days` – daily-life wait | 5 days | 30 days |

## Reference

- Forced-choice (Migo et al., 2014 – forced-choice recognition memory study) – https://doi.org/10.1080/17470218.2014.910240
- This format (show → delay → pick) is clinically validated (Barnett et al., 2015 – CANTAB PAL) – https://www.researchgate.net/publication/308339154
- Real daily-life questions, Rivermead Behavioural Memory Test – https://pmc.ncbi.nlm.nih.gov/articles/PMC6857095/
- Forgetting over 4 weeks predicts decline better than a 30-minute test – https://pmc.ncbi.nlm.nih.gov/articles/PMC7523317
