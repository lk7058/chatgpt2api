"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, LoaderCircle, Plus, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  deleteRedeemCode,
  fetchRedeemCodes,
  generateRedeemCodes,
  type RedeemCode,
} from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";

function formatDateTime(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function RedeemCodesCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<RedeemCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [count, setCount] = useState("10");
  const [amount, setAmount] = useState("10");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<RedeemCode[]>([]);
  const [filter, setFilter] = useState<"all" | "unused" | "used">("all");

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchRedeemCodes(filter === "all" ? "" : filter);
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载充值卡失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void load();
  }, []);

  useEffect(() => {
    if (didLoadRef.current) {
      void load();
    }
  }, [filter]);

  const handleGenerate = async () => {
    const countNum = Number(count);
    const amountNum = Number(amount);
    if (!Number.isFinite(countNum) || countNum < 1 || countNum > 100) {
      toast.error("数量需在 1-100 之间");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum < 1) {
      toast.error("面额需大于 0");
      return;
    }
    setIsGenerating(true);
    try {
      const data = await generateRedeemCodes(Math.floor(countNum), Math.floor(amountNum));
      setGenerated(data.items);
      toast.success(`已生成 ${data.count} 张充值卡`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyAll = async () => {
    if (generated.length === 0) {
      return;
    }
    const text = generated.map((item) => `${item.code}（${item.amount}额度）`).join("\n");
    try {
      await copyToClipboard(text);
      toast.success("已复制全部充值卡");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await copyToClipboard(code);
      toast.success("兑换码已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());

  const handleDelete = async (item: RedeemCode) => {
    if (!window.confirm(`确定删除兑换码 ${item.code} 吗？删除后不可恢复。`)) {
      return;
    }
    setDeletingIds((current) => new Set(current).add(item.id));
    try {
      await deleteRedeemCode(item.id);
      setItems((current) => current.filter((i) => i.id !== item.id));
      setGenerated((current) => current.filter((i) => i.id !== item.id));
      toast.success("已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
              <Ticket className="size-5 text-stone-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">额度充值卡</h2>
              <p className="text-sm text-stone-500">生成充值卡兑换码，用户可在额度中心兑换额度。</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm text-stone-700">生成数量</label>
              <Input type="number" value={count} onChange={(event) => setCount(event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">单张面额（额度）</label>
              <Input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" />
            </div>
            <div className="flex items-end">
              <Button className="h-10 w-full rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={() => void handleGenerate()} disabled={isGenerating}>
                {isGenerating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                生成充值卡
              </Button>
            </div>
          </div>

          {generated.length > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-900">新生成的充值卡（仅本次展示）</span>
                <Button type="button" variant="outline" className="h-8 rounded-lg border-emerald-200 bg-white px-3 text-xs text-emerald-700" onClick={() => void handleCopyAll()}>
                  <Copy className="size-3.5" /> 复制全部
                </Button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {generated.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex items-center justify-between rounded-lg border border-emerald-200 bg-white/80 px-3 py-2 text-left text-xs transition hover:bg-white"
                    onClick={() => void handleCopyCode(item.code)}
                    title="点击复制"
                  >
                    <span className="font-mono font-medium text-emerald-900">{item.code}</span>
                    <span className="ml-2 shrink-0 text-emerald-600">{item.amount} 额度</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-stone-700">充值卡列表</span>
            {(["all", "unused", "used"] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={`rounded-full px-3 py-1 text-xs transition ${
                  filter === status ? "bg-stone-950 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
                onClick={() => setFilter(status)}
              >
                {status === "all" ? "全部" : status === "unused" ? "未使用" : "已使用"}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                    <th className="px-4 py-3 font-medium">兑换码</th>
                    <th className="px-4 py-3 font-medium">面额</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">使用人</th>
                    <th className="px-4 py-3 font-medium">生成时间</th>
                    <th className="px-4 py-3 font-medium">使用时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <button type="button" className="font-mono text-xs text-stone-700 transition hover:text-stone-950" onClick={() => void handleCopyCode(item.code)} title="点击复制">
                          {item.code}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-stone-700">{item.amount}</td>
                      <td className="px-4 py-2.5">
                        {item.status === "unused" ? (
                          <Badge className="bg-emerald-100 text-emerald-700">未使用</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-stone-100 text-stone-500">已使用</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-stone-500">{item.used_username || "—"}</td>
                      <td className="px-4 py-2.5 text-stone-500">{formatDateTime(item.created_at)}</td>
                      <td className="px-4 py-2.5 text-stone-500">{formatDateTime(item.used_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 text-xs text-rose-600 hover:text-rose-700"
                            disabled={deletingIds.has(item.id)}
                            onClick={() => void handleDelete(item)}
                          >
                            {deletingIds.has(item.id) ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-stone-400">暂无充值卡</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
