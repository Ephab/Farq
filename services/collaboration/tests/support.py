"""Shared test building blocks. The service has one way to sign in (device accounts), so every fixture builds on it."""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from collaboration import device_auth
from collaboration.config import Settings

SERVER_KEY = Ed25519PrivateKey.generate()


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


SEED = b64(SERVER_KEY.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))
ISSUER = device_auth.ISSUER


def make_settings(url, **extra) -> Settings:
    base = dict(_env_file=None, environment="production", database_url=url, device_signing_key=SEED, device_pow_bits=8, allowed_origins=[])
    return Settings(**(base | extra))


class Device:
    """What the app does: a key pair, a solved proof of work, a signed challenge."""

    def __init__(self):
        self.key = Ed25519PrivateKey.generate()
        self.public = b64(self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))

    def solve(self, challenge: str, bits: int) -> str:
        counter = 0
        while not device_auth.pow_ok(challenge, self.public, str(counter), bits):
            counter += 1
        return str(counter)

    def sign(self, nonce: str) -> str:
        return b64(self.key.sign(device_auth.TOKEN_PURPOSE + nonce.encode()))


def register(client, device, name="Rashed"):
    challenge = client.get("/v1/auth/pow").json()
    nonce = device.solve(challenge["challenge"], challenge["bits"])
    return client.post("/v1/auth/register", json={"public_key": device.public, "display_name": name, "challenge": challenge["challenge"], "nonce": nonce})


def get_token(client, device):
    nonce = client.post("/v1/auth/challenge", json={"public_key": device.public}).json()["nonce"]
    return client.post("/v1/auth/token", json={"public_key": device.public, "nonce": nonce, "signature": device.sign(nonce)})


def bearer(token):
    return {"Authorization": "Bearer " + token}
