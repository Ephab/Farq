"""Every checked-in Hermes skill must reach the runtime on every launch path."""
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SKILLS = REPO / ".hermes" / "skills"
RUNNERS = ("firas_run_mac", "run_windows")


def skill_names() -> set[str]:
    return {path.name for path in SKILLS.iterdir() if path.is_dir()}


def load_runner(name: str):
    runner_path = REPO / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    return runner


def test_every_skill_has_a_skill_md() -> None:
    missing = [name for name in skill_names() if not (SKILLS / name / "SKILL.md").is_file()]
    assert not missing, f"no SKILL.md in: {', '.join(sorted(missing))}"


def test_docker_mounts_every_skill() -> None:
    compose = (REPO / "docker-compose.yml").read_text(encoding="utf-8")
    missing = [name for name in skill_names()
               if f"./.hermes/skills/{name}:/opt/data/skills/{name}:ro" not in compose]
    assert not missing, f"docker-compose.yml does not mount: {', '.join(sorted(missing))}"


@pytest.mark.parametrize("runner_name", RUNNERS)
def test_runner_syncs_every_skill(runner_name: str, tmp_path: Path, monkeypatch) -> None:
    runner = load_runner(runner_name)

    runtime = tmp_path / "runtime"
    monkeypatch.setattr(runner, "RUNTIME", str(runtime))
    runner.ensure_runtime()

    missing = [name for name in skill_names()
               if not (runtime / "skills" / name / "SKILL.md").is_file()]
    assert not missing, f"{runner_name} did not sync: {', '.join(sorted(missing))}"


@pytest.mark.parametrize("runner_name", RUNNERS)
def test_farq_gateway_keeps_a_repo_local_hermes_home(runner_name: str) -> None:
    """Farq's gateway must load skills in .hermes-runtime, never the daily-use ~/.hermes."""
    runner = load_runner(runner_name)
    env = runner.build_child_env({"HERMES_API_KEY": "k" * 64})

    assert env["HERMES_HOME"] == runner.RUNTIME
    assert Path(env["HERMES_HOME"]).is_relative_to(REPO)
    assert Path.home() / ".hermes" != Path(env["HERMES_HOME"])


def test_prompts_only_reference_provisioned_skills() -> None:
    from app.quiz import QUIZ_INSTRUCTIONS
    from app.slides import EXTEND_INSTRUCTIONS

    provisioned = skill_names()
    for instructions in (EXTEND_INSTRUCTIONS, QUIZ_INSTRUCTIONS):
        referenced = {name for name in provisioned if name in instructions}
        assert referenced, f"prompt references no provisioned skill: {instructions[:200]}"
        for name in referenced:
            assert (SKILLS / name / "SKILL.md").is_file()
