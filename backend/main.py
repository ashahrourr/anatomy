# backend/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.predictor import predict_structure
from backend.auth import get_user_id_from_auth_header
from backend.rate_limit import (
    get_credits,
    consume_credit,
    link_device_and_user,
)

from backend.db import supabase  # ✅ Supabase server client

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://talktoanatomy.com",
        "https://www.talktoanatomy.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PainRequest(BaseModel):
    pain_text: str


def resolve_keys(device_id: str, user_id: str | None):
    device_key = f"device:{device_id}"

    if user_id:
        user_key = f"user:{user_id}"

        # keep device + user credits in sync
        link_device_and_user(device_key, user_key)

        return device_key, user_key, True

    return device_key, None, False


@app.get("/")
def health():
    return {"status": "ok"}


@app.get("/credits")
def credits(request: Request):
    auth = request.headers.get("authorization")
    device_id = request.headers.get("x-device-id")
    user_id = get_user_id_from_auth_header(auth)

    if not device_id:
        return {"credits": None}

    device_key, user_key, signed_in = resolve_keys(device_id, user_id)

    active_key = user_key if signed_in else device_key
    c = get_credits(active_key)

    return {
        "credits": {
            **c,
            "type": "user" if signed_in else "device",
            "locked": (not signed_in and c["used"] >= 1),
        }
    }


@app.post("/predict-structure")
def predict(req: PainRequest, request: Request):
    auth = request.headers.get("authorization")
    device_id = request.headers.get("x-device-id")
    user_id = get_user_id_from_auth_header(auth)

    if not device_id:
        raise Exception("Missing device id")

    device_key, user_key, signed_in = resolve_keys(device_id, user_id)

    # user takes priority if signed in
    active_key = user_key if signed_in else device_key

    credits = consume_credit(
        active_key,
        signed_in,
        mirror_key=(device_key if signed_in else None),
    )

    # ---------- MODEL ----------
    result = predict_structure(req.pain_text)

    # ---------- SAVE QUERY ----------
    supabase.table("pain_queries").insert({
        "user_id": user_id,
        "device_id": None if user_id else device_id,
        "pain_text": req.pain_text,
        "result": result,
    }).execute()

    return {
        **result,
        "credits": {
            **credits,
            "type": "user" if signed_in else "device",
            "locked": (not signed_in and credits["used"] >= 1),
        },
    }
