"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, LoaderCircle, Save, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { fetchApiAdminSettings, fetchModels, putApiAdminSettings } from "@/lib/api";

export function ApiSettingsCard() {
  const didLoadRef = useRef(false);
  const [enabled, setEnabled] = useState(true);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [allModels, setAllModels] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState("");
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
        const [settings, modelsData] = await Promise.all([
          fetchApiAdminSettings(),
          fetchModels().catch(() => null),
        ]);
        setEnabled(settings.enabled);
        setAvailableModels(settings.available_models || []);
        setSelected(new Set(settings.available_models || []));
        const ids = (Array.isArray(modelsData?.data) ? modelsData.data : [])
          .map((item) => String(item?.id || "").trim())
          .filter(Boolean);
        // 已配置但不在模型列表中的项也保留（防止误删）
        setAllModels(Array.from(new Set([...ids, ...(settings.available_models || [])])).sort());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载 API 设置失败");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) {
      return allModels;
    }
    return allModels.filter((model) => model.toLowerCase().includes(q));
  }, [allModels, modelQuery]);

  const toggleModel = (model: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(model);
      } else {
        next.delete(model);
      }
      return next;
    });
  };

  const toggleAllFiltered = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const model of filteredModels) {
        if (checked) {
          next.add(model);
        } else {
          next.delete(model);
        }
      }
      return next;
    });
  };

  const allFilteredSelected = filteredModels.length > 0 && filteredModels.every((model) => selected.has(model));

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
    setIsSavingModels(true);
    try {
      const models = Array.from(selected).sort();
      const data = await putApiAdminSettings({ available_models: models });
      setAvailableModels(data.available_models);
      setSelected(new Set(data.available_models));
      toast.success("API 可用模型已保存，接口文档与 Key 绑定下拉将同步更新");
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-stone-800">API 可用模型</div>
              <p className="mt-0.5 text-xs text-stone-400">
                勾选对 API 接口开放的模型：用户生成 Key 时只能选择这些模型，接口接入说明同步展示。已选 {selected.size} 个。
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

          <div className="mt-3 rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center gap-2 border-b border-stone-100 p-2">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-stone-400" />
                <Input
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="搜索模型..."
                  className="h-8 rounded-lg border-stone-200 bg-white pl-8 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-8 rounded-lg px-2 text-xs text-stone-600"
                onClick={() => void toggleAllFiltered(!allFilteredSelected)}
              >
                {allFilteredSelected ? "取消全选" : "全选"}
              </Button>
            </div>
            <div className="grid max-h-52 gap-0.5 overflow-y-auto p-2 sm:grid-cols-2">
              {filteredModels.length === 0 ? (
                <div className="col-span-full px-2 py-6 text-center text-xs text-stone-400">无匹配模型</div>
              ) : (
                filteredModels.map((model) => (
                  <label key={model} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-stone-700 transition hover:bg-stone-100">
                    <Checkbox checked={selected.has(model)} onCheckedChange={(checked) => toggleModel(model, Boolean(checked))} />
                    <span className="truncate font-mono text-xs">{model}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
