---
name: farq-quiz
description: Write study questions from lecture slides - plausible distractors, balanced true/false, deck-spread coverage, and explanations that teach.
---

# Farq quiz generation

Use this skill whenever writing study questions from a deck
(the run instructions say so). Return ONLY the JSON object the instructions
specify. No markdown, no prose, no tool calls.

## Coverage

- One question per distinct idea. Never two questions that test the same fact
  in different words — a learner should not meet the same point three times.
- Spread questions across the whole deck, not just the opening slides. Walk the
  source in order and pick from later sections too, so a 20-question set is not
  all slide 1-3.
- `source` must be a slide or page number that actually exists in the deck.
  Never invent a citation for content you cannot point to.
- Test the content, never the container: no "which slide mentions X", no
  questions about the deck's title, author, or structure.

## Difficulty

Apply the requested difficulty to what the learner must *do*, not to vocabulary:

- Easy — recall and recognition. Name the definition, term, or stated fact.
- Medium — comprehension. "Which statement about X is correct?", a
  cause-and-effect link, a missing step in a process.
- Hard — application and transfer. A new scenario the deck did not name, an
  edge case, a trade-off, or "given this, which approach and why".
- Mixed — span all three, hardest last so the set builds.

## Multiple choice (`mcq`)

- Distractors are the whole question. Each wrong option must be something a
  learner who half-remembers the slide would plausibly choose: a swapped term,
  a reversed relationship, the neighbouring concept from an earlier slide, a
  real technique used in the wrong place. An option no learner would ever pick
  is wasted space.
- Draw distractors from the deck's own vocabulary, not from outside material.
- Vary where the answer sits; do not make one letter correct every time.
- Never "all of the above", "none of the above", or two options that could both
  be true.
- Avoid giveaway absolutes ("always", "never", "only") unless the deck itself
  makes the statement absolute — a stem that always contains "always" is
  testable by pattern alone.

## True / false (`true_false`)

- Balance them: aim for roughly half True and half False in any set of four or
  more. A run of all-True questions is guessable without reading.
- False statements must be *plausible* denials of real slide content — a swapped
  direction, a wrong scope, a misattributed result — never nonsense.
- A false statement is a correction, so the explanation carries the real fact.

## Short answer (`short_answer`)

- The reference `answer` is 1-2 full sentences a learner could write, with the
  key terms spelled out, so grading is keyword-scannable. Do not make it a single
  word with one accepted spelling.
- Ask for the explanation or the mechanism ("why does X happen", "what does Y
  control"), not just a name that was given.

## Every question

- `explanation` teaches: it gives the reason, the mechanism, or the caveat the
  stem only alludes to. It must not restate the answer back as a sentence —
  that wastes the one field a learner reads after answering.
- If a question is answerable only by the exact phrasing of a slide, reword
  the stem so it tests the idea instead of the wording.
- Keep the stem under about 25 words and the options short enough to scan.
