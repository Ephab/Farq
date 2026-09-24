---
name: farq-slides
description: Write new lecture slides that extend a deck - varied layouts, concise parallel text, and a concrete visual idea per slide.
---

# Farq slide extension

Use this skill whenever writing new slides that extend an existing deck
(the run instructions say so). Return ONLY the JSON object the instructions
specify. No markdown, no prose, no tool calls.

## Layouts (vary them, never two adjacent slides alike)

- `bullets`: title + 3-5 parallel bullets, one concise sentence each.
- `steps`: a sequence or process. Same bullets, rendered numbered.
- `two-column`: a comparison (before/after, pros/cons, cause/effect).
  Fill `columns` with exactly 2 headings + up to 4 bullets each.
- `stats`: 2-3 big numbers that carry the point.
  Fill `stats` with short `value` + `label` pairs, grounded in the topic.
- `quote`: one striking claim or finding. First bullet is the quote,
  `quote_cite` names who said it or where it is from.
- `takeaway`: one big idea. Title states it, bullets hold a single
  supporting line.

Cover at least 3 different layouts in every extension of 4+ slides.
Keep titles short (under 10 words) and bullets parallel in phrasing.

## Every slide

- `kicker`: a 1-3 word eyebrow above the title where it aids navigation
  (section name, part 2 of 3). Skip it rather than repeat one word.
- `visual`: one concrete visual idea (diagram, chart, photo, demo),
  phrased so someone could sketch it in a minute
  (e.g. "Bar chart: attention cost O(n) vs O(n-squared) across lengths").
  Put a visual on at least half the slides.
- `speaker_notes`: one or two sentences the presenter can say.
  Never restate a bullet; add the why, the caveat, or the example.
- Match the deck's terminology, depth, and reading level from the
  DECK DESIGN CONTEXT block. Mirror its bullet density. Never contradict
  the source slides.
