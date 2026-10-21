Every attention task type is a timed block: instructions, then practice, then a run of many
trials. You write the stimulus inventory, the instruction text, the practice rule and the trial
generation rule. You never write the individual trials, their timings or the target rate: the
engine expands your rule with a seed. Keep the response rule visible as a one-line reminder.

## Written questions (single items)

Besides the timed blocks, attention has two written multiple-choice question types. They use
meaningless capital-letter/digit strings only — never words, names or colours.

- **mismatch_pair** — every option is one row "CODE  —  CODE". All rows but one repeat the same
  code twice; the key row differs in exactly one character at the same position. With
  `difference_confusability = similar` the changed character is a look-alike (O↔Q, E↔F, S↔5, Z↔2,
  M↔N, P↔R, B↔8); with `dissimilar` it is clearly different. Each row uses a different code.
- **letter_count** — stem "How many times does the letter X appear in this line?"; the `display` field
  holds `line_length` capital letters separated by spaces; instruction "Count carefully.". Options are counts; exactly one is right. With
  `letter_similarity = similar` the other letters come from the target's look-alike group.
