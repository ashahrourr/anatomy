# backend/plans.py
from backend.db import supabase

def is_user_pro(user_id: str) -> bool:
    if not user_id:
        return False

    try:
        res = (
            supabase.table("user_plans")
            .select("is_pro")
            .eq("user_id", user_id)
            .execute()
        )
        if not res.data:
            return False
        return bool(res.data[0].get("is_pro"))
    except Exception as e:
        print("❌ is_user_pro failed:", repr(e))
        return False
