"""Deterministic classifier preprocessing; never follows or fetches links."""
import re
from urllib.parse import parse_qs, urlsplit

CLEANING_VERSION = "mail-clean-v2-full-text"

_SENDER_NOTICE = re.compile(
    r"You\s+don['’]t\s+often\s+get\s+email\s+from\s+.{1,320}?\s+"
    r"Learn\s+why\s+this\s+is\s+important"
    r"(?:\s*<?https://aka\.ms/LearnAboutSenderIdentification/?>?)?",
    re.IGNORECASE | re.DOTALL,
)
_EN_WARNING = re.compile(
    r'CAUTION\s*:\s*This\s+message\s+is\s+originated\s+outside\s+of\s+["“]?IAU["”]?\s+domain\.'
    r'\s*Please\s+use\s+caution\s+when\s+opening\s+attachments,\s*clicking\s+links\s+or\s+'
    r'responding\s+to\s+requests\s+for\s+information\.', re.IGNORECASE,
)
_AR_WARNING = re.compile(
    r"تحذير\s*:\s*هذه\s+الرسالة\s+مرسلة\s+من\s+خارج\s+جامعة\s+[اإ]لامام\s+عبد\s+الرحمن\s+بن\s+فيصل\."
    r"\s*يرجى\s+توخ[ىّي]\s+الحذر\s+عند\s+فتح\s+المرفقات\s+أو\s+النقر\s+فوق\s+الارتباطات\s+أو\s+"
    r"الاستجابة\s+لطلبات\s+المعلومات[.。]?"
)
_URL = re.compile(r'https?://[^\s<>\[\]()"\u200e\u200f]+', re.IGNORECASE)


def _unwrap(match):
    original = match.group(0)
    candidate = original.replace("\\&", "&").replace("\\_", "_")
    # Bounded nested wrappers, with exact hostname-suffix validation.
    for _ in range(3):
        try:
            parsed = urlsplit(candidate)
            host = (parsed.hostname or "").lower()
            if host != "safelinks.protection.outlook.com" and not host.endswith(".safelinks.protection.outlook.com"):
                break
            target = parse_qs(parsed.query).get("url", [""])[0]
            destination = urlsplit(target)
            if destination.scheme not in {"http", "https"} or not destination.hostname or destination.username:
                return original
            if any(char.isspace() or ord(char) < 32 or char in '<>"' for char in target):
                return original
            candidate = target
        except ValueError:
            return original
    return candidate


def clean_email_body(body: str) -> str:
    """Remove only recognized banners; preserve prose, deadlines and link labels."""
    text = body.replace("\r\n", "\n").replace("\r", "\n")
    for banner in (_SENDER_NOTICE, _EN_WARNING, _AR_WARNING):
        text = banner.sub("", text)
    text = _URL.sub(_unwrap, text)
    # These opaque marketing redirects do not contain a recoverable destination.
    # Do not fetch them; keep descriptive labels but remove URL-as-label noise.
    def tracked(url):
        try:
            parsed = urlsplit(url)
            return parsed.hostname == "click.e.zoom.us" and bool(parse_qs(parsed.query).get("qs"))
        except ValueError:
            return False

    def markdown_link(match):
        label, target = match.group(1), match.group(2)
        if not tracked(target):
            return match.group(0)
        return "" if label.lower().startswith(("https://", "http://")) else label

    text = re.sub(r'<?\[([^\]\n]*)\]\((https?://[^\s<>\[\]()]*)\)>?', markdown_link, text)
    text = re.sub(r'<(https?://[^\s<>]+)>', lambda m: "" if tracked(m.group(1)) else m.group(0), text)
    text = _URL.sub(lambda m: "" if tracked(m.group(0)) else m.group(0), text)
    # Outlook exports sometimes use the full URL as both Markdown label and target.
    text = re.sub(r"\[(https?://[^\s\[\]]+)\]\(\1\)", r"\1", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
