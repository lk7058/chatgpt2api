"use client";

import { useEffect, useState } from "react";
import { Eraser, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteManagedImages, fetchImageStorage } from "@/lib/api";

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ImageCleanupCard() {
  const [mode, setMode] = useState<"days" | "range">("days");
  const [days, setDays] = useState("7");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isCleaning, setIsCleaning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stats, setStats] = useState<{ image_count: number; image_size_mb: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchImageStorage();
        setStats({ image_count: data.image_count, image_size_mb: data.image_size_mb });
      } catch {
        // 统计加载失败不阻塞
      }
    })();
  }, []);

  const computeRange = () => {
    if (mode === "days") {
      const daysNum = Math.max(0, Math.floor(Number(days) || 0));
      if (daysNum <= 0) {
        toast.error("请填写要清理的天数（大于 0）");
        return null;
      }
      const end = new Date();
      const start = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
      return { start_date: formatDate(start), end_date: formatDate(end) };
    }
    if (!startDate || !endDate) {
      toast.error("请选择开始与结束日期");
      return null;
    }
    if (startDate > endDate) {
      toast.error("开始日期不能晚于结束日期");
      return null;
    }
    return { start_date: startDate, end_date: endDate };
  };

  const handleClean = async () => {
    const range = computeRange();
    if (!range) {
      return;
    }
    setIsCleaning(true);
    try {
      const result = await deleteManagedImages({ all_matching: true, ...range });
      toast.success(`已清理 ${result.removed} 张图片缓存（${range.start_date} ~ ${range.end_date}）`);
      setConfirmOpen(false);
      const data = await fetchImageStorage();
      setStats({ image_count: data.image_count, image_size_mb: data.image_size_mb });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清理失败");
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <>
      <Card className="overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eraser className="size-4" />
            图片缓存清理
          </CardTitle>
          <CardDescription>
            按时间范围删除服务器上的图片缓存。清理后对应图片不可恢复，前端历史记录中的图片将显示「缓存已清理」。
            {stats ? ` 当前缓存：${stats.image_count} 张 / ${stats.image_size_mb} MB` : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === "days"}
                onChange={() => setMode("days")}
                className="size-4 accent-stone-900"
              />
              清理多久之前
            </Label>
            <Label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === "range"}
                onChange={() => setMode("range")}
                className="size-4 accent-stone-900"
              />
              指定时间段
            </Label>
          </div>

          {mode === "days" ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                className="w-28 rounded-xl"
                placeholder="7"
              />
              <span className="text-sm text-stone-500">天以前（含今天）的图片缓存</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-auto rounded-xl"
              />
              <span className="text-sm text-stone-500">至</span>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-auto rounded-xl"
              />
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-amber-600">
            <TriangleAlert className="size-4" />
            清理操作不可撤销，请谨慎确认。参考图与生成结果图会一并删除。
          </div>

          <Button
            variant="outline"
            className="rounded-xl border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
            onClick={() => setConfirmOpen(true)}
            disabled={isCleaning}
          >
            {isCleaning ? <LoaderCircle className="size-4 animate-spin" /> : <Eraser className="size-4" />}
            清理图片缓存
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>确认清理图片缓存？</DialogTitle>
            <DialogDescription>
              将删除{mode === "days" ? ` ${days || 0} 天以前` : ` ${startDate || "?"} 至 ${endDate || "?"}`}
              的图片缓存，删除后不可恢复，历史记录中的对应图片将显示「缓存已清理」。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setConfirmOpen(false)} disabled={isCleaning}>
              取消
            </Button>
            <Button className="rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleClean()} disabled={isCleaning}>
              {isCleaning ? <LoaderCircle className="size-4 animate-spin" /> : null}
              确认清理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
