"""Create the service's local configuration once; never prints or overwrites secrets."""
import base64
from pathlib import Path
import secrets

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

root = Path(__file__).resolve().parents[1]
target = root / ".env"
db_password = secrets.token_urlsafe(32)
seed = Ed25519PrivateKey.generate().private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
body = f"""COLLAB_ENVIRONMENT=development
COLLAB_DATABASE_URL=postgresql+psycopg://waypoint:{db_password}@127.0.0.1:55432/waypoint_collaboration
COLLAB_DEVICE_SIGNING_KEY={base64.urlsafe_b64encode(seed).rstrip(b"=").decode()}
COLLAB_ALLOWED_ORIGINS=["http://127.0.0.1:5173","http://localhost:5173"]
COLLAB_DEV_DB_PASSWORD={db_password}
"""
try:
    with target.open("x", encoding="utf-8") as output:
        output.write(body)
except FileExistsError:
    raise SystemExit("Service .env already exists; left unchanged. Configure it manually if needed.")
print("Created the service's local .env. No personal configuration was changed.")
