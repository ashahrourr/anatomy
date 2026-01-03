# backend/main.py
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import stripe
import os
from fastapi import Header
from backend.rate_limit import add_credits



from backend.predictor import predict_structure
from backend.auth import get_user_id_from_auth_header
from backend.rate_limit import (
    get_credits,
    consume_credit,
    link_device_and_user,
)

from backend.db import supabase  # ✅ Supabase server client

app = FastAPI()
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")


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
@app.post("/create-checkout-session")
def create_checkout_session(request: Request):
    auth = request.headers.get("authorization")
    device_id = request.headers.get("x-device-id")
    user_id = get_user_id_from_auth_header(auth)

    if not user_id:
        return {"error": "Must be signed in to buy credits"}

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {
                            "name": "AnatomyGPT Credits",
                        },
                        "unit_amount": 500,  # $5.00
                    },
                    "quantity": 1,
                }
            ],
            metadata={
                "user_id": user_id,  # 🔑 THIS IS THE IMPORTANT PART
            },
            success_url="https://talktoanatomy.com",
            cancel_url="https://talktoanatomy.com",
        )

        return {"url": session.url}

    except Exception as e:
        return {"error": str(e)}

@app.post("/webhook/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None),
):
    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=stripe_signature,
            secret=os.getenv("STRIPE_WEBHOOK_SECRET"),
        )
    except Exception as e:
        print("❌ Stripe webhook error:", e)
        return {"error": str(e)}

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id = session["metadata"].get("user_id")

        if not user_id:
            print("❌ Missing user_id in Stripe metadata")
            return {"error": "missing user_id"}

        user_key = f"user:{user_id}"

        # 🎁 grant credits
        add_credits(user_key, amount=10)

        print(f"✅ Granted 10 credits to {user_key}")

    return {"status": "ok"}
