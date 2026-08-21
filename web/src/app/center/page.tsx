"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Coins, Gift, KeyRound, LoaderCircle, Mail, Plug, ShieldCheck, Store, Ticket, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { McpAccessCard } from "./components/mcp-access-card";
import { ModelPlazaCard } from "./components/model-plaza-card";
import {
  bindEmail,
  changeMyPassword,
  doCheckin,
  fetchCheckinCalendar,
  fetchCheckinStatus,
  fetchMe,
  fetchMyRedeems,
  fetchQuotaRecords,
  redeemCode,
  sendBindEmailCode,
  type QuotaRecord,
  type RedeemCode,
} from "@/lib/api";

function formatDateTime(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    register: "注册赠送",
    checkin: "每日签到",
    admin_grant: "管理员充值",
    redeem: "充值卡兑换",
    image: "图片生成",
    generate: "文本生成",
    edit: "图片编辑",
    search: "搜索",
    messages: "消息",
    responses: "Responses",
  };
  return labels[source] || source;
}

export default function CenterPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const didLoadRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);

  // 账户与签到
  const [user, setUser] = useState<{ quota_left: number; quota_total: number; checkin_streak: number; total_checkins: number; email: string; email_verified: boolean } | null>(null);
  const [checkinDates, setCheckinDates] = useState<Set<string>>(() => new Set());
  const [checkedToday, setCheckedToday] = useState(false);
  const [checkinBonus, setCheckinBonus] = useState(0);
  const [streakBonuses, setStreakBonuses] = useState<{ days: number; bonus: number }[]>([]);
  const [nextStreakBonus, setNextStreakBonus] = useState<{ days: number; bonus: number } | null>(null);
  const [isCheckinPending, setIsCheckinPending] = useState(false);

  // 额度
  const [records, setRecords] = useState<QuotaRecord[]>([]);
  const [summary, setSummary] = useState<{ total_income: number; total_expense: number; count: number }>({ total_income: 0, total_expense: 0, count: 0 });
  const [myRedeems, setMyRedeems] = useState<RedeemCode[]>([]);
  const [code, setCode] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);

  // 修改密码
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // 绑定邮箱
  const [bindEmailInput, setBindEmailInput] = useState("");
  const [bindCode, setBindCode] = useState("");
  const [isSendingBindCode, setIsSendingBindCode] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [bindCountdown, setBindCountdown] = useState(0);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [me, calData, checkinData, recData, redeemData] = await Promise.all([
        fetchMe(),
        fetchCheckinCalendar(60),
        fetchCheckinStatus(),
        fetchQuotaRecords(100),
        fetchMyRedeems(),
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
      setRecords(recData.items);
      setSummary(recData.summary);
      setMyRedeems(redeemData.items);
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

  useEffect(() => {
    if (bindCountdown <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setBindCountdown((current) => current - 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bindCountdown > 0]);

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

  const handleRedeem = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      toast.error("请输入兑换码");
      return;
    }
    setIsRedeeming(true);
    try {
      const data = await redeemCode(trimmed);
      setCode("");
      toast.success(`兑换成功！获得 ${data.amount} 额度`);
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "兑换失败");
    } finally {
      setIsRedeeming(false);
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

  const quotaLeft = user?.quota_left ?? null;
  const quotaTotal = user?.quota_total ?? 0;
  const quotaDisplay = quotaLeft !== null && quotaLeft < 0 ? "不限量" : String(quotaLeft ?? 0);
  const unlimited = quotaTotal < 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-6 sm:px-6">
      {/* 账户概览 */}
      <div className="relative overflow-hidden rounded-2xl bg-stone-950 p-6 text-white shadow-sm">
        <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-stone-800/60 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 right-24 size-40 rounded-full bg-emerald-900/30 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium tracking-wider text-stone-400 uppercase">
              <UserRound className="size-3.5" />
              {session.role === "admin" ? "管理员账户" : "账户余额"}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-4xl font-bold tracking-tight">{quotaDisplay}</span>
              <span className="text-sm text-stone-400">{unlimited ? "（不限量）" : "额度"}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-300">
              <span className="inline-flex items-center gap-1.5">
                <CalendarCheck className="size-3.5 text-emerald-400" />
                连续签到 {user?.checkin_streak ?? 0} 天
              </span>
              <span>累计签到 {user?.total_checkins ?? 0} 天</span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Mail className="size-3.5 shrink-0 text-stone-400" />
                <span className="truncate">{user?.email || "未绑定邮箱"}</span>
                {user?.email_verified ? (
                  <Badge className="shrink-0 bg-emerald-500/20 text-emerald-300">已验证</Badge>
                ) : user?.email ? (
                  <Badge className="shrink-0 bg-amber-500/20 text-amber-300">未验证</Badge>
                ) : null}
              </span>
            </div>
          </div>
          <div className="shrink-0">
            {checkedToday ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-emerald-300">
                <CalendarCheck className="size-4" />
                今日已签到
              </span>
            ) : (
              <Button
                className="h-10 rounded-xl bg-emerald-600 px-5 text-white hover:bg-emerald-500"
                onClick={() => void handleCheckin()}
                disabled={isCheckinPending}
              >
                {isCheckinPending ? <LoaderCircle className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
                立即签到{checkinBonus > 0 ? ` +${checkinBonus}` : ""}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 页内功能分区 */}
      <Tabs defaultValue="checkin" className="space-y-4">
        <div className="sticky top-3 z-20 overflow-x-auto rounded-xl border border-white/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          <TabsList variant="line" className="min-w-max justify-start">
            <TabsTrigger value="checkin" className="gap-1.5 px-4"><CalendarCheck className="size-4" />每日签到</TabsTrigger>
            <TabsTrigger value="quota" className="gap-1.5 px-4"><Coins className="size-4" />额度明细</TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5 px-4"><ShieldCheck className="size-4" />安全设置</TabsTrigger>
            <TabsTrigger value="mcp" className="gap-1.5 px-4"><Plug className="size-4" />MCP 接入</TabsTrigger>
            <TabsTrigger value="plaza" className="gap-1.5 px-4"><Store className="size-4" />模型广场</TabsTrigger>
          </TabsList>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <LoaderCircle className="size-5 animate-spin text-stone-400" />
          </div>
        ) : (
          <>
            {/* 每日签到 */}
            <TabsContent value="checkin" className="min-h-[440px] space-y-4">
              <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-base">
                      <CalendarCheck className="size-5 text-stone-600" />
                      签到日历
                    </span>
                    <Badge className="bg-stone-950 text-white">已连续 {user?.checkin_streak ?? 0} 天</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-500">
                    <span>累计签到 {user?.total_checkins ?? 0} 天</span>
                    {checkinBonus > 0 ? <span>· 每天签到赠送 {checkinBonus} 额度</span> : null}
                    {streakBonuses.length > 0 ? (
                      <span>
                        · 连续签到奖励：{streakBonuses.map((item) => `满 ${item.days} 天 +${item.bonus}`).join("，")}
                      </span>
                    ) : null}
                  </div>
                  {nextStreakBonus ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
                      再连续签到 {Math.max(0, nextStreakBonus.days - (user?.checkin_streak ?? 0))} 天，可额外获得 {nextStreakBonus.bonus} 额度奖励
                    </div>
                  ) : null}
                  <div>
                    <div className="mb-2 text-sm font-medium text-stone-700">最近 60 天签到记录</div>
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
            </TabsContent>

            {/* 额度明细 */}
            <TabsContent value="quota" className="min-h-[440px] space-y-4">
              <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
                <CardContent className="grid gap-6 p-6 sm:grid-cols-3">
                  <div>
                    <div className="text-sm font-medium text-stone-500">剩余额度</div>
                    <div className="mt-1.5 text-2xl font-semibold">{quotaDisplay}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-emerald-600">累计收入</div>
                    <div className="mt-1.5 text-2xl font-semibold text-emerald-600">{summary.total_income}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-rose-500">累计支出</div>
                    <div className="mt-1.5 text-2xl font-semibold text-rose-500">{summary.total_expense}</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Ticket className="size-5 text-stone-600" />
                    额度兑换
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex max-w-xl gap-2">
                    <Input
                      value={code}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void handleRedeem();
                        }
                      }}
                      placeholder="请输入充值卡兑换码"
                      className="h-10 flex-1 rounded-xl border-stone-200 bg-white font-mono uppercase"
                    />
                    <Button
                      className="h-10 rounded-xl bg-stone-950 px-6 text-white hover:bg-stone-800"
                      onClick={() => void handleRedeem()}
                      disabled={isRedeeming}
                    >
                      {isRedeeming ? <LoaderCircle className="size-4 animate-spin" /> : <Gift className="size-4" />}
                      兑换
                    </Button>
                  </div>
                  <p className="text-xs text-stone-400">兑换码请联系管理员获取，兑换后额度立即到账。</p>
                </CardContent>
              </Card>

              {myRedeems.length > 0 ? (
                <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Gift className="size-5 text-stone-600" />
                      我的兑换记录
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-56 overflow-auto rounded-xl border border-stone-200">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead className="sticky top-0 z-10">
                          <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                            <th className="px-4 py-3 font-medium">兑换码</th>
                            <th className="px-4 py-3 font-medium">面额</th>
                            <th className="px-4 py-3 font-medium">兑换时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {myRedeems.map((item) => (
                            <tr key={item.id} className="border-b border-stone-100 last:border-0">
                              <td className="px-4 py-2.5 font-mono text-xs">{item.code}</td>
                              <td className="px-4 py-2.5 font-medium text-emerald-600">+{item.amount}</td>
                              <td className="px-4 py-2.5 text-stone-500">{formatDateTime(item.used_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Coins className="size-5 text-stone-600" />
                    额度明细
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {records.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-stone-400">暂无额度记录</div>
                  ) : (
                    <div className="max-h-[380px] overflow-auto rounded-xl border border-stone-200">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="sticky top-0 z-10">
                          <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                            <th className="px-4 py-3 font-medium">时间</th>
                            <th className="px-4 py-3 font-medium">类型</th>
                            <th className="px-4 py-3 font-medium">来源</th>
                            <th className="px-4 py-3 text-right font-medium">变动</th>
                            <th className="px-4 py-3 text-right font-medium">变动后余额</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((record) => (
                            <tr key={record.id} className="border-b border-stone-100 last:border-0">
                              <td className="px-4 py-2.5 text-stone-500">{formatDateTime(record.created_at)}</td>
                              <td className="px-4 py-2.5">
                                {record.type === "income" ? (
                                  <Badge className="bg-emerald-100 text-emerald-700">收入</Badge>
                                ) : (
                                  <Badge variant="secondary" className="bg-rose-100 text-rose-700">支出</Badge>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-stone-700">
                                {sourceLabel(record.source)}
                                {record.note ? <span className="ml-1 text-xs text-stone-400">({record.note})</span> : null}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-medium ${record.type === "income" ? "text-emerald-600" : "text-rose-500"}`}>
                                {record.type === "income" ? "+" : "-"}{record.amount}
                              </td>
                              <td className="px-4 py-2.5 text-right text-stone-600">{record.balance_after}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* 安全设置 */}
            <TabsContent value="security" className="min-h-[440px] space-y-4">
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
            </TabsContent>
            <TabsContent value="mcp" className="min-h-[440px] space-y-4">
              <McpAccessCard />
            </TabsContent>
            <TabsContent value="plaza" className="min-h-[440px] space-y-4">
              <ModelPlazaCard />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
