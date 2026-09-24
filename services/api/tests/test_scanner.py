import importlib.util
import json
from pathlib import Path

import pytest

SCANNER_PATH = Path(__file__).resolve().parents[3] / ".hermes" / "plugins" / "farq" / "scanner.py"
spec = importlib.util.spec_from_file_location("farq_scanner", SCANNER_PATH)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)

SECRET = "SUPER-SECRET-VALUE-123"


@pytest.fixture()
def projects(tmp_path: Path) -> Path:
    app = tmp_path / "Web" / "my-app"
    app.mkdir(parents=True)
    (app / "package.json").write_text(json.dumps({"name": "my-app", "dependencies": {"react": "19", "next": "15"}}))
    (app / "README.md").write_text("# My App\nA study planner built with Next.js.")
    (app / ".env").write_text(f"API_KEY={SECRET}")
    (app / "appsettings.secrets.json").write_text(SECRET)
    (app / "node_modules" / "left-pad").mkdir(parents=True)
    (app / "node_modules" / "left-pad" / "package.json").write_text("{}")
    git = app / ".git"
    (git / "logs").mkdir(parents=True)
    (git / "config").write_text('[remote "origin"]\n\turl = https://user:token@github.com/me/my-app.git\n')
    (git / "logs" / "HEAD").write_text("0000 1111 Me Student <me@example.com> 1700000000 +0300\tcommit (initial): start\n")
    venv_project = tmp_path / "AI" / "bot"
    (venv_project / "myenv" / "Lib" / "site-packages" / "pkg").mkdir(parents=True)
    (venv_project / "myenv" / "pyvenv.cfg").write_text("home = x")
    (venv_project / "myenv" / "Lib" / "site-packages" / "pkg" / "requirements.txt").write_text("should-not-appear")
    (venv_project / "requirements.txt").write_text("fastapi==1.0\nlanggraph\n# comment\n")
    (venv_project / "بوت.py").write_text("print('hi')", encoding="utf-8")
    return tmp_path


def test_scan_projects_skips_secrets_and_dependencies(projects: Path):
    output = scanner.scan_folder(str(projects), "projects")
    assert SECRET not in output and "token@" not in output
    result = json.loads(output)
    by_name = {project["name"]: project for project in result["projects"]}
    assert set(by_name) == {"my-app", "bot"}
    app = by_name["my-app"]
    assert app["git"]["remote"] == "https://github.com/me/my-app.git"
    assert app["git"]["local_commits_by_author"] == {"me@example.com": 1}
    assert app["manifests"][0]["deps"] == ["react", "next"]
    assert "study planner" in app["readme"]
    assert by_name["bot"]["manifests"][0]["deps"] == ["fastapi", "langgraph"]
    assert "should-not-appear" not in output
    assert result["secret_files_skipped"] >= 2


def test_read_file_refuses_secrets_identity_and_binaries(projects: Path):
    app = projects / "Web" / "my-app"
    for name in (".env", "appsettings.secrets.json"):
        assert json.loads(scanner.read_project_file(str(app / name)))["success"] is False
    (app / "passport.pdf").write_bytes(b"%PDF")
    (app / "model.pt").write_bytes(b"\x00\x01")
    assert json.loads(scanner.read_project_file(str(app / "passport.pdf")))["success"] is False
    assert json.loads(scanner.read_project_file(str(app / "model.pt")))["success"] is False
    assert json.loads(scanner.read_project_file(str(app / "README.md")))["success"] is True


def test_scan_coursework_infers_terms_courses_and_materials(tmp_path: Path):
    for rel in ["3d Semester/OOP/Lab/Lab3_Solution.docx", "3d Semester/OOP/Theroy/Lecture 02.pptx",
                "4th Semester/Data Structure/Olds/MidTerm 2019.pdf", "4th Semester/Data Structure/Lecs/CSC 231 Week1.pdf",
                "Important/UOD_TRAN_VW.pdf", "Important/passport.pdf"]:
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")
    result = json.loads(scanner.scan_folder(str(tmp_path), "coursework"))
    courses = {(course["term"], course["course"]): course for course in result["courses"]}
    oop = courses[("3d Semester", "OOP")]
    assert oop["materials"] == {"lab": 1, "lecture": 1}
    ds = courses[("4th Semester", "Data Structure")]
    assert ds["likely_codes"] == ["CSC 231"] and ds["materials"]["exam"] == 1
    assert result["transcript_like_files"] == [str(Path("Important") / "UOD_TRAN_VW.pdf")]
    assert "passport" not in json.dumps(result)


def test_scan_refuses_missing_paths_and_drive_roots(tmp_path: Path):
    assert json.loads(scanner.scan_folder(str(tmp_path / "missing")))["success"] is False
    assert json.loads(scanner.scan_folder(Path(tmp_path.anchor).as_posix()))["success"] is False


def test_index_folder_submits_deterministic_evidence(projects: Path):
    sent = []

    def submit(body):
        sent.append(body)
        return json.dumps({"success": True, "added": len(body["items"])})

    result = json.loads(scanner.index_folder("u1", "s1", str(projects), "projects", submit))
    assert result["success"] is True and result["submitted"] == 2
    items = {item["title"]: item for item in sent[0]["items"]}
    assert items["my-app"]["data"]["url"] == "https://github.com/me/my-app"
    assert items["my-app"]["fingerprint"] == "project:https://github.com/me/my-app"
    assert "next" in items["my-app"]["data"]["frameworks"]
    assert items["bot"]["data"]["languages"] == ["Python"]
    assert SECRET not in json.dumps(sent)
