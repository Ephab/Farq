"""Device accounts: the app creates its own shared account silently, with no login page or redirect.

Each Waypoint installation (per local student) generates an Ed25519 key pair the first time Group Projects opens. The
private key never leaves that computer's OS credential vault. The app registers the public key once and the server
returns an account ID. From then on the app proves it holds the key by signing a short-lived server challenge, and
receives a five-minute access token signed by this service. There are no passwords to remember or steal.

Abuse controls (registration is open to the internet): a small proof-of-work per registration, a daily cap on new
accounts, one account per public key, and the front proxy's per-address limit. Challenges and nonces are stateless
(HMAC-signed with a key derived from the service signing key) and nonces are single use. Losing the key loses the
account; there is deliberately no recovery path in this first version.
"""
import base64
import binascii
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta

import jwt
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, String, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from .config import Settings
from .database import Base
from .identity import Identity
from .models import Account, now

ISSUER = "waypoint-device"
AUDIENCE = "waypoint-collaboration"
TOKEN_PURPOSE = b"waypoint-device-token\n"
CHALLENGE_SECONDS = 600
NONCE_SECONDS = 60
router = APIRouter()


class DeviceKey(Base):
    __tablename__ = "device_keys"
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    public_key: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError):
        raise HTTPException(422, "Invalid encoding") from None


def signing_key(settings: Settings) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(unb64(settings.device_signing_key.get_secret_value()))


def mac(settings: Settings, *parts: str) -> str:
    secret = hashlib.sha256(b"waypoint-device-mac|" + unb64(settings.device_signing_key.get_secret_value())).digest()
    return b64(hmac.new(secret, "|".join(parts).encode(), hashlib.sha256).digest()[:16])


def valid_public_key(text: str) -> bytes:
    raw = unb64(text)
    if len(raw) != 32 or b64(raw) != text:
        raise HTTPException(422, "Invalid public key")
    return raw


def leading_zero_bits(digest: bytes) -> int:
    count = 0
    for byte in digest:
        if byte == 0:
            count += 8
            continue
        return count + 8 - byte.bit_length()
    return count


def pow_ok(challenge: str, public_key: str, nonce: str, bits: int) -> bool:
    return leading_zero_bits(hashlib.sha256(f"{challenge}:{public_key}:{nonce}".encode()).digest()) >= bits


class DeviceVerifier:
    """Accepts only access tokens this service signed (EdDSA), with strict claim, purpose and lifetime checks."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.public = signing_key(settings).public_key()

    def verify(self, token: str) -> Identity:
        if len(token) > 4096:
            raise jwt.InvalidTokenError("Token too large")
        if jwt.get_unverified_header(token).get("alg") != "EdDSA":
            raise jwt.InvalidTokenError("Unsupported token header")
        claims = jwt.decode(token, self.public, algorithms=["EdDSA"], issuer=ISSUER, audience=AUDIENCE,
                            options={"require": ["exp", "iat", "iss", "aud", "sub", "typ", "scope"]})
        if claims["typ"] != "Bearer" or claims["scope"] != "collaboration":
            raise jwt.InvalidTokenError("Wrong token purpose")
        if type(claims["iat"]) is not int or type(claims["exp"]) is not int or not 0 < claims["exp"] - claims["iat"] <= self.settings.max_token_seconds:
            raise jwt.InvalidTokenError("Token lifetime exceeds policy")
        name = claims.get("name")
        if not isinstance(name, str) or not claims["sub"] or len(claims["sub"]) > 64:
            raise jwt.InvalidTokenError("Invalid claims")
        return Identity(claims["iss"], claims["sub"], name[:120], claims["exp"])


class RegisterInput(BaseModel):
    public_key: str = Field(min_length=43, max_length=43)
    display_name: str = Field(min_length=1, max_length=120)
    challenge: str = Field(max_length=120)
    nonce: str = Field(min_length=1, max_length=40)


class KeyInput(BaseModel):
    public_key: str = Field(min_length=43, max_length=43)


class TokenInput(KeyInput):
    nonce: str = Field(max_length=120)
    signature: str = Field(max_length=100)


_used_nonces: dict[str, float] = {}


def clean_name(text: str) -> str:
    name = "".join(ch for ch in text if ch.isprintable()).strip()[:120]
    if not name:
        raise HTTPException(422, "Give your account a name")
    return name


@router.get("/v1/auth/pow")
def pow_challenge(request: Request):
    settings = request.app.state.settings
    expires = int(time.time()) + CHALLENGE_SECONDS
    token = f"{b64(secrets.token_bytes(12))}.{expires}"
    return {"challenge": f"{token}.{mac(settings, 'pow', token)}", "bits": settings.device_pow_bits, "expires_at": expires}


@router.post("/v1/auth/register")
def register(body: RegisterInput, request: Request):
    settings = request.app.state.settings
    valid_public_key(body.public_key)
    try:
        random_part, expires, tag = body.challenge.split(".")
        fresh = int(expires) > time.time()
    except ValueError:
        raise HTTPException(422, "Invalid challenge") from None
    if not fresh or not hmac.compare_digest(tag, mac(settings, "pow", f"{random_part}.{expires}")):
        raise HTTPException(422, "Challenge expired; try again")
    if not pow_ok(body.challenge, body.public_key, body.nonce, settings.device_pow_bits):
        raise HTTPException(422, "Proof of work is not valid")
    with request.app.state.sessions() as db:
        existing = db.scalar(select(DeviceKey).where(DeviceKey.public_key == body.public_key))
        if existing is not None:
            return {"account_id": existing.account_id, "created": False}
        recent = db.scalar(select(func.count()).select_from(DeviceKey).where(DeviceKey.created_at > now() - timedelta(days=1)))
        if recent >= settings.device_registrations_per_day:
            raise HTTPException(429, "Too many new accounts today; try again tomorrow")
        account = Account(issuer=ISSUER, subject=body.public_key, display_name=clean_name(body.display_name))
        db.add(account)
        db.flush()
        db.add(DeviceKey(account_id=account.id, public_key=body.public_key))
        try:
            db.commit()
        except IntegrityError:  # two requests with the same key raced: both end up with the one account
            db.rollback()
            existing = db.scalar(select(DeviceKey).where(DeviceKey.public_key == body.public_key))
            if existing is None:
                raise
            return {"account_id": existing.account_id, "created": False}
        return {"account_id": account.id, "created": True}


@router.post("/v1/auth/challenge")
def challenge(body: KeyInput, request: Request):
    settings = request.app.state.settings
    valid_public_key(body.public_key)
    expires = int(time.time()) + NONCE_SECONDS
    token = f"{b64(secrets.token_bytes(16))}.{expires}"
    return {"nonce": f"{token}.{mac(settings, 'nonce', token, body.public_key)}", "expires_at": expires}


@router.post("/v1/auth/token")
def token(body: TokenInput, request: Request):
    settings = request.app.state.settings
    raw = valid_public_key(body.public_key)
    try:
        random_part, expires, tag = body.nonce.split(".")
        fresh = int(expires) > time.time()
    except ValueError:
        raise HTTPException(401, "Invalid challenge") from None
    if not fresh or not hmac.compare_digest(tag, mac(settings, "nonce", f"{random_part}.{expires}", body.public_key)):
        raise HTTPException(401, "Challenge expired; try again")
    try:
        Ed25519PublicKey.from_public_bytes(raw).verify(unb64(body.signature), TOKEN_PURPOSE + body.nonce.encode())
    except (InvalidSignature, ValueError):
        raise HTTPException(401, "Signature does not match this account") from None
    current = time.time()
    for key in [key for key, until in _used_nonces.items() if until <= current]:
        del _used_nonces[key]
    if body.nonce in _used_nonces:
        raise HTTPException(401, "Challenge already used")
    _used_nonces[body.nonce] = current + NONCE_SECONDS + 5
    with request.app.state.sessions() as db:
        row = db.scalar(select(DeviceKey).where(DeviceKey.public_key == body.public_key))
        account = db.get(Account, row.account_id) if row else None
        if account is None:
            raise HTTPException(401, "This device is not registered")
        if account.disabled:
            raise HTTPException(403, "Account disabled")
        issued = int(current)
        expires_at = issued + settings.max_token_seconds
        access = jwt.encode({"iss": ISSUER, "aud": AUDIENCE, "sub": body.public_key, "name": account.display_name,
                             "iat": issued, "exp": expires_at, "typ": "Bearer", "scope": "collaboration"},
                            signing_key(settings), algorithm="EdDSA")
        return {"access_token": access, "expires_at": expires_at, "account": {"id": account.id, "display_name": account.display_name}}
