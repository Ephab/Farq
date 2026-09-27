from pathlib import Path
from typing import get_args

REPO = Path(__file__).resolve().parents[3]
SKILL = REPO / ".hermes" / "skills" / "waypoint-quiz" / "SKILL.md"


def test_quiz_instructions_load_the_skill() -> None:
    from app.quiz import QUIZ_INSTRUCTIONS

    assert "waypoint-quiz" in QUIZ_INSTRUCTIONS


def test_quiz_skill_covers_every_type_and_difficulty() -> None:
    from app.schemas import QuizDifficulty, QuizQuestionType

    text = SKILL.read_text(encoding="utf-8")
    for value in get_args(QuizQuestionType) + get_args(QuizDifficulty):
        assert value in text, f"waypoint-quiz skill never mentions {value}"
    assert "explanation" in text
