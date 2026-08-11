"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Coins, KeyRound, LoaderCircle, Mail } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthGuard } from "@/lib/use-auth-guard";
import {
  bindEmail,
  changeMyPassword,
  doCheckin,
  fetchCheckinCalendar,
  fetchCheckinStatus,
  fetchMe,
  sendBindEmailCode,
} from "@/lib/api";

export default function CenterPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const didLoadRef = useRef(false);
  const [user, setUser] = useState<{ quota_left: number; quota_total: number; checkin_streak: number; total_checkins: number; email: string; email_verified: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [checkinDates, setCheckinDates] = useState<Set<string>>(() => new Set());
  const [checkedToday, setCheckedToday] = useState(false);
  const [checkinBonus, setCheckinBonus] = useState(0);
  const [streakBonuses, setStreakBonuses] = useState<{ days: number; bonus: number }[]>([]);
  const [nextStreakBonus, setNextStreakBonus] = useState<{ days: number; bonus: number } | null>(null);
  const [isCheckinPending, setIsCheckinPending] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [me, calData, checkinData] = await Promise.all([
        fetchMe(),
        fetchCheckinCalendar(60),
        fetchCheckinStatus(),
      ]);
      setUser({
        quota_left: me.quota_left,
        quota_total: me.quota_total,
        checkin_streak: checkinData.checkin_streak,
        total_checkins: checkinData.total_checkins,
        email: me.user?.email || "",
        email_verified: Boolean(me.user?.email_verified),
      });
      setCheckinDates(new Set(calData.dates));
      setCheckedToday(checkinData.checked_today);
      setCheckinBonus(checkinData.bonus_quota);
      setStreakBonuses(checkinData.streak_bonuses || []);
      setNextStreakBonus(checkinData.next_streak_bonus || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户中心失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadAll();
  }, []);

  const handleCheckin = async () => {
    if (isCheckinPending) {
      return;
    }
    setIsCheckinPending(true);
    try {
      const data = await doCheckin();
      setCheckedToday(true);
      setCheckinDates((current) => {
        const next = new Set(current);
        next.add(new Date().toISOString().slice(0, 10));
        return next;
      });
      await loadAll();
      if (data.bonus_quota > 0) {
        const streakNote = data.streak_bonus && data.streak_bonus > 0 ? `（含连续签到 ${data.checkin_streak} 天奖励 ${data.streak_bonus}）` : "";
        toast.success(`签到成功！获得 ${data.bonus_quota} 额度${streakNote}，已连续签到 ${data.checkin_streak} 天`);
      } else {
        toast.success(`签到成功！已连续签到 ${data.checkin_streak} 天`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "签到失败");
    } finally {
      setIsCheckinPending(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      toast.error("请填写原密码和新密码");
      return;
    }
    if (newPassword.length < 4) {
      toast.error("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setIsSavingPassword(true);
    try {
      await changeMyPassword(oldPassword, newPassword);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("密码修改成功");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "修改密码失败");
    } finally {
      setIsSavingPassword(false);
    }
  };

  const [bindEmailInput, setBindEmailInput] = useState("");
  const [bindCode, setBindCode] = useState("");
  const [isSendingBindCode, setIsSendingBindCode] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [bindCountdown, setBindCountdown] = useState(0);

  useEffect(() => {
    if (bindCountdown <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setBindCountdown((current) => current - 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bindCountdown > 0]);

  const handleSendBindCode = async () => {
    const normalizedEmail = bindEmailInput.trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      toast.error("请填写有效邮箱");
      return;
    }
    setIsSendingBindCode(true);
    try {
      await sendBindEmailCode(normalizedEmail);
      setBindCountdown(60);
      toast.success("验证码已发送到邮箱，请查收");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送验证码失败");
    } finally {
      setIsSendingBindCode(false);
    }
  };

  const handleBindEmail = async () => {
    const normalizedEmail = bindEmailInput.trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      toast.error("请填写有效邮箱");
      return;
    }
    if (!bindCode.trim()) {
      toast.error("请输入邮箱验证码");
      return;
    }
    setIsBinding(true);
    try {
      const data = await bindEmail(normalizedEmail, bindCode.trim());
      setUser((current) =>
        current
          ? { ...current, email: data.item.email || normalizedEmail, email_verified: Boolean(data.item.email_verified) }
          : current,
      );
      setBindEmailInput("");
      setBindCode("");
      setBindCountdown(0);
      toast.success("邮箱绑定成功，可用于找回密码");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "绑定邮箱失败");
    } finally {
      setIsBinding(false);
    }
  };

  const calendarCells = useMemo(() => {
    const cells: { date: string; day: number; checked: boolean; isToday: boolean }[] = [];
    const today = new Date();
    for (let offset = 59; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      cells.push({
        date: key,
        day: date.getDate(),
        checked: checkinDates.has(key),
        isToday: offset === 0,
      });
    }
    return cells;
  }, [checkinDates]);

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
            <KeyRound className="size-5 text-stone-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">用户中心</h1>
            <p className="text-sm text-stone-500">签到与账户设置</p>
          </div>
        </div>
        <Link
          href="/center/redeem"
          className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          <Coins className="size-4" />
          额度中心
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </div>
      ) : (
        <>
          {/* 签到 + 日历 */}
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-base">
                  <CalendarCheck className="size-5 text-stone-600" />
                  每日签到
                </span>
                <Badge className="bg-stone-950 text-white">已连续 {user?.checkin_streak ?? 0} 天</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {checkedToday ? (
                  <Badge className="bg-emerald-100 text-emerald-700">今日已签到</Badge>
                ) : (
                  <Button
                    className="h-9 rounded-xl bg-emerald-600 px-5 text-white hover:bg-emerald-700"
                    onClick={() => void handleCheckin()}
                    disabled={isCheckinPending}
                  >
                    {isCheckinPending ? <LoaderCircle className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
                    立即签到{checkinBonus > 0 ? ` +${checkinBonus}` : ""}
                  </Button>
                )}
                <span className="text-sm text-stone-500">累计签到 {user?.total_checkins ?? 0} 天</span>
                {checkinBonus > 0 ? <span className="text-sm text-stone-500">· 每天签到赠送 {checkinBonus} 额度</span> : null}
                {streakBonuses.length > 0 ? (
                  <span className="text-sm text-stone-500">
                    · 连续签到奖励：
                    {streakBonuses.map((item) => `满 ${item.days} 天 +${item.bonus}`).join("，")}
                  </span>
                ) : null}
              </div>
              {nextStreakBonus ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
                  再连续签到 {Math.max(0, nextStreakBonus.days - (user?.checkin_streak ?? 0))} 天，可额外获得 {nextStreakBonus.bonus} 额度奖励
                </div>
              ) : null}
              <div>
                <div className="mb-2 text-sm font-medium text-stone-700">最近 60 天签到日历</div>
                <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-12">
                  {calendarCells.map((cell) => (
                    <div
                      key={cell.date}
                      title={cell.date}
                      className={`flex h-8 items-center justify-center rounded-md text-xs transition ${
                        cell.isToday
                          ? "border-2 border-emerald-500 bg-emerald-50 font-semibold text-emerald-700"
                          : cell.checked
                            ? "bg-emerald-500 text-white"
                            : "bg-stone-100 text-stone-400"
                      }`}
                    >
                      {cell.day}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-stone-400">
                  <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-emerald-500" /> 已签到</span>
                  <span className="inline-flex items-center gap-1"><span className="size-3 rounded border-2 border-emerald-500 bg-emerald-50" /> 今天</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 修改密码 */}
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-5 text-stone-600" />
                修改密码
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">原密码</label>
                <Input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} placeholder="请输入原密码" className="h-10 max-w-sm rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">新密码</label>
                <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" className="h-10 max-w-sm rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">确认新密码</label>
                <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="请再次输入新密码" className="h-10 max-w-sm rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button className="h-9 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleChangePassword()} disabled={isSavingPassword}>
                  {isSavingPassword ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  修改密码
                </Button>
                <p className="text-xs text-stone-400">忘记密码时可通过绑定邮箱找回</p>
              </div>
            </CardContent>
          </Card>

          {/* 绑定邮箱 */}
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="size-5 text-stone-600" />
                绑定邮箱
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {user?.email ? (
                <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                  <span className="truncate">{user.email}</span>
                  {user.email_verified ? (
                    <Badge className="shrink-0 bg-emerald-100 text-emerald-700">已验证</Badge>
                  ) : (
                    <Badge className="shrink-0 bg-amber-100 text-amber-700">未验证</Badge>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-500">尚未绑定邮箱，绑定后可通过邮箱找回密码。</p>
              )}
              <div className="space-y-2">
                <label className="text-sm text-stone-700">邮箱</label>
                <Input
                  type="email"
                  value={bindEmailInput}
                  onChange={(event) => setBindEmailInput(event.target.value)}
                  placeholder="请输入要绑定的邮箱"
                  className="h-10 max-w-sm rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="flex max-w-sm gap-2">
                <Input
                  value={bindCode}
                  onChange={(event) => setBindCode(event.target.value)}
                  placeholder="邮箱验证码"
                  className="h-10 flex-1 rounded-xl border-stone-200 bg-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                  onClick={() => void handleSendBindCode()}
                  disabled={isSendingBindCode || bindCountdown > 0}
                >
                  {isSendingBindCode ? <LoaderCircle className="size-4 animate-spin" /> : bindCountdown > 0 ? `${bindCountdown}s 后重发` : "获取验证码"}
                </Button>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button className="h-9 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleBindEmail()} disabled={isBinding}>
                  {isBinding ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  绑定邮箱
                </Button>
                <p className="text-xs text-stone-400">验证码 10 分钟内有效</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
