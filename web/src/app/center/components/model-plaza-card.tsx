"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Search, Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchModels, type Model } from "@/lib/api";

type PlazaItem = Model & { metadata: NonNullable<Model["metadata"]> };

const TIER_ORDER = ["1k", "2k", "4k"];

function isImageModel(id: string) {
  return id.toLowerCase().includes("image");
}

export function ModelPlazaCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<PlazaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void (async () => {
      try {
        const data = await fetchModels();
        const seen = new Set<string>();
        const list: PlazaItem[] = [];
        for (const raw of Array.isArray(data.data) ? data.data : []) {
          const id = String(raw?.id || "").trim();
          if (!id || seen.has(id)) {
            continue;
          }
          seen.add(id);
          list.push({ ...raw, metadata: raw.metadata || {} });
        }
        setItems(list);
      } catch {
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((item) => item.id.toLowerCase().includes(q)) : items;
    return [...list].sort((a, b) => {
      const aImage = isImageModel(a.id) ? 0 : 1;
      const bImage = isImageModel(b.id) ? 0 : 1;
      if (aImage !== bImage) {
        return aImage - bImage;
      }
      return a.id.localeCompare(b.id);
    });
  }, [items, query]);

  const imageCount = useMemo(() => filtered.filter((item) => isImageModel(item.id)).length, [filtered]);
  const chatCount = filtered.length - imageCount;

  const renderRate = (item: PlazaItem) => {
    if (isImageModel(item.id)) {
      const prices = item.metadata.prices || {};
      const tiers = [...(item.metadata.image_tiers || Object.keys(prices))].sort(
        (a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b),
      );
      if (tiers.length === 0) {
        return <span className="font-mono text-sm">×{item.metadata.rate ?? 1}</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {tiers.map((tier) => (
            <Badge key={tier} variant="secondary" className="bg-stone-100 font-mono text-xs text-stone-600">
              {tier}×{prices[tier] ?? item.metadata.rate ?? 1}
            </Badge>
          ))}
        </div>
      );
    }
    return <span className="font-mono text-sm">×{item.metadata.rate ?? 1}</span>;
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="size-5 text-stone-600" />
          模型广场
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <span>画图模型 {imageCount} 个</span>
          <span>· 对话模型 {chatCount} 个</span>
          <span>· 计费倍率 = 生成 1 次消耗的额度数（画图按分辨率档位计费）</span>
        </div>
        <div className="relative max-w-sm">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模型名称..."
            className="h-9 rounded-xl border-stone-200 bg-white pl-9"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-10">
            <LoaderCircle className="size-5 animate-spin text-stone-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-stone-400">
            {items.length === 0 ? "暂无模型数据，请稍后刷新" : "无匹配模型"}
          </div>
        ) : (
          <div className="max-h-[460px] overflow-auto rounded-xl border border-stone-200">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                  <th className="px-4 py-3 font-medium">模型名称</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">来源</th>
                  <th className="px-4 py-3 font-medium">计费倍率</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-800">{item.id}</td>
                    <td className="px-4 py-2.5">
                      {isImageModel(item.id) ? (
                        <Badge className="bg-sky-100 text-sky-700">画图</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-stone-100 text-stone-600">对话</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.metadata.source === "third_party" ? (
                        <Badge variant="secondary" className="bg-violet-100 text-violet-700">第三方</Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-stone-100 text-stone-500">账号池</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{renderRate(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-stone-400">
          画图模型倍率按分辨率档位（1k/2k/4k）分别计费；对话模型按每次请求消耗倍率计费。
        </p>
      </CardContent>
    </Card>
  );
}
