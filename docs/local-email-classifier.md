# Local email classification

This is a reusable local Laya classifier, ready for the Outlook ingestion worker.
The classifier module itself does not connect to Outlook, start Hermes, change
memory, create facts, or run a web server. The app's separate Outlook connector
now uses it; see [Outlook setup](outlook-setup.md).

## One-command setup

Clone the repository, then run from its root:

```bat
setup.bat
```

On macOS/Linux:

```sh
bash setup.sh
```

The scripts install uv if missing, install managed Python 3.12, synchronize the
locked Python dependencies from `pyproject.toml`/`uv.lock`, download the pinned
checkpoint and run a synthetic classification. No API key or manual model download
is required. First setup needs internet and several GB of free disk/RAM (CUDA wheels
are large). Subsequent runs reuse package/model caches. Failures return a nonzero
exit status; rerun after restoring connectivity or freeing resources.

An existing uv must be at least 0.12.0. Installers use Astral's pinned official
installer when uv is absent. Linux needs curl or wget and a platform supported by
uv's managed Python and PyTorch wheels. NVIDIA drivers are system prerequisites;
the scripts do not install or change drivers. They detect CUDA 12.8-compatible
drivers for the pinned CUDA build, otherwise install CPU wheels. On macOS the
native wheel supports MPS on Apple Silicon; Intel Macs use the last supported
PyTorch 2.2.2 CPU wheel. Runtime selection is CUDA, then MPS, then CPU.

All new and existing API Python dependencies are declared in `pyproject.toml`;
pytest is in its development group. Existing `services/api/requirements.txt` and
legacy app launchers remain available for API-only installations. The new scripts
set up the Python API/classifier environment, not Node.js or the separate Hermes
installation. Follow the main README for launching the complete app.

The model is cached in Hugging Face's user cache, outside the checkout by default.
Set `HF_HOME` before setup and inference to use another location. `.venv`, local
caches and safetensors are ignored by Git. The model revision is pinned in
`email_classifier.py`; updates require deliberate review and a setup rerun.

## Use in Python

From the repository root (or use `app.email_classifier` with `services/api` on the
Python path):

```python
from services.api.app.email_classifier import EmailClassifier, EmailInput

classifier = EmailClassifier()  # lazy load; keep one instance per worker
result = classifier.classify(EmailInput(
    subject="Assignment submission",
    body="Please submit your course assignment by Friday at 5 PM.",
    language="en",
))
print(result.category, result.important_probability, result.review_reasons)
```

Optional `warmup()` loads once before accepting jobs. Calls on one instance are
serialized to bound accelerator memory and protect upstream mutable runtime state.
Inference is synchronous: invoke it from a worker, not the FastAPI event loop.
One model copy is loaded per instance/process; do not create one for each email.

```sh
uv run --no-sync python -m services.api.app.email_classifier --smoke-test
uv run --no-sync python -m pytest services/api/tests/test_email_classifier.py
```

Use `--no-sync` after setup to preserve the selected CPU/CUDA wheel. For a manual
dependency refresh use `uv sync --locked --extra cpu` or `--extra cuda`; macOS uses
`--extra cpu` but still chooses MPS at runtime. The extras are mutually exclusive.

## Output and failure policy

Results contain category probabilities, importance/action/time-sensitivity/lasting
relevance probabilities, coverage window count, device and pinned model/policy
provenance. They do not retain the subject or body. No classification is written to
SQLite or Hermes memory. Importance and lasting relevance are independent signals;
neither grants permission to retain an email permanently or create a StudentFact.

Laya's regular `predict` silently truncates long inputs. This module uses
explicit token windows with `predict_batch`, bounded batches and overlapping windows.
The current PyPI release lacks GitHub's newer `predict_long` helper. The complete
cleaned body is covered with 512-token overlapping windows, submitted at most eight
windows per call with inference batch size one. There is no 32,000-character or
64-window cutoff. Very long mail takes longer; no tail is silently discarded.
Empty and unsupported-language inputs also return a review result without loading
the model. Language detection is heuristic; providing a known language is preferred.
Missing cache, runtime failure or malformed model output raises
`ClassifierUnavailable`; callers should retain pending work and surface a retry,
never substitute an unimportant label. Exceptions omit raw provider errors that
could contain email content.

Runtime loads the complete pinned local snapshot only. Hub/Transformers offline
mode is enabled for the classifier process; no email is sent to a service, and no
cloud fallback exists. Setup is the network-enabled phase. Use a dedicated worker
if other components in the same Python process need online Hugging Face access.

## Suitability and validation limits

The [model card](https://huggingface.co/convaiinnovations/laya-typed-decisions)
describes an English-only, 421M-parameter model specialized for four synthetic
workflows. University-email triage is outside that training scope. The model is
Apache-2.0 licensed; its card warns that confidence is uncalibrated and comparisons
with Jev are not a direct shared evaluation. Do not interpret its benchmark as proof
of email accuracy or Arabic support.

Every classified email currently has `needs_review=True` and
`uncalibrated_email_domain`. Multi-window aggregation adds `window_aggregation`;
its probabilities are not calibrated whole-document probabilities. Thresholds for
automatic ranking should only follow evaluation on held-out university email,
especially urgent-message recall and mixed-language coverage. This is production
plumbing for a model experiment, not a validated autonomous email decision system.

No attachment parsing, deadline extraction, factual confirmation, or memory policy
is delegated to this module. Treat email content as untrusted even when a model
classifies it confidently.
# Email text preprocessing

Before language detection, length checks and Laya inference, `email_cleaning.py`
removes the recognized Microsoft infrequent-sender notice and the supplied IAU
external-sender warnings in Arabic and English. Matching is deliberately narrow:
ordinary warnings, deadlines and genuine Arabic message content remain intact.
Safe Links wrappers are decoded locally to valid HTTP(S) destinations; wrapper
tracking parameters are discarded and duplicate URL labels collapsed. No URL is
opened or treated as trusted because it was unwrapped. Useful link labels and
destinations remain available to the classifier.

Opaque `click.e.zoom.us` marketing redirects with a `qs` token are removed without
following them. Descriptive labels, promotional prose and actual meeting URLs are
preserved so Laya can classify the message itself.

The Outlook connector applies the same cleaner before redaction and full-text
storage. Desktop revision fingerprints include a cleaning version, so previously
cached desktop messages are reclassified on the next scan after this update.
Graph messages already cached require a fresh import (disconnect/reconnect) or a
provider update before their original bodies pass through the new cleaner.
These filters reduce classifier noise; they are not phishing detection and do
not remove or change the original Outlook message or its security warnings.
