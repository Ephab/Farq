"""Setup uses synthetic credentials and mocked installers; never touches the user's .env."""
import base64
import importlib.util
import os
from pathlib import Path

import pytest

from scripts.local_env import configure_env, read_env
from scripts.runtime import child_env

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
def setup_root(tmp_path):
    (tmp_path / ".env.example").write_text((REPO / ".env.example").read_text(encoding="utf-8"), encoding="utf-8")
    return tmp_path


def test_setup_generates_stable_secrets_and_no_mail_access_token(setup_root):
    values = configure_env(setup_root, supported=True)
    assert len(values["HERMES_API_KEY"]) >= 32
    assert len(values["FARQ_INTERNAL_TOKEN"]) >= 32
    assert len(values["OUTLOOK_LOCAL_TOKEN"]) >= 32
    assert len(base64.urlsafe_b64decode(values["FARQ_TOKEN_ENCRYPTION_KEY"])) == 32
    assert values["GEMINI_API_KEY"] == ""
    assert "access_token" not in values
    assert values["HERMES_EMAIL_URL"].endswith(":8642")
    before = (setup_root / ".env").read_bytes()
    assert configure_env(setup_root, supported=True) == values
    assert (setup_root / ".env").read_bytes() == before


def test_unsupported_device_gets_no_desktop_token(setup_root):
    values = configure_env(setup_root, supported=False)
    assert not values.get("OUTLOOK_LOCAL_TOKEN")
    assert values["FARQ_TOKEN_ENCRYPTION_KEY"]
    assert configure_env(setup_root, supported=True)["OUTLOOK_LOCAL_TOKEN"]


def test_upgrade_preserves_keys_comments_and_removes_retired_config(setup_root):
    key = base64.urlsafe_b64encode(b"e" * 32).decode()
    (setup_root / ".env").write_text(f"# Keep this comment\nGEMINI_API_KEY=existing-provider-key\nHERMES_API_KEY=existing-gateway-key\nFARQ_INTERNAL_TOKEN=existing-internal-key\nFARQ_TOKEN_ENCRYPTION_KEY={key}\nOUTLOOK_LOCAL_TOKEN=existing-local-token\nMICROSOFT_CLIENT_SECRET=retired\nOUTLOOK_CLIENT_ID=retired\nHERMES_EMAIL_URL=http://127.0.0.1:8642\n", encoding="utf-8")
    values = configure_env(setup_root, supported=True)
    assert values["GEMINI_API_KEY"] == "existing-provider-key"
    assert values["HERMES_API_KEY"] == "existing-gateway-key"
    assert values["FARQ_TOKEN_ENCRYPTION_KEY"] == key
    assert values["OUTLOOK_LOCAL_TOKEN"] == "existing-local-token"
    assert "MICROSOFT_CLIENT_SECRET" not in values and "OUTLOOK_CLIENT_ID" not in values
    assert "# Keep this comment" in (setup_root / ".env").read_text(encoding="utf-8")
    assert values["HERMES_EMAIL_URL"] == values["HERMES_URL"]


def test_invalid_encryption_key_is_not_silently_replaced(setup_root):
    (setup_root / ".env").write_text("FARQ_TOKEN_ENCRYPTION_KEY=broken\n", encoding="utf-8")
    before = (setup_root / ".env").read_bytes()
    with pytest.raises(RuntimeError, match="invalid"):
        configure_env(setup_root, supported=True)
    assert (setup_root / ".env").read_bytes() == before


def test_child_processes_do_not_receive_mailbox_secrets():
    values = {"OUTLOOK_LOCAL_TOKEN": "private", "FARQ_TOKEN_ENCRYPTION_KEY": "private",
              "GEMINI_API_KEY": "provider", "FARQ_INTERNAL_TOKEN": "internal", "HERMES_API_KEY": "gateway"}
    for name in ("hermes", "web"):
        env = child_env(name, values)
        assert "OUTLOOK_LOCAL_TOKEN" not in env and "FARQ_TOKEN_ENCRYPTION_KEY" not in env
        if name == "web":
            assert "GEMINI_API_KEY" not in env and "HERMES_API_KEY" not in env
    assert child_env("api", values)["OUTLOOK_LOCAL_TOKEN"] == "private"


def load_setup(monkeypatch):
    monkeypatch.syspath_prepend(str(REPO / "scripts"))
    spec = importlib.util.spec_from_file_location("farq_setup_test", REPO / "scripts/setup_local.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_installed_hermes_is_verified_without_reinstallation(monkeypatch):
    module = load_setup(monkeypatch)
    calls = []
    monkeypatch.setattr(module, "executable", lambda name: "hermes-existing")
    monkeypatch.setenv("VIRTUAL_ENV", "farq-venv")
    monkeypatch.setattr(module.subprocess, "run", lambda command, **kwargs: calls.append((command, kwargs)))
    assert module.ensure_hermes() == "hermes-existing"
    assert calls[0][0] == ["hermes-existing", "--version"]
    assert "VIRTUAL_ENV" not in calls[0][1]["env"]
    assert len(calls) == 1


def test_setup_checks_hermes_and_laya_before_reporting_success(monkeypatch, setup_root):
    module = load_setup(monkeypatch)
    calls = []
    monkeypatch.setattr(module, "ROOT", setup_root)
    monkeypatch.setattr(module.sys, "argv", ["setup_local.py"])
    monkeypatch.setattr(module.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(module.shutil, "which", lambda _: "npm")
    monkeypatch.setattr(module, "ensure_hermes", lambda: calls.append("hermes"))
    monkeypatch.setattr(module, "provision", lambda _: calls.append("runtime"))
    monkeypatch.setattr(module.subprocess, "run", lambda command, **kwargs: calls.append(command))
    module.main()
    assert calls[0] == "hermes"
    assert calls[1] == ["uv", "sync", "--locked", "--extra", "cpu"]
    assert any(isinstance(command, list) and "--smoke-test" in command and "--download" in command for command in calls)
    assert ["npm", "ci"] in calls
    assert calls[-1] == "runtime"
    assert read_env(setup_root / ".env")["HERMES_API_KEY"]
