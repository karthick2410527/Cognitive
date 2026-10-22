# Memory plugin — research basis

This file is the plugin's design reference, mapped field-by-field onto the manifest per Doc 03 §9.
The supplied *Memory Plugin — Test Design Reference* is the primary source; the summary below
keeps one anchor per lever so every lever has a stated justification (Doc 03 §12 criterion 4).

## Recognition, not recall {#recognition}
Same-session measurement uses forced-choice recognition (Memory reference §1). Free recall is
used only for the cross-session probe, where its greater sensitivity to forgetting matters.

## Forced choice {#forced-choice}
Yes/No recognition has a 50 % guess floor; forced choice with `option_count` ≥ 2 replaces it
(Memory reference §2). `option_count` is a lever because guess rate is 1/option_count.

## Set size {#set-size}
More encoded items and more probed items increase load (Memory reference §5, levers table).

## Foil similarity {#foil-similarity}
Older adults are measurably impaired by high-similarity foils on forced-choice recognition
(Memory reference §7 proof table). Similarity classes come from the asset registry's neighbour
graph (glyph-pack-v1) or the lexicon's category tree — never from the model.

## Exposure and pacing {#exposure}
Shorter exposure and divided attention at encoding reduce later memory (Memory reference §7).

## Pop-up mode {#popup}
Random positions add spatial uncertainty; the user is always told up front (Memory reference §4).

## Delay and filler {#delay}
A filled delay prevents rehearsal, so retrieval reflects storage (Memory reference §3).

## Cueing {#cueing}
Cued retrieval is easier than uncued retrieval (Memory reference §10 levers).

## Delayed recall {#delayed-recall}
Forgetting over days to weeks is invisible at 30 minutes; four-week forgetting predicted later
decline where a 30-minute delay did not (Memory reference §10). Probes must concern details
that change daily.

## References {#references}
- Memory Plugin — Test Design Reference (supplied), §1–§10.
- CANTAB Paired Associates Learning; Rivermead Behavioural Memory Test (PMC6857095).


## Free-form written questions {#freeform}

`memory_written` questions are written by the item-writer prompt in `src/generation/freeform.ts`; the
writer chooses the question format within this domain. Difficulty is requested as a label (easy /
medium / hard, mapped from the target θ) and the engine — not the writer — assigns the item's
difficulty. Because no rule can check a free-form question, every answer key is confirmed by a second,
independent model call that answers without seeing the key. Added at the product owner's request.

## Story and audio material {#materials}

The supplied design doc (§9) lists five materials for the same show → delay → pick design: image, word,
audio, story and spatial. `story_recognition_forced_choice` shows a short story (one detail per sentence)
and asks about details ("What colour was the umbrella?"); at high foil similarity one foil is a detail the
story gave for something else, a binding error. `audio_recognition_forced_choice` plays synthetic sounds
(sound-pack-v1: bells, horns, knocks; no words) and offers sounds to play back; it suits low-literacy and
vision-impaired users and is excluded when a user reports impaired hearing. Both keep forced choice.
