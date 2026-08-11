"use client";

import { login, fetchMe } from "@/lib/api";
import { clearStoredAuthSession, getStoredAuthSession, setStoredAuthSession, type StoredAuthSession } from "@/store/auth";

export async function getValidatedAuthSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredAuthSession();
  if (!storedSession) {
    return null;
  }

  try {
    const data = await login(storedSession.key);
    const nextSession: StoredAuthSession = {
      key: storedSession.key,
      role: data.role,
      subjectId: data.subject_id,
      name: data.name,
      username: storedSession.username,
      userId: storedSession.userId,
      quotaLeft: storedSession.quotaLeft,
      quotaTotal: storedSession.quotaTotal,
    };
    // 刷新额度信息
    try {
      const me = await fetchMe();
      nextSession.username = me.name || storedSession.username;
      nextSession.userId = me.user ? me.user.id : storedSession.userId;
      nextSession.quotaLeft = me.quota_left;
      nextSession.quotaTotal = me.quota_total;
    } catch {
      // 额度刷新失败不影响登录
    }
    await setStoredAuthSession(nextSession);
    return nextSession;
  } catch {
    await clearStoredAuthSession();
    return null;
  }
}
