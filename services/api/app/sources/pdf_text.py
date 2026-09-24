from __future__ import annotations

import io
import re

from . import SourceError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 30_000

# Identity numbers never need to reach a model: long digit runs (national IDs,
# student IDs, passports), emails and phone numbers are masked first.
REDACTIONS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    # International phone numbers; plain 7+ digit runs cover local phones and IDs.
    # Deliberately narrow so credit/grade columns like "3 3 15.00" survive.
    (re.compile(r"\+\d[\d\s-]{7,}\d"), "[number]"),
    (re.compile(r"\b\d{7,}\b"), "[id]"),
    (re.compile(r"\b[A-Z]{1,2}\d{6,9}\b"), "[id]"),
]


def redact(text: str) -> str:
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def extract_pdf_text(data: bytes) -> str:
    if len(data) > MAX_UPLOAD_BYTES:
        raise SourceError("File is larger than 10 MB", status=413)
    if not data.startswith(b"%PDF"):
        raise SourceError("That file is not a PDF")
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages[:40]]
    except Exception as exc:  # pypdf raises many types for damaged files
        raise SourceError(f"Could not read the PDF: {exc}") from exc
    text = "\n".join(pages).strip()
    if len(text) < 80:
        raise SourceError("This PDF looks scanned (no selectable text). OCR is not supported yet; upload a text-based export.")
    return redact(text)[:MAX_TEXT_CHARS]
