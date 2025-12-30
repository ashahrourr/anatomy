# backend/rate_limit.py
import time
import requests
from fastapi import HTTPException
import os

# -------------------------
# CONFIG
# -------------------------
WINDOW = 60 * 60 * 24  # 24 hours
TOTAL_DAILY = 3
ANON_LIMIT = 1

REDIS_URL = os.getenv("UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN")

if not REDIS_URL or not REDIS_TOKEN:
    raise RuntimeError("❌ Upstash Redis env vars missing")

HEADERS = {
    "Authorization": f"Bearer {REDIS_TOKEN}",
    "Content-Type": "application/json",
}

# -------------------------
# REDIS HELPERS
# -------------------------
def redis_post(cmd: list):
    res = requests.post(
        f"{REDIS_URL}",
        headers=HEADERS,
        json=cmd,
        timeout=5,
    )
    if not res.ok:
        raise RuntimeError(f"Redis error: {res.text}")
    return res.json()["result"]


def get_count_and_ttl(key: str):
    count = redis_post(["GET", key])
    ttl = redis_post(["TTL", key])

    count = int(count) if count is not None else 0
    ttl = max(int(ttl), 0)

    return count, ttl


# -------------------------
# PUBLIC API
# -------------------------
def get_credits(key: str):
    count, ttl = get_count_and_ttl(key)

    return {
        "used": count,
        "remaining": max(TOTAL_DAILY - count, 0),
        "limit": TOTAL_DAILY,
        "reset_in": ttl,
    }


def link_device_and_user(device_key: str, user_key: str):
    """
    Keep device + user counters in sync by copying the higher count.
    """
    d_count, d_ttl = get_count_and_ttl(device_key)
    u_count, u_ttl = get_count_and_ttl(user_key)

    merged_count = max(d_count, u_count)
    merged_ttl = max(d_ttl, u_ttl)

    if merged_count > 0:
        redis_post(["SET", device_key, merged_count, "EX", merged_ttl])
        redis_post(["SET", user_key, merged_count, "EX", merged_ttl])


def consume_credit(key: str, signed_in: bool, mirror_key: str | None = None):
    """
    Atomic rate limit:
    - First request sets key with TTL
    - Subsequent requests increment safely
    """

    # Try to create key if it doesn't exist
    created = redis_post([
        "SET",
        key,
        1,
        "EX",
        WINDOW,
        "NX",
    ])

    if created is None:
        # Key already exists → increment
        count = redis_post(["INCR", key])
    else:
        # Key was just created
        count = 1

    # Enforce limits
    if not signed_in and count > ANON_LIMIT:
        raise HTTPException(status_code=429, detail="Sign in to unlock more")

    if count > TOTAL_DAILY:
        raise HTTPException(status_code=429, detail="Daily limit reached")

    # Mirror usage so sign-out doesn't reset UI
    if mirror_key:
        ttl = redis_post(["TTL", key])
        redis_post(["SET", mirror_key, count, "EX", ttl])

    ttl = redis_post(["TTL", key])

    return {
        "used": count,
        "remaining": max(TOTAL_DAILY - count, 0),
        "limit": TOTAL_DAILY,
        "reset_in": int(ttl),
    }

