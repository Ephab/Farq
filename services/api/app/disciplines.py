from __future__ import annotations

"""Discipline registry: how onboarding adapts to a student's field.

Each entry tells the UI which evidence sources to offer (and which are only
"coming soon"), gives Hermes question hints for the gap-filling chat, and
gives the roadmap generator a stage-shape hint. Implemented source kinds are
the same for everyone; the registry only changes ordering and emphasis.
"""

import re

# Source kinds implemented by app.sources (ordered by general usefulness).
ALL_SOURCES = ["transcript_pdf", "cv_pdf", "linkedin_zip", "linkedin_pdf", "github", "folder", "portfolio_url", "orcid"]

DISCIPLINES: dict[str, dict] = {
    "cs": {
        "label": "Computer science / AI / software",
        "keywords": ["computer", "software", "artificial intelligence", "ai", "data science", "informatics", "cyber", "information technology", "computing"],
        "sources": ["transcript_pdf", "cv_pdf", "linkedin_zip", "github", "folder", "portfolio_url", "linkedin_pdf", "orcid"],
        "coming_soon": ["Kaggle profile", "LeetCode / Codeforces stats", "Hackathon pages (Devpost)"],
        "question_hints": ["industry vs research vs startup direction", "preferred specialization (e.g. ML, systems, web, security)", "internship or job timeline"],
        "stage_hint": "foundations gaps -> specialization core -> advanced topics -> portfolio projects -> career readiness (interviews, internships)",
    },
    "engineering": {
        "label": "Engineering (mechanical, electrical, civil, …)",
        "keywords": ["engineering", "mechanical", "electrical", "civil", "chemical", "industrial", "aerospace", "mechatronics", "biomedical"],
        "sources": ["transcript_pdf", "cv_pdf", "linkedin_zip", "folder", "portfolio_url", "orcid", "github", "linkedin_pdf"],
        "coming_soon": ["GrabCAD / Thingiverse profile", "FE / professional exam results", "Competition team pages (FSAE, robotics)"],
        "question_hints": ["target sub-field", "design vs analysis vs field work", "licensure (FE/PE) plans", "co-op timeline"],
        "stage_hint": "math & science gaps -> discipline core -> tools (CAD/simulation/lab) -> design projects -> licensure & co-op",
    },
    "medicine": {
        "label": "Medicine / health sciences",
        "keywords": ["medicine", "medical", "mbbs", "md", "nursing", "pharmacy", "dentistry", "health", "physiotherapy"],
        "sources": ["transcript_pdf", "cv_pdf", "orcid", "linkedin_zip", "folder", "linkedin_pdf", "portfolio_url", "github"],
        "coming_soon": ["Clinical e-logbook / rotation export", "Anki deck statistics", "Question-bank performance CSV", "Licensing exam score reports"],
        "question_hints": ["preclinical vs clinical year", "target specialty", "licensing exam dates", "research interest"],
        "stage_hint": "preclinical sciences -> systems review -> clinical rotations & skills -> licensing exam prep -> research & residency application",
    },
    "law": {
        "label": "Law",
        "keywords": ["law", "legal", "llb", "jd", "juris"],
        "sources": ["transcript_pdf", "cv_pdf", "linkedin_zip", "folder", "portfolio_url", "orcid", "linkedin_pdf", "github"],
        "coming_soon": ["SSRN author page", "Moot court / law review records", "Clinic hours log"],
        "question_hints": ["practice area of interest", "litigation vs transactional", "bar exam jurisdiction and date", "clerkship interest"],
        "stage_hint": "doctrinal foundations -> legal writing & research -> advocacy (moot, clinics) -> specialization electives -> bar preparation & clerkships",
    },
    "business": {
        "label": "Business / economics / finance",
        "keywords": ["business", "finance", "accounting", "economics", "management", "marketing", "mba", "commerce"],
        "sources": ["transcript_pdf", "cv_pdf", "linkedin_zip", "linkedin_pdf", "folder", "portfolio_url", "github", "orcid"],
        "coming_soon": ["Credly / certification badges", "Case competition pages"],
        "question_hints": ["target role (analyst, consulting, founder…)", "certifications (CFA, CPA…)", "internship recruiting season"],
        "stage_hint": "quantitative & core business -> concentration -> tools (Excel, SQL, modelling) -> case/internship experience -> certification & recruiting",
    },
    "sciences": {
        "label": "Natural sciences / mathematics",
        "keywords": ["physics", "chemistry", "biology", "mathematics", "math", "statistics", "science", "geology"],
        "sources": ["transcript_pdf", "cv_pdf", "orcid", "linkedin_zip", "folder", "github", "portfolio_url", "linkedin_pdf"],
        "coming_soon": ["Google Scholar profile", "Lab notebook export"],
        "question_hints": ["research vs industry", "lab vs computational work", "graduate school plans"],
        "stage_hint": "core theory gaps -> methods (lab/computational) -> research skills -> independent project -> graduate school or industry preparation",
    },
    "design": {
        "label": "Design / architecture / arts",
        "keywords": ["design", "architecture", "art", "graphic", "media", "fashion", "interior"],
        "sources": ["portfolio_url", "cv_pdf", "transcript_pdf", "linkedin_zip", "folder", "linkedin_pdf", "github", "orcid"],
        "coming_soon": ["Behance / Dribbble profile", "Portfolio PDF review"],
        "question_hints": ["medium or specialty", "studio vs agency vs freelance", "portfolio review date"],
        "stage_hint": "fundamentals -> tools & techniques -> studio projects -> portfolio -> professional practice",
    },
    "other": {
        "label": "Other",
        "keywords": [],
        "sources": ALL_SOURCES,
        "coming_soon": [],
        "question_hints": ["career direction", "strongest and weakest subjects"],
        "stage_hint": "foundations -> core -> applied projects -> career readiness",
    },
}


def classify_program(program: str) -> str:
    text = program.lower()
    best, score = "other", 0
    for key, entry in DISCIPLINES.items():
        hits = sum(1 for word in entry["keywords"] if re.search(rf"\b{re.escape(word)}\b", text))
        if hits > score:
            best, score = key, hits
    return best


def public_registry() -> list[dict]:
    return [
        {"id": key, "label": entry["label"], "sources": entry["sources"], "coming_soon": entry["coming_soon"]}
        for key, entry in DISCIPLINES.items()
    ]
