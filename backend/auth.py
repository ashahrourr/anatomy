# backend/auth.py
from fastapi import HTTPException
from jose import jwt
from jose.exceptions import JWTError
import requests

SUPABASE_PROJECT_ID = "imkyxnjrgzapuybiscdp"
JWKS_URL = f"https://{SUPABASE_PROJECT_ID}.supabase.co/auth/v1/.well-known/jwks.json"

_jwks = requests.get(JWKS_URL).json()

def get_user_id_from_auth_header(auth_header: str | None):
    if not auth_header:
        return None

    token = auth_header.replace("Bearer ", "")

    try:
        header = jwt.get_unverified_header(token)
        key = next(k for k in _jwks["keys"] if k["kid"] == header["kid"])

        payload = jwt.decode(
            token,
            key,
            algorithms=["ES256"],
            audience="authenticated",
            options={"verify_exp": True},
        )
        return payload.get("sub")

    except (StopIteration, JWTError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
