from urllib.parse import quote

from app.email_cleaning import clean_email_body
from app.outlook.sync import normalize
from app.email_classifier import EmailClassifier, EmailInput

ARABIC = "تحذير: هذه الرسالة مرسلة من خارج جامعة الامام عبد الرحمن بن فيصل. يرجى توخى الحذر عند فتح المرفقات أو النقر فوق الارتباطات أو الاستجابة لطلبات المعلومات"
ENGLISH = 'CAUTION:This message is originated outside of "IAU" domain. Please use caution when opening attachments, clicking links or responding to requests for information.'
SENDER = "You don't often get email from [email] Learn why this is important <https://aka.ms/LearnAboutSenderIdentification>"


def safe_link(target):
    return "https://eur02.safelinks.protection.outlook.com/?url=" + quote(target, safe="") + "&data=private-tracking&sdata=signature&reserved=0"


def test_known_banners_removed_but_real_arabic_and_deadlines_preserved():
    content = "Assignment due Friday.\nموعد الاختبار غدا"
    assert clean_email_body(SENDER + "\n" + ARABIC + "\n" + ENGLISH + "\n" + content) == content
    assert clean_email_body(ENGLISH.replace(" ", "\n") + "\n" + content) == content


def test_safelinks_are_unwrapped_and_markdown_duplicates_collapsed():
    target = "https://www.linkedin.com/company/ccsit-club/"
    link = safe_link(target)
    assert clean_email_body(f"[{link}]({link})") == target
    assert clean_email_body(f"Register <{safe_link('https://university.test/apply?course=1&year=2026')}>") == "Register <https://university.test/apply?course=1&year=2026>"
    assert clean_email_body(f"[Apply here]({link})") == f"[Apply here]({target})"


def test_normalization_happens_before_redaction_and_html_banners_work():
    subject, body = normalize({"subject": "Exam", "body": {"contentType": "html", "content": f"<p>{ARABIC}</p><p>{ENGLISH}</p><p>Exam on Friday.</p>"}})
    assert subject == "Exam"
    assert body == "Exam on Friday."
    assert clean_email_body("Caution: the laboratory is closed.\nPlease use caution when handling chemicals.") == "Caution: the laboratory is closed.\nPlease use caution when handling chemicals."


def test_malformed_and_unsafe_links_are_not_rewritten():
    for link in [safe_link("javascript:alert(1)"), safe_link("https://name:password@example.com"),
                 safe_link("https://example.com/\nInjected"),
                 "https://safelinks.protection.outlook.com.evil.test/?url=https%3A%2F%2Fexample.com",
                 "https://eur02.safelinks.protection.outlook.com/?data=missing"]:
        assert clean_email_body(link) == link


def test_cleaner_is_idempotent_and_empty_banners_never_load_laya(monkeypatch):
    text = SENDER + "\n" + ARABIC + "\n" + ENGLISH
    assert clean_email_body(clean_email_body(text)) == ""
    classifier = EmailClassifier()
    monkeypatch.setattr(classifier, "_load", lambda: (_ for _ in ()).throw(AssertionError("No model needed")))
    assert classifier.classify(EmailInput("", text)).review_reasons == ("empty_input",)


def test_zoom_marketing_links_removed_without_losing_prose_or_meeting_links():
    url = "https://click.e.zoom.us/?qs=ABB7InYiOjEsImQi_LONG_TOKEN"
    escaped = url.replace("_", "\\_")
    body = (f"[{escaped}]({url})\nStop dreading meeting follow-ups.\n"
            f"See what others are saying [{escaped}]({url})\n"
            f"Upgrade today <[{escaped}]({url})\n"
            f"[Read the offer]({url})\n<{url}>\n{url}\n"
            "Join the seminar: https://iau.zoom.us/j/123456?pwd=meeting-code")
    cleaned = clean_email_body(body)
    assert "click.e.zoom.us" not in cleaned and "LONG_TOKEN" not in cleaned
    assert "Stop dreading meeting follow-ups." in cleaned
    assert "See what others are saying" in cleaned
    assert "Upgrade today" in cleaned and "Read the offer" in cleaned
    assert "https://iau.zoom.us/j/123456?pwd=meeting-code" in cleaned
    assert "[]" not in cleaned and "<" not in cleaned
    assert clean_email_body(cleaned) == cleaned
    assert clean_email_body(safe_link(url)) == ""
