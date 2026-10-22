# Processing Speed Plugin

- Reaction speed (Easy, one shape, one key. E.g. press as soon as the shape appears)
- Working speed (Hard, many easy steps in a row. E.g. use the key to turn each symbol into a digit)

## How we ask questions

- Hiding the symbol key – then it is memory, not speed [We do not do this].
- Rule switching or trick questions – speed tasks are always easy to understand [We do not do this].
- Long questions without a short time limit (over 15 s) [We do not do this].
- Blocks longer than 2 minutes [We do not do this].
- Reaction – press when the shape appears, after a wait you can't predict.
- Choice reaction – one of several shapes appears; press its key.
- Symbol to digit – the key stays on screen; enter the digit for each symbol.
- Quick checks – find the exact copy of a code; one easy sum.
  - Easy – few choices, short codes, symbols that look different, more time
  - Hard – more choices, longer codes, look-alike symbols, less time

## Types

- Reaction – simple reaction time (`simple_rt_block`)
- Symbol to digit – symbol substitution (`symbol_substitution_block`)
- Choice reaction – choice reaction time (`choice_rt_block`)
- Copy check – find the exact copy of a code (`code_match`)
- Quick sum – one easy sum against the clock (`quick_arithmetic`)
- Written – a short written speed question (`speed_written`)

## Easy → Hard

| Lever | Easy | Hard |
| --- | --- | --- |
| `choice_alternatives` – shapes to choose between | 2 | 4 |
| `key_size` – symbols in the key | 6 | 9 |
| `symbol_discriminability` – how different the symbols look | High | Medium |
| `stimulus_density` – symbols per row | 8 | 16 |
| `code_length` – characters in the code | 4 | 7 |
| `arithmetic_operation` – the sum | Add single digits | Multiply single digits |
| `option_count` – choices | 3 | 4 |
| `time_limit_ms` – time per question | 10–12 s | 6–8 s |

## Reference

- Smartphone symbol-digit test (van Oirschot et al., 2020) – https://mhealth.jmir.org/2020/10/e18160 (a digital substitution block is not the SDMT and is never reported as one)
- Symbol Digit Modalities Test; WAIS Coding / Digit Symbol
- Simple and choice reaction time (Seli et al., 2013) – https://doi.org/10.3389/fpsyg.2013.00265
