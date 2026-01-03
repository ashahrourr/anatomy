from backend.db import supabase

def is_user_pro(user_id: str) -> bool:
    if not user_id:
        return False

    res = (
        supabase
        .table("user_plans")
        .select("is_pro")
        .eq("user_id", user_id)
        .single()
        .execute()
    )

    if not res.data:
        return False

    return bool(res.data["is_pro"])
