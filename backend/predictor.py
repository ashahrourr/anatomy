# backend/predictor.py
import json
import os
import time
import numpy as np
from dotenv import load_dotenv
from openai import OpenAI
from upstash_redis import Redis
from difflib import SequenceMatcher
import requests



# --------------------------------------------------------------------
# CONFIG
# --------------------------------------------------------------------
CACHE_TRUST_THRESHOLD = 0.75

load_dotenv()
redis = Redis(
    url=os.getenv("UPSTASH_REDIS_REST_URL"),
    token=os.getenv("UPSTASH_REDIS_REST_TOKEN"),
)

api_key = os.getenv("OPENAI_API_KEY")
if api_key is None:
    raise ValueError("❌ OPENAI_API_KEY missing in backend/.env")

client = OpenAI(api_key=api_key)

# --------------------------------------------------------------------
# LOAD STRUCTURES + PRECOMPUTED EMBEDDINGS
# --------------------------------------------------------------------
# BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# STRUCTURES_PATH = os.path.join(BASE_DIR, "structures.json")

# with open(STRUCTURES_PATH, "r") as f:
#     STRUCTURES = json.load(f)
STRUCTURES_URL = os.getenv("STRUCTURES_URL")
STRUCTURES_PATH = "/tmp/structures.json"

if not os.path.exists(STRUCTURES_PATH):
    with requests.get(STRUCTURES_URL, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(STRUCTURES_PATH, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)


with open(STRUCTURES_PATH, "r") as f:
    STRUCTURES = json.load(f)


STRUCTURE_BY_ID = {s["id"]: s for s in STRUCTURES}

# --------------------------------------------------------------------
# PREP STRUCTURE EMBEDDINGS INTO NUMPY MATRIX
# --------------------------------------------------------------------
# all_embs = np.array([s["embedding"] for s in STRUCTURES], dtype=float)
# norms = np.linalg.norm(all_embs, axis=1, keepdims=True)
# structure_matrix = all_embs / norms
# 1) build compact float32 matrix
all_embs = np.asarray([s["embedding"] for s in STRUCTURES], dtype=np.float32)

# 2) normalize in-place (keeps memory down)
norms = np.linalg.norm(all_embs, axis=1, keepdims=True).astype(np.float32)
all_embs /= norms
structure_matrix = all_embs  # normalized cosine-ready

# 3) IMPORTANT: drop python embedding lists (saves huge RAM)
for s in STRUCTURES:
    s.pop("embedding", None)

# optional: if you want the file to free faster in CPython
del norms

# --------------------------------------------------------------------
# LEXICAL MATCHING HELPERS (TOKEN + FUZZY)
# --------------------------------------------------------------------
def tokenize(s: str) -> set[str]:
    return set(s.lower().split())

def token_overlap(a: str, b: str) -> float:
    ta, tb = tokenize(a), tokenize(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))

def fuzzy_score(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()  # 0–1


def ms(t0: float) -> float:
    return (time.time() - t0) * 1000

def log_step(name: str, t0: float):
    print(f"⏱ {name}: {ms(t0):.2f} ms")


t_total = time.time()

# --------------------------------------------------------------------
# REDIS CACHE HELPERS
# --------------------------------------------------------------------
def struct_key(raw_text: str) -> str:
    return f"struct:{raw_text}"

def redis_get(raw_text: str):
    try:
        val = redis.get(struct_key(raw_text))
        if val is None:
            return None
        if isinstance(val, str):
            return json.loads(val)
        return val
    except Exception:
        return None

def redis_set(raw_text: str, mapped_id: str, similarity: float):
    payload = json.dumps({"mapped_id": mapped_id, "similarity": similarity})
    try:
        redis.set(struct_key(raw_text), payload, ex=60 * 60 * 24 * 365)
    except Exception as e:
        print("❌ redis.set failed:", repr(e))


def redis_mget(raw_texts: list[str]) -> dict[str, dict]:
    if not raw_texts:
        return {}

    keys = [struct_key(t) for t in raw_texts]

    try:
        # ✅ Upstash expects *args, not a list
        t_http = time.time()
        values = redis.mget(*keys)
        print(f"⏱ REDIS HTTP CALL: {(time.time() - t_http)*1000:.2f} ms")

    except Exception as e:
        print("❌ redis.mget failed:", repr(e))
        return {}

    out: dict[str, dict] = {}
    for raw, val in zip(raw_texts, values):
        if val is None:
            continue

        # Upstash usually returns strings; handle bytes just in case
        if isinstance(val, (bytes, bytearray)):
            val = val.decode("utf-8")

        if isinstance(val, str):
            try:
                out[raw] = json.loads(val)
            except Exception:
                continue
        elif isinstance(val, dict):
            out[raw] = val

    return out




# --------------------------------------------------------------------
# LATERALITY (MATCHES YOUR GLB IDS: name + l / r)
# --------------------------------------------------------------------
def apply_side_label(name: str, side: str | None):
    if not name:
        return None
    if side == "left":
        return f"{name} left"
    if side == "right":
        return f"{name} right"
    return name


# --------------------------------------------------------------------
# GPT → ANATOMICAL REASONING
# --------------------------------------------------------------------
def gpt_reason(pain_text: str):
    system_prompt = """
    You are an anatomical reasoning engine.

    GOAL
    Identify the single MOST LIKELY anatomical pain generator.
    Optionally list up to 5 supporting anatomical structures.

    STRUCTURE RULES (CRITICAL)
    - Output ONLY LEAF anatomical structures.
    - Parent or grouped anatomy terms are FORBIDDEN (e.g. rotator cuff, jaw muscles, hip flexors).
    - If pain maps to a group, choose ONE specific child as "primary" and list other plausible children as "supporting".
    - NEVER output a parent or group name.

    ANATOMY SCOPE
    - Allowed: muscles, tendons, ligaments, joints, bones, nerves.
    - Nerves must be specific named anatomical nerves (no dermatomes or vague nerve regions).
    - FORBIDDEN: arteries, veins, lymphatic structures, non-anatomical concepts.

    LATERALITY
    - If the user specifies left or right → use it.
    - If the structure is anatomically paired and side is unclear → default to LEFT.
    - If the structure is anatomically midline → side = null.
    - Output exactly ONE of: left | right | null.

    UNCERTAINTY HANDLING
    - If the description is vague but anatomical, choose the most plausible LEAF structure as "primary".
    - Use "supporting" to express alternative plausible pain generators.
    - Return null ONLY if no anatomical inference is possible.

    OTHER RULES
    - Do NOT include side suffixes in structure names.
    - Do NOT invent anatomy.
    - Be concise.

    OUTPUT
    Return STRICT JSON only:

    {
    "primary": "<leaf anatomical name or null>",
    "side": "left | right | null",
    "supporting": ["<leaf anatomical name>"]
    }
    """




    res = client.responses.create(
        model="gpt-5.1",
        input=system_prompt + "\n\nUser pain description:\n" + pain_text,
        timeout=30
    )

    raw = res.output_text.strip()
    print("\n🔵 RAW GPT OUTPUT:\n", raw)
    return raw

# --------------------------------------------------------------------
# VECTOR MATCHING
# --------------------------------------------------------------------


def find_top_k_with_side(query_emb, side: str | None, k: int = 5):
    q = query_emb / np.linalg.norm(query_emb)
    sims = structure_matrix @ q

    candidates = []
    for i, s in enumerate(STRUCTURES):
        if side == "left" and not s["id"].endswith("l"):
            continue
        if side == "right" and not s["id"].endswith("r"):
            continue

        candidates.append((s, float(sims[i])))

    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[:k]

def pick_best_from_candidates(query: str, candidates):
    best_lexical = None
    best_lex_score = 0.0

    for s, emb_score in candidates:
        label = s["label"].lower()

        t = token_overlap(query, label)
        f = fuzzy_score(query, label)
        lexical = max(t, f)

        if lexical > best_lex_score:
            best_lex_score = lexical
            best_lexical = s

    # lexical override
    if best_lexical and best_lex_score >= 0.9:
        return best_lexical, best_lex_score, "lexical"

    # fallback to best embedding
    return candidates[0][0], candidates[0][1], "embedding"

def embed_texts(texts: list[str]) -> dict[str, np.ndarray]:
    if not texts:
        return {}

    res = client.embeddings.create(
        model="text-embedding-3-large",
        input=texts,
        timeout=30
    )

    out = {}
    for t, d in zip(texts, res.data):
        out[t] = np.array(d.embedding)
    return out





# --------------------------------------------------------------------
# MAIN PIPELINE
# --------------------------------------------------------------------
def predict_structure(pain_text: str):

    if not pain_text or not pain_text.strip():
        return {"primary": None, "supporting": []}

    if len(pain_text) > 700:
        return {
            "primary": None,
            "supporting": [],
            "error": "Input too long. Please be more concise."
        }

    print("\n================ NEW REQUEST ================\n")
    t0 = time.time()

    # ---- GPT ----
    t_gpt = time.time()
    raw = gpt_reason(pain_text)
    log_step("GPT", t_gpt)


    try:
        reasoning = json.loads(raw)
    except Exception as e:
        print("❌ GPT returned invalid JSON:", str(e))
        return {
            "primary": None,
            "supporting": [],
            "error": "Could not interpret input. Try rephrasing."
        }


    primary_base = reasoning.get("primary")
    side = reasoning.get("side")

    # ✅ resolve laterality ONCE for the whole request
    resolved_side = side
    if resolved_side is None:
        resolved_side = "left"   # default for paired anatomy


    # ---- NO ANSWER ----
    if not primary_base:
        print("🚫 NO ANSWER FROM GPT")
        return {"primary": None, "supporting": []}

    def normalize(s: str) -> str:
        return s.lower().strip()

    primary_label_query = apply_side_label(normalize(primary_base), resolved_side)

    supporting_label_queries = [
        apply_side_label(normalize(s), resolved_side)
        for s in reasoning.get("supporting", [])
    ]

    supporting_label_queries = list(dict.fromkeys(supporting_label_queries))


    print("🔵 PRIMARY:", primary_label_query)
    print("🔵 SUPPORTING:", supporting_label_queries)

    all_queries = [primary_label_query] + supporting_label_queries
    t_redis = time.time()
    cache_map = redis_mget(all_queries)
    print(f"⏱ REDIS MGET TOTAL: {(time.time() - t_redis)*1000:.2f} ms")


    print(
    f"🧠 CACHE FETCH | "
    f"queries={len(all_queries)} "
    f"hits={len(cache_map)} "
    f"misses={len(all_queries) - len(cache_map)}"
)


    to_embed = []

    if primary_label_query not in cache_map or \
    cache_map[primary_label_query]["similarity"] < CACHE_TRUST_THRESHOLD:
        to_embed.append(primary_label_query)

    for q in supporting_label_queries:
        if q not in cache_map or cache_map[q]["similarity"] < CACHE_TRUST_THRESHOLD:
            to_embed.append(q)

    to_embed = list(dict.fromkeys(to_embed))  # safety

    t_embed = time.time()
    embeddings_map = embed_texts(to_embed)
    log_step(f"EMBEDDINGS (count={len(to_embed)})", t_embed)



    # ----------------------------------------------------------------
    # PRIMARY MATCH (CACHE → EMBED ONLY IF NEEDED)
    # ----------------------------------------------------------------
    primary_struct = None

    cached = cache_map.get(primary_label_query)

    if cached and cached["similarity"] >= CACHE_TRUST_THRESHOLD:
        primary_struct = STRUCTURE_BY_ID[cached["mapped_id"]]
        print(
            f"🎯 PRIMARY CACHE HIT | "
            f"id={cached['mapped_id']} "
            f"score={cached['similarity']:.4f}"
        )

    else:
        print(f"🧠 PRIMARY EMBEDDING PATH | query='{primary_label_query}'")

        emb = embeddings_map[primary_label_query]

        top_k = find_top_k_with_side(np.array(emb), resolved_side, k=5)
        best, score, source = pick_best_from_candidates(primary_label_query, top_k)

        print(
            f"🧠 PRIMARY PICK | "
            f"id={best['id']} "
            f"source={source} "
            f"score={score:.4f}"
        )

        if cached is None or score > cached["similarity"]:
            redis_set(primary_label_query, best["id"], score)
            print(f"♻️ PRIMARY CACHE UPDATED")
            primary_struct = best
        else:
            primary_struct = STRUCTURE_BY_ID[cached["mapped_id"]]
            print(f"🔒 PRIMARY CACHE KEPT")



    # 🚫 STOP IF PRIMARY FAILED
    if not primary_struct:
        return {"primary": None, "supporting": []}

    # ✅ track used structure IDs to prevent duplicates
    used_ids = set()
    used_ids.add(primary_struct["id"])



    # ----------------------------------------------------------------
    # SUPPORTING MATCH (CACHE → EMBED ONLY IF NEEDED)
    # ----------------------------------------------------------------
    supporting_structs = []

    for label_query in supporting_label_queries:
        cached = cache_map.get(label_query)

        # 🔒 reject wrong-side cache
        if cached:
            cid = cached["mapped_id"]
            if (resolved_side == "left" and not cid.endswith("l")) or \
            (resolved_side == "right" and not cid.endswith("r")):
                cached = None

        print(f"➡️ SUPPORTING QUERY | '{label_query}'")

        if cached and cached["similarity"] >= CACHE_TRUST_THRESHOLD:
            best = STRUCTURE_BY_ID[cached["mapped_id"]]
            print(
                f"⚡ SUPPORTING CACHE HIT | "
                f"id={cached['mapped_id']} "
                f"score={cached['similarity']:.4f}"
            )
        else:
            print(f"🧠 SUPPORTING EMBEDDING PATH | query='{label_query}'")

            emb = embeddings_map[label_query]
            top_k = find_top_k_with_side(np.array(emb), resolved_side, k=5)
            best, score, source = pick_best_from_candidates(label_query, top_k)

            print(
                f"🧠 SUPPORTING PICK | "
                f"id={best['id']} "
                f"source={source} "
                f"score={score:.4f}"
            )

            if cached is None or score > cached["similarity"]:
                redis_set(label_query, best["id"], score)
                print("♻️ SUPPORTING CACHE UPDATED")

        # -----------------------
        # ✅ APPEND (COMMON PATH)
        # -----------------------
        if best["id"] in used_ids:
            continue

        # 🔒 enforce side
        if resolved_side == "left" and best["id"].endswith("r"):
            continue
        if resolved_side == "right" and best["id"].endswith("l"):
            continue

        supporting_structs.append({
            "id": best["id"],
            "label": best["label"]
        })

        used_ids.add(best["id"])





    print(
    f"\n✅ REQUEST DONE | "
    f"primary={primary_struct['id']} "
    f"supporting={len(supporting_structs)} "
    f"time={(time.time() - t0)*1000:.2f} ms\n"
)


    return {
        "primary": {
            "id": primary_struct["id"],
            "label": primary_struct["label"]
        },
        "supporting": supporting_structs
    }
