# Group Projects interface

The workspace puts one task in focus at a time. A short project header and horizontal
navigation replace the permanent project rail. The app sidebar keeps the student's
chosen state. Chat starts open alongside the selected view on
wide screens and fills the workspace on phones. People and project administration live
in a drawer; task editing keeps its own drawer.

The home page separates projects from classes. Creating or joining uses a focused drawer.
Project rows show a name, course context, membership, and progress without decorative
covers or repeated hover summaries. Shared account, coach access, and local migration
remain available from settings.

Use the app's existing surface, text, line, and accent tokens in every theme. Display
type is Bricolage Grotesque, with Instrument Sans for controls and body copy. Project
colour appears only in a small identifying mark. Normal sentence-case headings, fine
dividers, compact controls, and content-sized sections create hierarchy without a stack
of oversized cards. The setup page pairs the two editable briefs and folds the detailed
import workflow behind a clearly labelled disclosure.

The default White theme maps these roles to paper `#ffffff`, workspace `#f8f8f9`,
ink `#09090b`, secondary text `#65656f`, hairline `#e4e4e7`, and status green
`#13795a`. Theme tokens replace these values when the student changes theme.
Align titles, tabs, and content to the same leading edge in either reading direction.

```text
Home                         Project
Title       Create / Join    Back  Project name       People  Chat
Projects | Classes           Tasks | Timeline | Docs | Decisions | Activity | Setup
Project rows                 Selected view             [optional chat]
                             Content-sized sections
```

Self-review: avoid dashboard tiles, decorative gradients, repeated metadata, and empty
minimum-height panels. Keep task columns readable when chat opens, preserve chat drafts
when it closes, support keyboard navigation and RTL, and use local scrolling on phones.
