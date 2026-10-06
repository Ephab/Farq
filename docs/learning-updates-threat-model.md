# Learning updates: threat model and rollout

Status: implemented, **paid refresh disabled by default**. Catalog `2026-10-04.v1` covers software,
AI, data science and cybersecurity. Unsupported roadmaps receive a coverage message, not invented topics.

## Boundary and data flow

Apify -> FastAPI validation/redaction -> shared SQLite public cache -> owner-scoped feed -> bounded
Hermes READ tools -> optional ordinary roadmap proposal. Subscriptions are explicit confirmations;
they are never StudentFacts. No social text enters evidence review, student memory, or automatic
roadmap edits. Only the existing acceptance endpoint can apply a proposal; protected nodes retain
existing validation. Browser and Hermes never receive Apify credentials or choose actor inputs.

Catalog aliases deterministically match active node titles and skills. No names, student IDs,
roadmap text, messages, cookies or profile targets go to Apify. Queries use only catalog keywords
and approved source identities. Current Reddit allowlist: programming, MachineLearning, datascience,
cybersecurity. Current X allowlist: github, huggingface, pytorch, GoogleDeepMind. Identity verification
against official project sites is still a rollout requirement: paid scraping is not enabled by this change.

Only the fixed actors below are accepted by server configuration (slash and Apify tilde spelling).
Input controls disable Reddit comments, NSFW inclusion, expanded searches and MCP delivery; the
application never fetches profiles, downloads media, posts, messages or follows outbound links.
X searches restrict authors and exclude replies/retweets. Actor media/profile metadata is discarded.

## Untrusted content and access

Actor output and public posts are untrusted, including apparent instructions. The API rejects
malformed records, missing/invalid/out-of-window publication dates, source violations, comment
records, NSFW records, replies and retweets. It verifies HTTPS source host, author/subreddit, post ID
and canonical permalink, rejects credentials/ports, and discards query strings and fragments.
No actor-supplied outbound URL is fetched. Titles (240 chars) and excerpts (800 chars) are redacted
for email/phone/identity numbers and common secret patterns; HTML and control/bidi characters are
stripped. Redaction is defense in depth, not a guarantee that all personal information is detected.
Reddit author usernames and full raw actor records are not stored.

React renders plain escaped text, never scraped HTML/Markdown or embedded media. Only validated
canonical source URLs are links (noopener/noreferrer). Posts are labelled community reports or project
announcements, not verified breakthroughs or platform-wide trends. Hermes is instructed to cite
source URL/date and treat retrieved text as data, never instructions, facts or memory. Prompt injection
cannot be eliminated by instructions; the API's existing grants, cited-own-message fact/memory rules,
proposal validation and explicit acceptance remain the authority. Hermes gets no new generic web,
terminal, browser or file tools.

Every student endpoint uses OwnedStudent/current_user. Internal endpoints require the internal token
and unexpired READ grant attached to a **running** AgentRun whose thread belongs to the grant's
student. Model-supplied student IDs cannot override this. Folder grants, queued runs, foreign threads,
expired grants and completed runs are refused. Tool lookup returns only followed, undismissed,
non-expired posts visible to that student. Reddit/X connector switches apply to the feed, tools and
scheduled demand. They default available for cache viewing; live scraping defaults off globally.
Turning a source off does not delete its shared public cache or cancel an already-paid run.

Posts expire 30 days after publication, with topic matches/dismissals cleaned together. Durable refresh
records are retained for billing/recovery. The public cache is shared; subscriptions and dismissals
are private. No student identifiers are added to refresh records. Engagement breaks only relevance/
publication-time ties; it does not assert representativeness.

## Queue, cost and recovery

SQLite BEGIN IMMEDIATE reserves each $0.10 allowance before a paid request. A partial unique index
coalesces active topic/source pairs across concurrent API processes. Actor runs request 50 items,
180 seconds, maxItems=50 and maxTotalChargeUsd=0.10. Daily limit defaults to $1 UTC, separate from
LinkedIn and model costs. Integer millionths avoid rounding underspend. Known terminal usageTotalUsd
reconciles reservations; absent charges stay reserved and are polled again. Old unresolved allowances
continue to consume available budget across midnight. Actual overages reduce subsequent capacity.

Scheduling ticks each minute and queues sources every six hours. Manual refresh shares the queue,
reservations and one-hour cooldown per topic/source. The least-recently-attempted sources are queued
first, so smaller budgets rotate sources fairly. Only enabled students' confirmed subscriptions create
demand. First fetch covers seven days; later windows overlap the last successful start by 24 hours.
Post/platform IDs deduplicate overlapping runs. Failure preserves cached results and last-success time.
No credentials or HTTP exception bodies are persisted or returned in status errors.

Reddit date filters use the actor's required `YYYY-MM-DD` format; local validation still enforces
the exact timestamp window. An explicit HTTP 400 `invalid-input` launch rejection is terminal at
zero charge, since the provider rejected the input before launching. Other errors and timeouts
remain unresolved. X `noResults` control records are not posts or validation failures. When a
dataset contains only these markers, the API reads at most 2 MiB of the same known run's log to
recognize the actor's monthly run limit. It persists only `provider_limited`, never log text, and
holds new attempts for that source for 24 hours. No log content reaches Hermes or student facts.

A launch POST is performed once: queued -> starting is committed first. Successful run IDs are persisted
before reading datasets. HTTP timeout/crash after launch must **never** create a replacement run.
Known IDs are polled on subsequent ticks/restarts, even if new launches are disabled. A starting row
older than five minutes becomes unresolved; its reservation and pair lock stay held. This intentionally
requires operator recovery when the provider accepted POST but the response was lost, because the
Apify start API does not provide a documented client idempotency key.

Local recovery: stop API workers; inspect the Apify console using the local row's actor, UTC creation
time and fixed catalog input. Verify the run and actual billed charge. If exactly one matching remote
run exists, bind its ID to the row and set state=running via a local SQLite maintenance transaction;
restart to poll it. If the provider confirms no run started, mark finished/failed with charged=0 and
finished_at. Never release a reservation or rerun based only on an HTTP timeout, elapsed time, or
absence in a partial console listing. There is intentionally no student/Hermes recovery mutation API.

The scheduler is in-process for this SQLite deployment. The unique index and transactional claims
protect launch duplication across workers; a distributed scheduler is future work. Shutdown may
leave a claimed launch unresolved, which is safe for cost but requires the recovery procedure above.

## Provider references and rollout gate

Reviewed public documentation 2026-10-04:
- [X actor input](https://apify.com/apidojo/tweet-scraper/input-schema): searchTerms, sort=Latest,
  maxItems; public listing advertises from $0.40/1000 tweets.
- [Reddit actor input](https://apify.com/fatihtahta/reddit-scraper-search-fast/input-schema):
  subredditName/Keywords, subredditSort/Timeframe, dateFrom/dateTo, maxPosts, scrapeComments,
  includeNsfw, maximize_coverage and mcpConnectors. Listing advertises from $1.19/1000 results.
- [Reddit output](https://apify.com/fatihtahta/reddit-scraper-search-fast/output-schema): kind, id,
  subreddit, created_utc (ISO string), permalink/url, over_18, body and score.
- [Apify Run Actor API](https://docs.apify.com/api/v2/actors-runs-post): timeout, waitForFinish,
  maxItems (paid dataset item cap) and maxTotalChargeUsd. Confirm that the actors' current billing
  models honor these caps: advertised per-result prices alone do not verify event/start charges.
- [Run lifecycle](https://help.apify.com/en/articles/3224035-run-actor-task-and-retrieve-data-via-api):
  remote runs continue independently of the client's wait.

Before setting BOTH LEARNING_UPDATES_ENABLED=true and LEARNING_UPDATES_ROLLOUT_REVIEWED=true:
1. Record source-policy/terms review for public Reddit/X collection and use in a student learning feed.
2. Verify approved X accounts from official project websites, including identity stability.
3. Confirm current actor billing and startup/event fees fit $0.10 and caps are honored at 50 posts.
4. Run one bounded live smoke test per actor through this queue with nonpersonal catalog inputs.
   Inspect accepted/rejected counts, canonical URLs, publication dates and recorded actual charges;
   verify no comments/NSFW/profile scraping/media downloads, and no third-party delivery occurs.
5. Record reviewer/date, tested actor build and charge in the rollout log below before enabling schedules.

Rollout log: **pending**. No paid live smoke test has been performed by this implementation. Do not
claim live refresh is verified. Schema fixtures and mocked HTTP tests cannot replace this check.
Provider summaries cost separately. No push notifications or automatic roadmap edits are introduced.

2026-10-05 repair verification: existing X runs returned repeated `noResults` markers and their
logs reported "Monthly run limit exceeded per user." Existing Reddit inputs failed the provider's
non-launching validate-input endpoint on timestamp-formatted dateFrom; the corrected date-only
inputs passed for all four topics. The local unresolved Reddit rows were released only after that
explicit rejection was confirmed for each original input; X outcomes were corrected to
`provider_limited`, retaining their charges. Original public refresh rows were backed up locally.
These read/validation checks launched no new scrapers and do not complete the live rollout gate.
