"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, PlugZap, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  deleteThirdPartyApi,
  fetchThirdPartyApis,
  fetchThirdPartyModels,
  testThirdPartyApi,
  upsertThirdPartyApi,
  type ThirdPartyApi,
} from "@/lib/api";

const IMAGE_TIER_OPTIONS = ["1k", "2k", "4k"] as const;
type ImageTier = (typeof IMAGE_TIER_OPTIONS)[number];

function isImageModel(model: string) {
  return model.toLowerCase().includes("image");
}

function summarizeTiers(item: ThirdPartyApi): string[] {
  const tiers = item.image_tiers || {};
  const supported = new Set<string>();
  for (const list of Object.values(tiers)) {
    for (const tier of list || []) {
      supported.add(tier);
    }
  }
  return IMAGE_TIER_OPTIONS.filter((tier) => supported.has(tier));
}

function summarizePrices(item: ThirdPartyApi): string[] {
  const prices = item.image_prices || {};
  const lines: string[] = [];
  for (const [model, tiers] of Object.entries(prices)) {
    const parts = IMAGE_TIER_OPTIONS.filter((tier) => tiers?.[tier] !== undefined).map(
      (tier) => `${tier}×${tiers?.[tier]}`,
    );
    if (parts.length > 0) {
      lines.push(`${model}：${parts.join(" ")}`);
    }
  }
  return lines;
}

export function ThirdPartyApiCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<ThirdPartyApi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ThirdPartyApi | null>(null);
  const [formName, setFormName] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formProxy, setFormProxy] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formDefault, setFormDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set());
  const [formImageTiers, setFormImageTiers] = useState<Record<string, Set<string>>>({});
  const [formImagePrices, setFormImagePrices] = useState<Record<string, Partial<Record<ImageTier, string>>>>({});
  const [modelQuery, setModelQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchThirdPartyApis();
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载第三方 API 失败");
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

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormBaseUrl("");
    setFormProxy("");
    setFormApiKey("");
    setFormEnabled(true);
    setFormDefault(false);
    setAvailableModels([]);
    setSelectedModels(new Set());
    setFormImageTiers({});
    setFormImagePrices({});
    setModelQuery("");
    setIsDialogOpen(true);
  };

  const openEdit = (item: ThirdPartyApi) => {
    setEditing(item);
    setFormName(item.name);
    setFormBaseUrl(item.base_url);
    setFormProxy(item.proxy || "");
    setFormApiKey("");
    setFormEnabled(item.enabled);
    setFormDefault(item.default);
    setAvailableModels((item.models || []).slice());
    setSelectedModels(new Set(item.models || []));
    const tiers: Record<string, Set<string>> = {};
    const prices: Record<string, Partial<Record<ImageTier, string>>> = {};
    for (const model of item.models || []) {
      const configured = item.image_tiers?.[model];
      tiers[model] = new Set(configured && configured.length > 0 ? configured : ["1k"]);
      const configuredPrices = item.image_prices?.[model];
      if (configuredPrices) {
        const entry: Partial<Record<ImageTier, string>> = {};
        for (const tier of IMAGE_TIER_OPTIONS) {
          if (configuredPrices[tier] !== undefined) {
            entry[tier] = String(configuredPrices[tier]);
          }
        }
        prices[model] = entry;
      }
    }
    setFormImageTiers(tiers);
    setFormImagePrices(prices);
    setModelQuery("");
    setIsDialogOpen(true);
  };

  const handleFetchModels = async () => {
    const baseUrl = formBaseUrl.trim();
    if (!baseUrl) {
      toast.error("请先填写 API 地址");
      return;
    }
    if (!formApiKey.trim() && !editing) {
      toast.error("请先填写 API Key");
      return;
    }
    setIsFetchingModels(true);
    try {
      const data = await fetchThirdPartyModels({
        id: editing?.id,
        name: formName.trim() || "fetch",
        base_url: baseUrl,
        proxy: formProxy.trim(),
        ...(formApiKey.trim() ? { api_key: formApiKey.trim() } : {}),
      });
      const result = data.result;
      if (!result.ok) {
        toast.error(`获取模型失败：${result.error ?? "未知错误"}`);
        return;
      }
      const models = result.models || [];
      setAvailableModels(models);
      // 保留已勾选且在列表中的模型，其余自动勾选全部（新获取时默认全选便于使用）
      if (editing) {
        setSelectedModels((current) => {
          const next = new Set<string>();
          for (const model of models) {
            if (current.has(model)) {
              next.add(model);
            }
          }
          return next;
        });
      } else {
        setSelectedModels(new Set(models));
      }
      // 新模型默认只支持 1k 档位，管理员可按需勾选 2k/4k
      setFormImageTiers((current) => {
        const next = { ...current };
        for (const model of models) {
          if (!next[model]) {
            next[model] = new Set(["1k"]);
          }
        }
        return next;
      });
      toast.success(`获取到 ${models.length} 个模型，请勾选需要使用的模型`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "获取模型失败");
    } finally {
      setIsFetchingModels(false);
    }
  };

  const toggleModel = (model: string, checked: boolean) => {
    setSelectedModels((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(model);
      } else {
        next.delete(model);
      }
      return next;
    });
    if (checked) {
      setFormImageTiers((current) => {
        if (current[model]) {
          return current;
        }
        return { ...current, [model]: new Set(["1k"]) };
      });
    }
  };

  const toggleTier = (model: string, tier: ImageTier, checked: boolean) => {
    setFormImageTiers((current) => {
      const next = new Set(current[model] || ["1k"]);
      if (checked) {
        next.add(tier);
      } else if (tier !== "1k") {
        next.delete(tier);
      }
      return { ...current, [model]: next };
    });
  };

  const setModelPrice = (model: string, tier: ImageTier, value: string) => {
    setFormImagePrices((current) => ({
      ...current,
      [model]: { ...(current[model] || {}), [tier]: value },
    }));
  };

  const toggleAllModels = (checked: boolean) => {
    setSelectedModels((current) => {
      const next = new Set(current);
      if (checked) {
        for (const model of filteredModels) {
          next.add(model);
        }
      } else {
        for (const model of filteredModels) {
          next.delete(model);
        }
      }
      return next;
    });
  };

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) {
      return availableModels;
    }
    return availableModels.filter((model) => model.toLowerCase().includes(query));
  }, [availableModels, modelQuery]);

  const allFilteredSelected = filteredModels.length > 0 && filteredModels.every((model) => selectedModels.has(model));

  const handleSave = async () => {
    const name = formName.trim();
    const baseUrl = formBaseUrl.trim();
    if (!name) {
      toast.error("请填写名称");
      return;
    }
    if (!baseUrl) {
      toast.error("请填写 API 地址");
      return;
    }
    setIsSaving(true);
    try {
      const imageTiers: Record<string, string[]> = {};
      for (const model of selectedModels) {
        const tiers = formImageTiers[model];
        if (tiers && tiers.size > 0) {
          imageTiers[model] = IMAGE_TIER_OPTIONS.filter((tier) => tiers.has(tier));
        }
      }
      const imagePrices: Record<string, Record<string, number>> = {};
      for (const model of selectedModels) {
        const prices = formImagePrices[model];
        if (!prices) {
          continue;
        }
        const cleaned: Record<string, number> = {};
        for (const tier of IMAGE_TIER_OPTIONS) {
          const raw = prices[tier];
          if (raw === undefined || raw === "") {
            continue;
          }
          const n = Math.floor(Number(raw));
          if (Number.isFinite(n) && n >= 1) {
            cleaned[tier] = n;
          }
        }
        if (Object.keys(cleaned).length > 0) {
          imagePrices[model] = cleaned;
        }
      }
      await upsertThirdPartyApi({
        ...(editing ? { id: editing.id } : {}),
        name,
        base_url: baseUrl,
        proxy: formProxy.trim(),
        ...(formApiKey.trim() ? { api_key: formApiKey.trim() } : {}),
        models: [...selectedModels].sort(),
        image_tiers: imageTiers,
        image_prices: imagePrices,
        enabled: formEnabled,
        default: formDefault,
      });
      setIsDialogOpen(false);
      await load();
      toast.success(editing ? "第三方 API 已更新" : "第三方 API 已添加");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    const baseUrl = formBaseUrl.trim();
    if (!baseUrl) {
      toast.error("请先填写 API 地址");
      return;
    }
    setIsTesting(true);
    try {
      const data = await testThirdPartyApi({
        id: editing?.id,
        name: formName.trim() || "test",
        base_url: baseUrl,
        proxy: formProxy.trim(),
        ...(formApiKey.trim() ? { api_key: formApiKey.trim() } : {}),
      });
      if (data.result.ok) {
        toast.success(`连接成功（HTTP ${data.result.status}）`);
      } else {
        toast.error(`连接失败：${data.result.error ?? "未知错误"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试失败");
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async (item: ThirdPartyApi) => {
    setPendingIds((current) => new Set(current).add(item.id));
    try {
      const data = await deleteThirdPartyApi(item.id);
      setItems(data.items);
      toast.success("已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setPendingIds((current) => {
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
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <PlugZap className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">第三方 API 接入</h2>
                <p className="text-sm leading-6 text-stone-500">
                  接入自定义 OpenAI 兼容 API（自定义地址 + KEY）。填写 KEY 后自动获取模型列表，勾选需要转发的模型；未勾选的模型仍走账号池模式。
                </p>
              </div>
            </div>
            <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={openCreate}>
              <Plus className="size-4" />
              添加
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400">
              暂无第三方 API 配置。添加后即可把请求转发到自定义 OpenAI 兼容服务。
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-xl border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-stone-900">{item.name}</span>
                        {item.enabled ? (
                          <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-stone-100 text-stone-500">停用</Badge>
                        )}
                        {item.default ? (
                          <Badge className="bg-stone-950 text-white">默认</Badge>
                        ) : null}
                        {!item.has_api_key ? (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-700">未填 KEY</Badge>
                        ) : null}
                      </div>
                      <div className="break-all font-mono text-xs text-stone-500">{item.base_url}</div>
                      {item.proxy ? (
                        <div className="break-all font-mono text-xs text-stone-400">代理：{item.proxy}</div>
                      ) : null}
                      <div className="text-xs text-stone-500">
                        模型（{item.models.length}）：{item.models.length > 0 ? item.models.slice(0, 8).join("、") : "（未配置，仅默认兜底）"}
                        {item.models.length > 8 ? ` 等 ${item.models.length} 个` : ""}
                      </div>
                      {summarizeTiers(item).filter((tier) => tier !== "1k").length > 0 ? (
                        <div className="text-xs text-stone-500">
                          画图档位：1k / {summarizeTiers(item).filter((tier) => tier !== "1k").join(" / ")}
                        </div>
                      ) : null}
                      {summarizePrices(item).slice(0, 3).map((line) => (
                        <div key={line} className="text-xs text-stone-500">
                          定价：{line}
                        </div>
                      ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 rounded-lg px-2 text-xs text-stone-600"
                        onClick={() => openEdit(item)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 rounded-lg px-2 text-xs text-rose-600 hover:text-rose-700"
                        disabled={pendingIds.has(item.id)}
                        onClick={() => void handleDelete(item)}
                      >
                        {pendingIds.has(item.id) ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>{editing ? "编辑第三方 API" : "添加第三方 API"}</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              填写自定义 OpenAI 兼容服务的地址与密钥，点击「获取模型」自动拉取模型列表，勾选需要使用的模型；画图模型可配置画质档位（1k/2k/4k）与各档位倍率定价。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm text-stone-700">名称</label>
              <Input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="例如：我的中转服务" className="h-10 rounded-xl border-stone-200 bg-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-stone-700">API 地址（Base URL）</label>
              <Input value={formBaseUrl} onChange={(event) => setFormBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className="h-10 rounded-xl border-stone-200 bg-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-stone-700">代理地址（可选）</label>
              <Input value={formProxy} onChange={(event) => setFormProxy(event.target.value)} placeholder="http://127.0.0.1:7890 或 socks5://user:pass@host:1080，留空直连" className="h-10 rounded-xl border-stone-200 bg-white" />
              <p className="text-[11px] leading-5 text-stone-400">该 API 的所有请求（含获取模型/测试连接）都会走此代理，用于绕过上游对服务器 IP 的封锁。</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-stone-700">API Key</label>
              <div className="flex gap-2">
                <Input type="password" value={formApiKey} onChange={(event) => setFormApiKey(event.target.value)} placeholder={editing ? "留空保持不变" : "sk-..."} className="h-10 flex-1 rounded-xl border-stone-200 bg-white" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                  onClick={() => void handleFetchModels()}
                  disabled={isFetchingModels}
                >
                  {isFetchingModels ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
                  获取模型
                </Button>
              </div>
            </div>

            {availableModels.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-stone-700">
                    可用模型（{availableModels.length}）· 已选 {selectedModels.size}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 rounded-lg px-2 text-xs text-stone-600"
                    onClick={() => void toggleAllModels(!allFilteredSelected)}
                  >
                    {allFilteredSelected ? "取消全选" : "全选"}
                  </Button>
                </div>
                <Input
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="搜索模型..."
                  className="h-9 rounded-xl border-stone-200 bg-white"
                />
                <div className="max-h-56 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2">
                  {filteredModels.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-stone-400">无匹配模型</div>
                  ) : (
                    <div className="grid gap-0.5 sm:grid-cols-2">
                      {filteredModels.map((model) => {
                        const modelTiers = formImageTiers[model] || new Set(["1k"]);
                        return (
                          <div key={model} className="min-w-0 rounded-lg px-2 py-1.5 transition hover:bg-stone-100">
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
                              <Checkbox
                                checked={selectedModels.has(model)}
                                onCheckedChange={(checked) => toggleModel(model, Boolean(checked))}
                              />
                              <span className="truncate font-mono text-xs">{model}</span>
                            </label>
                            {isImageModel(model) ? (
                              <>
                                <div className="mt-1 flex flex-wrap items-center gap-1 pl-6">
                                  <span className="shrink-0 text-[10px] text-stone-400">画质</span>
                                  {IMAGE_TIER_OPTIONS.map((tier) => {
                                    const active = modelTiers.has(tier);
                                    const isBase = tier === "1k";
                                    return (
                                      <button
                                        key={tier}
                                        type="button"
                                        disabled={isBase}
                                        title={isBase ? "1k 为基础档位，始终支持" : `画图尺寸 ${tier} 档`}
                                        className={cn(
                                          "h-6 min-w-9 cursor-pointer rounded-full border px-2 text-[11px] font-medium transition",
                                          active
                                            ? "border-stone-950 bg-stone-950 text-white"
                                            : "border-stone-200 bg-white text-stone-500 hover:border-stone-400",
                                          isBase && "cursor-default opacity-90",
                                        )}
                                        onClick={() => toggleTier(model, tier, !active)}
                                      >
                                        {tier}
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1 pl-6">
                                  <span className="shrink-0 text-[10px] text-stone-400">倍率</span>
                                  {IMAGE_TIER_OPTIONS.map((tier) => (
                                    <input
                                      key={tier}
                                      type="number"
                                      min="1"
                                      value={formImagePrices[model]?.[tier] ?? ""}
                                      placeholder={tier}
                                      title={`${tier} 档倍率（不填则按该模型基础权重扣费）`}
                                      className="h-6 w-12 rounded-full border border-stone-200 bg-white px-1 text-center text-[11px] text-stone-700 outline-none transition focus:border-stone-400"
                                      onChange={(event) => setModelPrice(model, tier, event.target.value)}
                                    />
                                  ))}
                                </div>
                              </>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <p className="text-[11px] leading-5 text-stone-400">
                  画图模型（名称含 image）可在行内配置画质档位（1k 为基础档，勾选 2k/4k 后生图页才允许选择对应宽高比）与倍率：1k/2k/4k 分别填写每张消耗的额度倍率，不填则按该模型基础权重扣费。
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-xs text-stone-400">
                填写 API 地址和 Key 后点击「获取模型」，自动拉取可用模型列表进行勾选
              </div>
            )}

            <div className="flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <Checkbox checked={formEnabled} onCheckedChange={(checked) => setFormEnabled(Boolean(checked))} />
                启用
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <Checkbox checked={formDefault} onCheckedChange={(checked) => setFormDefault(Boolean(checked))} />
                设为默认（模型未配置/auto 时兜底）
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => void handleTest()} disabled={isTesting}>
              {isTesting ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
              测试连接
            </Button>
            <div className="flex-1" />
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => setIsDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" className="rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
