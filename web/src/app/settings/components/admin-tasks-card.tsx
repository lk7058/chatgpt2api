"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ListX, RefreshCw, SquareX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelAdminImageTasks, fetchAdminImageTasks, type AdminImageTask } from "@/lib/api";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

function formatTime(value?: string) {
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
    second: "2-digit",
  }).format(date);
}

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  success: "已完成",
  error: "失败",
  cancelled: "已取消",
};

export function AdminTasksCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<AdminImageTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchAdminImageTasks();
      setItems(data.items);
      setSelected((current) => new Set([...current].filter((id) => data.items.some((item) => item.id === id))));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载任务列表失败");
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

  const activeItems = items.filter((item) => ACTIVE_STATUSES.has(item.status));
  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCancelSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) {
      toast.error("请先勾选要取消的任务");
      return;
    }
    setIsCancelling(true);
    try {
      const result = await cancelAdminImageTasks({ task_ids: ids });
      toast.success(`已取消 ${result.cancelled} 个任务`);
      setSelected(new Set());
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消失败");
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCancelAll = async () => {
    setIsCancelling(true);
    try {
      const result = await cancelAdminImageTasks({ all_tasks: true });
      toast.success(`已一键取消 ${result.cancelled} 个任务`);
      setConfirmAll(false);
      setSelected(new Set());
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消失败");
    } finally {
      setIsCancelling(false);
    }
  };

  const toggleAllActive = () => {
    const allActiveIds = activeItems.map((item) => item.id);
    const allSelected = allActiveIds.length > 0 && allActiveIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allActiveIds));
  };

  return (
    <>
      <Card className="overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListX className="size-4" />
            排队任务管理
          </CardTitle>
          <CardDescription>
            查看所有用户的排队/生成中任务，可勾选批量取消或一键取消全部。取消后用户侧显示「该任务已被管理员取消，请稍后重试！」。
            当前活跃任务：{activeItems.length} 个（共 {items.length} 条记录）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="h-9 rounded-lg border-stone-200 bg-white px-3 text-xs text-stone-600"
              onClick={() => void load()}
              disabled={isLoading}
            >
              <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
              刷新
            </Button>
            <Button
              variant="outline"
              className="h-9 rounded-lg border-rose-200 bg-white px-3 text-xs text-rose-600 hover:bg-rose-50"
              onClick={() => void handleCancelSelected()}
              disabled={isCancelling || selected.size === 0}
            >
              <SquareX className="size-3.5" />
              取消选中（{selected.size}）
            </Button>
            <Button
              className="h-9 rounded-lg bg-rose-600 px-3 text-xs text-white hover:bg-rose-700"
              onClick={() => setConfirmAll(true)}
              disabled={isCancelling || activeItems.length === 0}
            >
              <ListX className="size-3.5" />
              一键取消全部排队任务
            </Button>
          </div>

          {activeItems.length > 0 ? (
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <label className="flex items-center gap-1.5">
                <Checkbox
                  checked={activeItems.length > 0 && activeItems.every((item) => selected.has(item.id))}
                  onCheckedChange={() => toggleAllActive()}
                />
                全选活跃任务
              </label>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-stone-100">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-xs text-stone-400">
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">模型</th>
                  <th className="px-3 py-2">创建时间</th>
                  <th className="px-3 py-2">任务 ID</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-stone-50 last:border-0 ${ACTIVE_STATUSES.has(item.status) ? "bg-amber-50/40" : ""}`}
                  >
                    <td className="px-3 py-2">
                      {ACTIVE_STATUSES.has(item.status) ? (
                        <Checkbox
                          checked={selected.has(item.id)}
                          onCheckedChange={() => toggleSelect(item.id)}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          item.status === "queued"
                            ? "bg-amber-100 text-amber-700"
                            : item.status === "running"
                              ? "bg-blue-100 text-blue-700"
                              : item.status === "cancelled"
                                ? "bg-stone-100 text-stone-500"
                                : item.status === "error"
                                  ? "bg-rose-100 text-rose-600"
                                  : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 font-mono text-xs text-stone-500">{item.owner_id || "—"}</td>
                    <td className="px-3 py-2">{item.mode === "edit" ? "图生图" : "文生图"}</td>
                    <td className="px-3 py-2">{item.model || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-stone-500">{formatTime(item.created_at)}</td>
                    <td className="max-w-[160px] truncate px-3 py-2 font-mono text-[11px] text-stone-400">{item.id}</td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-stone-400">
                      {isLoading ? "加载中..." : "暂无任务记录"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>确认一键取消所有排队/生成中任务？</DialogTitle>
            <DialogDescription>
              将取消全部 {activeItems.length} 个活跃任务（所有用户），对应生成结果不会保存，用户侧显示「该任务已被管理员取消，请稍后重试！」。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setConfirmAll(false)} disabled={isCancelling}>
              取消
            </Button>
            <Button className="rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleCancelAll()} disabled={isCancelling}>
              {isCancelling ? <LoaderCircle className="size-4 animate-spin" /> : null}
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
