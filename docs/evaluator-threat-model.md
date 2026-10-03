# Native project evaluator threat model

Native run scripts start the evaluator. Native execution is authorized by the local machine owner for local directories explicitly submitted in the UI. It runs with that user's privileges, not in an OS sandbox: project code can access host files and network despite temporary snapshots, credential stripping, timeouts and process cleanup. Only trusted local projects should be submitted. ZIP/GitHub submissions cannot execute natively; their evaluation fails with an explanatory message.

## Agent boundary

FastAPI makes JSON-only model calls with the server-selected provider/model. Source, README, tool output, HTTP responses and DOM text are untrusted data. No Hermes tool grant is issued and no generic Hermes terminal, file, web or browser tools are enabled. The evaluator implements a separate finite action vocabulary: existing npm scripts, Node CLI entries, fixed harness probes, dependency installation, Python tests, local HTTP checks, and local browser interactions. Model output is validated as structured arguments; it never becomes a shell command. Windows npm.cmd is invoked through cmd with individually quoted arguments and shell metacharacters rejected. No caller-supplied student id, model or key is accepted.

Every reasoning/report call requires internal authentication and a matching running evaluation lease. Final scores are computed server-side from the accepted rubric and model criterion scores. Every criterion cites actual observation IDs. Runtime observations and limitations are displayed, including skipped checks. Model failure is an evaluation failure, never a fabricated review. Evaluation completion remains the FastAPI endpoint's responsibility.

## Native execution

Only local_directory jobs may run. Sources are copied to temporary directories; secret filenames and symlinks/junctions are excluded. Submitted originals are not modified. Child environments contain only platform runtime variables and fresh temporary HOME/cache directories; API/model/mail tokens never reach project code. TEST_DOCKER is never passed. Fixed project scripts containing Docker invocations are rejected, and the evaluator never starts Docker itself. Submitted code could still invoke external programs; native execution is a trust decision, not confinement.

Checks have per-process and overall deadlines, output caps, and process-tree cleanup. Dependency installation occurs only in the snapshot or a private Python venv; npm lifecycle scripts are disabled at installation. Test/build scripts themselves execute trusted project code.

Browser automation uses a fresh Playwright context, never the student's browser/session. It can visit only the worker-launched 127.0.0.1 origin on a worker-selected ephemeral port. Other requests, redirects, downloads and service workers are blocked. HTTP checks have the same origin restriction and reject redirects; no API :8000, gateway :8642 or unrelated local services are accessible through these evaluator actions. HTTP methods are restricted to GET/POST/PUT/PATCH/DELETE with bounded JSON bodies. Local app state changes are limited to the temporary project. Submitted app code can still access other host resources.

Generated screenshots are returned in bounded PNG form through the authenticated internal completion endpoint, kept with the evaluation report and exposed only through owner-checked evaluation routes. Original uploaded files/source are never retained. Screenshots may contain project test data: use synthetic data, never sign into personal accounts. HTML/DOM/log content is redacted before model review and storage. Screenshots are evidence for student inspection; model review uses observed DOM and test results and does not claim visual image understanding.

## Remaining limits

This is a local developer feature, not suitable for untrusted multi-user submissions. Native code is not isolated. Threats include malicious project scripts, dependency supply-chain attacks, localhost probing by app code, memory/CPU exhaustion, screenshot disclosure of test data and prompt injection in source/results. Structured action validation limits model authority but cannot contain malicious native project code. Remote submissions need a real sandbox before execution. Live model/API benchmarks need separately scoped provider credentials and cost authorization; none are forwarded to submitted projects.
