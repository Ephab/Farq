Waypoint · العرض الخامس · 3:30

Open index.html in Chrome or Edge. Fonts, animations, screenshots and MP4s are local.
No app server or Internet connection is needed to present. Keep the assets folder beside index.html.

Next: Space / Enter / Right / Down / PageDown / left click
Back: Left / Up / PageUp / Backspace / right click
Home / End: first / last slide
F: fullscreen   N: speaker notes   A: automatic 3:30 rehearsal
The small controls appear when you move the mouse or focus them with Tab.
A starts a complete rehearsal from the cover; any manual navigation stops rehearsal.

15 slides; one click per slide. Times include transitions:
00:00–00:08  Cover
00:08–00:28  Problems 1/2: lost direction, limited guidance, stamped university card and market gap
00:28–00:44  Published statistics: 48%, 39%, 95%, with their survey scope
00:44–00:54  Proposed value for students, universities and employers
00:54–01:16  Problems 2/2: AI solves without learning, scattered apps and uneven group work
01:16–01:23  Twelve apps gather into the point; the point reveals Waypoint
01:23–01:39  Overview, profile, imported records and student approval
01:39–01:53  Personal roadmap
01:53–02:08  Hermes coaching and practice
02:08–02:30  Quiz creation animation, question feedback and Blackboard slide workbench
02:30–02:44  Projects and evaluation
02:44–02:58  Group Projects
02:58–03:12  Co-op and CV
03:12–03:22  Eighth feature card: mail, learning updates, daily overview and settings
03:22–03:30  Closing

Cinematic motion:
The opening dot is already in place over the i. The road already extends from the logo's left tail.
The first click traces the logo's curl and winding line, exits through that tail, then follows the road down.
The camera follows a smooth central rail with gentle 3D perspective. During problems,
the road wanders beyond both screen edges and comes back, with loops, hard turns and forks.
Content remains readable while the road is visible in the gaps and around the cards.
The apps are directly before the reveal: the next click gathers the same icons into
the point, moves it into the logo, and reveals Waypoint outward from that point.
Before Waypoint, the road takes sharp turns, splits into alternatives and meets blocked branches.
After the reveal it becomes a smooth, clear path. The old tangled section remains part of the journey.
Entering features takes 1.3 seconds to zoom out to all eight cards, holds that view for 2 seconds,
then approaches the first card over 1 second. These animations fit within the profile slide's time.
Each following click closes the demo into its card, follows the center road, and opens the next card.
One separate panel and one uniformly scaled card ghost manage the transition. Demo HTML never stretches.
The closing view zooms further out to show the entire journey, including the early tangled road.
Cards and the two journey labels stay upright. One common ambient background serves the road and panels.
Travel, zooms and demo playback share the 210-second schedule; no extra clicks are added.

Statistics:
48%: Surveyed graduates feel unprepared even to apply for entry-level jobs in their field.
Cengage Group 2025 Graduate Employability Report. US survey, published 9 September 2025.
https://www.cengagegroup.com/news/press-releases/2025/cengage-group-2025-employability-report/
39%: Employers expect 39% of workers’ core skills to change by 2030.
World Economic Forum, Future of Jobs Report 2025, chapter 3.1.
https://www.weforum.org/publications/the-future-of-jobs-report-2025/in-full/3-skills-outlook/
95%: AI use in at least one way among surveyed full-time UK undergraduates.
HEPI / Kortext Student Generative AI Survey 2026, published 12 March 2026.
Savanta fieldwork in December 2025, n=1,054. This is not a Saudi student statistic.
https://www.hepi.ac.uk/reports/student-generative-ai-survey-2026/
The value slide describes proposed benefits, not measured outcomes or financial returns.

Media:
Refreshed from the current React UI using demo-student in an isolated browser.
Synthetic coach teaching messages are rendered by the real chat components.
The study demo uses a fictional Blackboard catalog, a small in-memory lecture PDF,
and local quiz-generation and slide-extension replies rendered by the current React components.
The quiz demo shows configuration, the animated liquid progress tube, the created quiz and feedback,
then crossfades to the Blackboard slide workbench. A gentle zoom holds on the creation card
so its liquid tube is visible within the demo panel. The browser clock advances the illustrative
waiting stage; this is not a claim about live AI generation speed.
The lecture library is shared by both tabs; no live AI generation or real Blackboard downloads occur.
Group Projects uses the bundled fictional local demo (Campus Compass).
All backend writes are blocked during capture. No prompts are sent to Hermes.
MP4s use 60 fps motion interpolation, H.264, and fast-start playback.
Only the visible demo plays and loops. Adjacent video metadata is loaded in advance.
Reduced-motion mode uses stationary slides and still posters.
Capture provenance is in assets/media-manifest.json.

To refresh again, with the current app running:
node "presentation/Presentation 5/capture.mjs"
For only the quiz creation update: add quiz-create to that command.
compose-study.mjs combines quiz-create.mp4 with the last 4.8 seconds of study-slides.mp4.
Requires the project Playwright dependency, Edge (or WAYPOINT_BROWSER=chrome), and ffmpeg/ffprobe.
WAYPOINT_CAPTURE_URL can override http://127.0.0.1:5173.
