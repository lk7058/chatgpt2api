"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchApiAdminSettings, putApiAdminSettings } from "@/lib/api";

export function ApiSettingsCard() {
  const didLoadRef = useRef(false);
  const [enabled, setEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void (async () => {
      try {
        const data = await fetchApiAdminSettings();
        setEnabled(data.enabled);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载 API 设置失败");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleToggle = async () => {
    setIsSaving(true);
    try {
      const data = await putApiAdminSettings(!enabled);
      setEnabled(data.enabled);
      toast.success(data.enabled ? "对外 API 服务已开启" : "对外 API 服务已关闭（API Key 调用将返回 403）");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100">
            <Globe className="size-5 text-stone-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight">对外 API 服务</span>
              {isLoading ? (
                <LoaderCircle className="size-4 animate-spin text-stone-400" />
              ) : enabled ? (
                <Badge className="bg-emerald-100 text-emerald-700">已开启</Badge>
              ) : (
                <Badge variant="secondary" className="bg-rose-100 text-rose-700">已关闭</Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              关闭后，所有 API Key（sk-...）发起的 /v1 调用立即返回 403；站内前端与管理员不受影响。用户级限制（开关/并发/每日次数）在「用户管理」中配置。
            </p>
          </div>
        </div>
        <Button
          className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
          onClick={() => void handleToggle()}
          disabled={isLoading || isSaving}
        >
          {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {enabled ? "关闭 API" : "开启 API"}
        </Button>
      </CardContent>
    </Card>
  );
}
