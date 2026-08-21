"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, History, KeyRound, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createMyApiKey,
  deleteMyApiKey,
  fetchMyApiKeyCalls,
  fetchMyApiKeys,
  fetchMyApiKeysInfo,
  fetchPublicSettings,
  updateMyApiKey,
  type ApiKeyCallRecord,
  type ApiKeyInfo,
  type ApiKeysInfo,
} from "@/lib/api";

function formatDateTime(value?: string | null) {
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

export function ApiKeysCard() {
  const didLoadRef = useRef(false);
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [info, setInfo] = useState<ApiKeysInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // 创建
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createModel, setCreateModel] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [copied, setCopied] = useState(false);

  // 调用记录
  const [callsFor, setCallsFor] = useState<ApiKeyInfo | null>(null);
  const [calls, setCalls] = useState<ApiKeyCallRecord[]>([]);
  const [callsTotal, setCallsTotal] = useState(0);
  const [isLoadingCalls, setIsLoadingCalls] = useState(false);

  const loadAll = async () => {
    try {
      const [keyData, infoData] = await Promise.all([fetchMyApiKeys(), fetchMyApiKeysInfo()]);
      setKeys(keyData.items);
      setInfo(infoData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 API Key 失败");
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
    // 绑定模型可选范围 = 管理员配置的 API 可用模型
    void fetchPublicSettings()
      .then((data) => {
        setAvailableModels(Array.isArray(data.api_available_models) ? data.api_available_models : []);
      })
      .catch(() => setAvailableModels([]));
  }, []);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const data = await createMyApiKey({ name: createName.trim(), model: createModel.trim() });
      setNewKey(data.key);
      setCopied(false);
      setCreateName("");
      setCreateModel("");
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (item: ApiKeyInfo) => {
    try {
      await updateMyApiKey(item.id, { enabled: !item.enabled });
      await loadAll();
      toast.success(item.enabled ? "Key 已停用" : "Key 已启用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  };

  const handleDelete = async (item: ApiKeyInfo) => {
    if (!window.confirm(`确认删除 API Key「${item.name}」？删除后立即失效，不可恢复。`)) {
      return;
    }
    try {
      await deleteMyApiKey(item.id);
      await loadAll();
      toast.success("已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  const handleViewCalls = async (item: ApiKeyInfo) => {
    setCallsFor(item);
    setCalls([]);
    setCallsTotal(0);
    setIsLoadingCalls(true);
    try {
      const data = await fetchMyApiKeyCalls(item.id, 100, 0);
      setCalls(data.items);
      setCallsTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载调用记录失败");
    } finally {
      setIsLoadingCalls(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const globalOff = info !== null && !info.global_enabled;
  const userOff = info !== null && !info.user_enabled;

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-5 text-stone-600" />
            API Key 管理
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {globalOff ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="size-4 shrink-0" />
              全站 API 服务当前已关闭，调用将无法使用，请联系管理员开启。
            </div>
          ) : null}
          {userOff ? (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="size-4 shrink-0" />
              你的 API 功能已被管理员关闭，无法使用与生成 Key。
            </div>
          ) : null}
          {info && info.api_concurrency > 0 ? (
            <div className="text-xs text-stone-400">并发上限：{info.api_concurrency} 个同时请求</div>
          ) : null}
          {info && info.api_daily_limit > 0 ? (
            <div className="text-xs text-stone-400">每日调用次数上限：{info.api_daily_limit} 次</div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-stone-500">
              一个 Key 可绑定单个模型（留空则不限）；调用时按实际模型倍率扣减额度。
            </p>
            <Button
              className="h-9 shrink-0 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
              onClick={() => setIsCreateOpen(true)}
              disabled={isLoading || userOff || globalOff}
            >
              <Plus className="size-4" />
              生成 Key
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400">
              暂无 API Key，点击「生成 Key」创建
            </div>
          ) : (
            <div className="space-y-2">
              {keys.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-stone-200 bg-white p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-stone-900">{item.name || "未命名 Key"}</span>
                      {item.enabled ? (
                        <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-stone-100 text-stone-500">停用</Badge>
                      )}
                      {item.model ? (
                        <Badge className="bg-violet-100 font-mono text-violet-700">绑定 {item.model}</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-stone-100 text-stone-500">不限模型</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-stone-500">
                      {item.id} · 创建于 {formatDateTime(item.created_at)} · 累计调用 {item.call_count} 次 · 最近 {formatDateTime(item.last_used_at)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="outline" className="h-8 rounded-lg px-2.5 text-xs text-stone-600" onClick={() => void handleViewCalls(item)}>
                      <History className="size-3.5" />
                      调用记录
                    </Button>
                    <Button type="button" variant="outline" className="h-8 rounded-lg px-2.5 text-xs text-stone-600" onClick={() => void handleToggle(item)}>
                      {item.enabled ? "停用" : "启用"}
                    </Button>
                    <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs text-rose-600 hover:text-rose-700" onClick={() => void handleDelete(item)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建 Key */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>生成 API Key</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              Key 将绑定到你的账号。可绑定单个模型（调用其他模型会被拒绝），留空表示不限模型。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm text-stone-700">名称（可选）</label>
              <Input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="例如：生产环境" className="h-10 rounded-xl border-stone-200 bg-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-stone-700">绑定模型（可选）</label>
              <Select value={createModel} onValueChange={setCreateModel}>
                <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white text-sm shadow-none">
                  <SelectValue placeholder="不限模型（可调用全部开放模型）" />
                </SelectTrigger>
                <SelectContent className="z-[120]">
                  <SelectItem value="">不限模型</SelectItem>
                  {availableModels.map((model) => (
                    <SelectItem key={model} value={model} className="font-mono text-xs">
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-5 text-stone-400">绑定后该 Key 仅能调用此模型。</p>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button type="button" className="rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleCreate()} disabled={isCreating}>
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新 Key 展示（仅展示一次） */}
      <Dialog open={Boolean(newKey)} onOpenChange={(open) => { if (!open) setNewKey(""); }}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>新 API Key 生成成功</DialogTitle>
            <DialogDescription className="text-sm leading-6">仅此一次展示完整 Key，请立即保存，关闭后将无法再次查看。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="block flex-1 break-all rounded-lg bg-stone-100 px-3 py-2.5 font-mono text-xs leading-5 text-stone-900">{newKey}</code>
            <Button className="h-9 shrink-0 rounded-lg bg-emerald-700 px-3 text-xs text-white hover:bg-emerald-600" onClick={() => void handleCopy(newKey)}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" className="rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => setNewKey("")}>
              我已保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 调用记录 */}
      <Dialog open={callsFor !== null} onOpenChange={(open) => { if (!open) setCallsFor(null); }}>
        <DialogContent className="flex h-[min(78dvh,680px)] w-[94vw] max-w-3xl flex-col rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="size-5" />
              API Key 调用记录
              {callsFor ? <span className="font-mono text-xs text-stone-400">（{callsFor.name || callsFor.id} · 共 {callsTotal} 次）</span> : null}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-stone-200">
            {isLoadingCalls ? (
              <div className="flex items-center justify-center p-10">
                <LoaderCircle className="size-5 animate-spin text-stone-400" />
              </div>
            ) : calls.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-stone-400">暂无调用记录</div>
            ) : (
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="px-4 py-3 font-medium">接口</th>
                    <th className="px-4 py-3 font-medium">模型</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 text-right font-medium">耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call, index) => (
                    <tr key={`${call.time}-${index}`} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-stone-500">{formatDateTime(call.time)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-700">{call.ip || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-600">{call.endpoint}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-600">{call.model}</td>
                      <td className="px-4 py-2.5">
                        {call.status === "success" ? (
                          <Badge className="bg-emerald-100 text-emerald-700">成功</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-rose-100 text-rose-700">失败</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-stone-600">{typeof call.duration_ms === "number" ? `${call.duration_ms}ms` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {calls.some((call) => call.error) ? (
            <p className="text-xs text-stone-400">失败原因请管理员在后台日志中查看。</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
