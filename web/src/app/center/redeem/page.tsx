"use client";

import { useEffect, useRef, useState } from "react";
import { Coins, Gift, LoaderCircle, Ticket } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthGuard } from "@/lib/use-auth-guard";
import {
  fetchMe,
  fetchMyRedeems,
  fetchQuotaRecords,
  redeemCode,
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

export default function RedeemPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const didLoadRef = useRef(false);
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const [records, setRecords] = useState<QuotaRecord[]>([]);
  const [summary, setSummary] = useState<{ total_income: number; total_expense: number; count: number }>({ total_income: 0, total_expense: 0, count: 0 });
  const [myRedeems, setMyRedeems] = useState<RedeemCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [code, setCode] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [me, recData, redeemData] = await Promise.all([
        fetchMe(),
        fetchQuotaRecords(100),
        fetchMyRedeems(),
      ]);
      setQuotaLeft(me.quota_left);
      setRecords(recData.items);
      setSummary(recData.summary);
      setMyRedeems(redeemData.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载额度中心失败");
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

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
          <Coins className="size-5 text-stone-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">额度中心</h1>
          <p className="text-sm text-stone-500">充值卡兑换与额度明细</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-stone-500">剩余额度</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{quotaLeft !== null && quotaLeft < 0 ? "不限量" : String(quotaLeft ?? 0)}</div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-emerald-600">累计收入</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-emerald-600">{summary.total_income}</div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-rose-500">累计支出</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold text-rose-500">{summary.total_expense}</div>
              </CardContent>
            </Card>
          </div>

          {/* 兑换 */}
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

          {/* 我的兑换记录 */}
          {myRedeems.length > 0 ? (
            <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gift className="size-5 text-stone-600" />
                  我的兑换记录
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-xl border border-stone-200">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
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

          {/* 额度明细 */}
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
                <div className="overflow-x-auto rounded-xl border border-stone-200">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
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
        </>
      )}
    </div>
  );
}
