# backend/rate_limit.py
import os
import requests
from fastapi import HTTPException

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
# REDIS CORE
# -------------------------
def redis_post(cmd: list):
    res = requests.post(
        REDIS_URL,
        headers=HEADERS,
        json=cmd,
        timeout=5,
    )
    if not res.ok:
        raise RuntimeError(f"Redis error: {res.text}")
    return res.json()["result"]

# -------------------------
# FAST CREDIT CONSUMPTION (SINGLE CALL)
# -------------------------
def consume_credit_fast(key: str):
    """
    Atomic credit consumption using ONE Redis call.
    Returns (used, ttl)
    """

    lua = """
    local used = redis.call("GET", KEYS[1])
    if not used then
        redis.call("SET", KEYS[1], 1, "EX", ARGV[1])
        return {1, ARGV[1]}
    end

    used = redis.call("INCR", KEYS[1])
    local ttl = redis.call("TTL", KEYS[1])
    return {used, ttl}
    """

    used, ttl = redis_post([
        "EVAL",
        lua,
        1,
        key,
        WINDOW
    ])

    return int(used), int(ttl)

# -------------------------
# PUBLIC API
# -------------------------
def get_credits(key: str):
    """
    Cheap read-only credits check.
    ONE Redis call.
    """
    lua = """
    local used = redis.call("GET", KEYS[1])
    if not used then
        return {0, 0}
    end
    local ttl = redis.call("TTL", KEYS[1])
    return {tonumber(used), ttl}
    """

    used, ttl = redis_post([
        "EVAL",
        lua,
        1,
        key,
    ])

    return {
        "used": used,
        "remaining": max(TOTAL_DAILY - used, 0),
        "limit": TOTAL_DAILY,
        "reset_in": ttl,
    }

def consume_credit(key: str, signed_in: bool, mirror_key: str | None = None):
    """
    Main entry used by /predict-structure
    """
    used, ttl = consume_credit_fast(key)

    if not signed_in and used > ANON_LIMIT:
        raise HTTPException(status_code=429, detail="Sign in to unlock more")

    if used > TOTAL_DAILY:
        raise HTTPException(status_code=429, detail="Daily limit reached")

    # mirror user/device so UI doesn't reset
    if mirror_key:
        redis_post(["SET", mirror_key, used, "EX", ttl])

    return {
        "used": used,
        "remaining": max(TOTAL_DAILY - used, 0),
        "limit": TOTAL_DAILY,
        "reset_in": ttl,
    }

def link_device_and_user(device_key: str, user_key: str):
    """
    Optional: only call this ON LOGIN, not every request.
    """
    lua = """
    local d = redis.call("GET", KEYS[1]) or 0
    local u = redis.call("GET", KEYS[2]) or 0
    local ttl1 = redis.call("TTL", KEYS[1])
    local ttl2 = redis.call("TTL", KEYS[2])

    local max_used = math.max(tonumber(d), tonumber(u))
    local max_ttl = math.max(ttl1, ttl2)

    if max_used > 0 then
        redis.call("SET", KEYS[1], max_used, "EX", max_ttl)
        redis.call("SET", KEYS[2], max_used, "EX", max_ttl)
    end
    """

    redis_post([
        "EVAL",
        lua,
        2,
        device_key,
        user_key,
    ])
