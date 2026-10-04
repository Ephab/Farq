import base64
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class DatabaseSettings(BaseSettings):
    """Just the database, so migrations can run without the signing key."""

    model_config = SettingsConfigDict(env_prefix="COLLAB_", env_file=".env", extra="ignore")

    database_url: str = Field(repr=False)

    @model_validator(mode="after")
    def validate_database(self):
        # A PostgreSQL-only runtime cannot accidentally open the personal SQLite file.
        if make_url(self.database_url).drivername != "postgresql+psycopg":
            raise ValueError("Collaboration requires a separate postgresql+psycopg database")
        return self


class Settings(DatabaseSettings):
    environment: Literal["development", "production"] = "production"
    # Base64url Ed25519 private key (32 bytes). Signs device-account access tokens and the stateless challenges.
    device_signing_key: SecretStr = Field(repr=False)
    device_registrations_per_day: int = Field(default=300, ge=1, le=100000)
    device_pow_bits: int = Field(default=18, ge=8, le=26)
    allowed_origins: list[str] = Field(default_factory=list)
    max_token_seconds: int = Field(default=300, ge=30, le=300)
    teams_enabled: bool = False
    # Clients older than this get 426 on /v1 routes; "0.0.0" accepts any (and a missing header).
    min_client_version: str = Field(default="0.0.0", pattern=r"^\d{1,4}\.\d{1,4}\.\d{1,4}$")
    # Team Hermes: a separate gateway with only the central team toolset. Off unless configured.
    team_ai_enabled: bool = False
    hermes_url: str = "http://127.0.0.1:8643"
    hermes_api_key: SecretStr | None = Field(default=None, repr=False)
    # Shared secret the gateway's team plugin presents on /internal/hermes/*; every run also needs its own grant.
    hermes_tool_token: SecretStr | None = Field(default=None, repr=False)
    hermes_provider: str | None = "openrouter"
    hermes_model: str | None = "stealth/space-bunny-alpha"
    # Provider of the fallback models below (they are Gemini ids).
    hermes_fallback_provider: str = "gemini"
    # Tried in order when the chosen model is busy or rate-limited (tool-calling models only).
    hermes_fallback_models: list[str] = Field(default_factory=lambda: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"])
    run_timeout_seconds: int = Field(default=180, ge=10, le=900)
    run_lease_seconds: int = Field(default=300, ge=30, le=1800)
    run_max_attempts: int = Field(default=2, ge=1, le=3)
    user_runs_per_hour: int = Field(default=10, ge=1, le=100)
    team_runs_per_day: int = Field(default=60, ge=1, le=1000)
    team_backlog: int = Field(default=3, ge=1, le=20)
    proposals_per_run: int = Field(default=5, ge=1, le=20)

    @model_validator(mode="after")
    def validate_boundaries(self):
        try:
            key = base64.urlsafe_b64decode(self.device_signing_key.get_secret_value() + "====")
        except ValueError:
            key = b""
        if len(key) != 32:
            raise ValueError("COLLAB_DEVICE_SIGNING_KEY must be a base64url Ed25519 private key (32 bytes)")
        for origin in self.allowed_origins:
            url = urlsplit(origin)
            local_http = (self.environment == "development" and url.scheme == "http"
                          and url.hostname in {"127.0.0.1", "localhost", "::1"})
            if not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("Origins must be explicit, without credentials or query strings")
            if url.scheme != "https" and not local_http:
                raise ValueError("HTTPS is required except for development loopback origins")
            if url.path not in {"", "/"} or origin.endswith("/"):
                raise ValueError("CORS origins must have no path or trailing slash")
        if self.team_ai_enabled:
            if not self.teams_enabled:
                raise ValueError("Team Hermes requires teams to be enabled")
            if self.hermes_api_key is None or len(self.hermes_api_key.get_secret_value()) < 16:
                raise ValueError("Team Hermes requires COLLAB_HERMES_API_KEY (16+ characters)")
            if self.hermes_tool_token is None or len(self.hermes_tool_token.get_secret_value()) < 32:
                raise ValueError("Team Hermes requires COLLAB_HERMES_TOOL_TOKEN (32+ characters)")
            gateway = urlsplit(self.hermes_url)
            local = gateway.hostname in {"127.0.0.1", "localhost", "::1"}
            if (not gateway.hostname or gateway.username or gateway.password or gateway.query or gateway.fragment
                    or (gateway.scheme != "https" and not (gateway.scheme == "http" and local))):
                raise ValueError("The Hermes gateway must be HTTPS or on loopback")
        return self
