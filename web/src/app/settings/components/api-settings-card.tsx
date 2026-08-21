"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, LoaderCircle, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { fetchApiAdminSettings, putApiAdminSettings } from "@/lib/api";

export function ApiSettingsCard() {
  const didLoadRef = useRef(false);
  const [enabled, setEnabled] = useState(true);
  const [commonModels, setCommonModels] = useState<string[]>([]);
  const [modelsText, setModelsText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingToggle, setIsSavingToggle] = useState(false);
  const [isSavingModels, setIsSavingModels] = useState(false);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void (async () => {
      try {
        const data = await fetchApiAdminSettings();
        setEnabled(data.enabled);
        setCommonModels(data.common_models || []);
        setModelsText((data.common_models || []).join("\n"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载 API 设置失败");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleToggle = async () => {
    setIsSavingToggle(true);
    try {
      const data = await putApiAdminSettings({ enabled: !enabled });
      setEnabled(data.enabled);
      toast.success(data.enabled ? "对外 API 服务已开启" : "对外 API 服务已关闭（API Key 调用将返回 403）");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSavingToggle(false);
    }
  };

  const handleSaveModels = async () => {
    const models = modelsText
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setIsSavingModels(true);
    try {
      const data = await putApiAdminSettings({ common_models: models });
      setCommonModels(data.common_models);
      setModelsText(data.common_models.join("\n"));
      toast.success("常用模型已保存，接口文档将同步更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSavingModels(false);
    }
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
            disabled={isLoading || isSavingToggle}
          >
            {isSavingToggle ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {enabled ? "关闭 API" : "开启 API"}
          </Button>
        </div>

        <div className="border-t border-stone-100 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-stone-800">常用模型（接口文档展示）</div>
              <p className="mt-0.5 text-xs text-stone-400">
                用户中心「接口接入说明」中展示的常用模型，每行一个；留空使用默认列表。
              </p>
            </div>
            <Button
              className="h-9 shrink-0 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
              onClick={() => void handleSaveModels()}
              disabled={isSavingModels}
            >
              {isSavingModels ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </Button>
          </div>
          <Textarea
            value={modelsText}
            onChange={(event) => setModelsText(event.target.value)}
            placeholder={"gpt-image-2\ngpt-image-2-vip\ngpt-5-mini"}
            rows={5}
            className="mt-2 w-full rounded-xl border-stone-200 bg-white font-mono text-xs leading-5"
          />
        </div>
      </CardContent>
    </Card>
  );
}
