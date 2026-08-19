"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, LoaderCircle, Plug, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createMcpKey, fetchMcpInfo, type McpInfo } from "@/lib/api";

const MCP_TOOLS = [
  { name: "generate_image", desc: "生图：按提示词生成图片，从账号额度扣费（与站内一致）" },
  { name: "get_quota", desc: "额度查询：返回当前剩余 / 已用 / 总额度" },
];

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

function buildClientConfig(mcpUrl: string, key: string) {
  return JSON.stringify(
    {
      mcpServers: {
        chatgpt2api: {
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${key}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function McpAccessCard() {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [fullKey, setFullKey] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const loadInfo = async () => {
    try {
      const data = await fetchMcpInfo();
      setInfo(data);
      if (typeof window !== "undefined") {
        setMcpUrl(`${window.location.origin}${data.endpoint || "/mcp"}`);
      }
    } catch {
      setInfo(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadInfo();
  }, []);

  const handleGenerate = async () => {
    if (!info?.mcp_enabled) {
      toast.error("你的 MCP 功能已被管理员关闭，无法生成 Key");
      return;
    }
    if (!info?.global_enabled) {
      toast.error("全站 MCP 服务已关闭，请联系管理员开启");
      return;
    }
    setIsGenerating(true);
    try {
      const data = await createMcpKey();
      setFullKey(data.key);
      setCopied(false);
      await loadInfo();
      toast.success(info?.has_key ? "MCP Key 已重新生成，旧 Key 立即失效" : "MCP Key 生成成功");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败，请稍后再试");
    } finally {
      setIsGenerating(false);
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

  if (isLoading) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-stone-500">
          <LoaderCircle className="size-4 animate-spin" />
          正在加载 MCP 信息…
        </CardContent>
      </Card>
    );
  }

  if (!info) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="p-6 text-sm text-stone-500">MCP 信息加载失败，请刷新重试。</CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="size-4 text-stone-600" />
          MCP 接入
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!info.global_enabled ? (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="size-4 shrink-0" />
            全站 MCP 服务当前已关闭，调用将无法使用，请联系管理员开启。
          </div>
        ) : null}
        {!info.mcp_enabled ? (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <AlertTriangle className="size-4 shrink-0" />
            你的 MCP 功能已被管理员关闭，无法使用与生成 Key。
          </div>
        ) : null}

        {/* Key 状态 */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-stone-500" />
            <span className="text-sm font-medium text-stone-700">MCP Key</span>
          </div>
          {info.has_key ? (
            <Badge className="bg-stone-950 text-white">{info.key_hint}</Badge>
          ) : (
            <Badge variant="outline" className="text-stone-500">
              未生成
            </Badge>
          )}
          <span className="text-xs text-stone-400">
            生成于 {formatDateTime(info.key_created_at)} · 已调用 {info.call_count} 次 · 最近 {formatDateTime(info.last_used_at)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
              onClick={() => void handleGenerate()}
              disabled={isGenerating || !info.mcp_enabled || !info.global_enabled}
            >
              {isGenerating ? <LoaderCircle className="size-4 animate-spin" /> : info.has_key ? <RefreshCw className="size-4" /> : <KeyRound className="size-4" />}
              {info.has_key ? "重新生成" : "生成 Key"}
            </Button>
          </div>
        </div>

        {/* 新 Key 展示（仅生成后展示一次） */}
        {fullKey ? (
          <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-emerald-800">新 MCP Key（仅此一次展示，请立即保存）</span>
              <Button className="h-8 rounded-lg bg-emerald-700 px-3 text-xs text-white hover:bg-emerald-600" onClick={() => void handleCopy(fullKey)}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <code className="block break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-xs leading-5 text-emerald-900">{fullKey}</code>
            <p className="text-xs text-emerald-700">重新生成后旧 Key 立即失效；该 Key 仅可用于 MCP 调用，不可用于站内 API。</p>
          </div>
        ) : null}

        {/* 接入地址 */}
        <div className="space-y-2 rounded-xl border border-stone-200 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <Server className="size-4 text-stone-500" />
            标准 MCP 接入地址
          </div>
          {mcpUrl ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700">{mcpUrl}</code>
              <Button className="h-8 shrink-0 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-600 hover:bg-stone-50" onClick={() => void handleCopy(mcpUrl)}>
                <Copy className="size-3.5" />
                复制
              </Button>
            </div>
          ) : null}
          <p className="text-xs leading-5 text-stone-400">在任意支持 MCP 的 Agent 客户端中配置该地址与你的 MCP Key（Bearer 认证）即可接入。</p>
        </div>

        {/* 客户端配置示例 */}
        {fullKey && mcpUrl ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-stone-700">客户端配置示例（mcpServers）</span>
              <Button className="h-8 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-600 hover:bg-stone-50" onClick={() => void handleCopy(buildClientConfig(mcpUrl, fullKey))}>
                <Copy className="size-3.5" />
                复制配置
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-xl bg-stone-950 p-4 font-mono text-xs leading-5 text-stone-200">{buildClientConfig(mcpUrl, fullKey)}</pre>
          </div>
        ) : null}

        {/* 可用工具 */}
        <div className="space-y-2">
          <span className="text-sm font-medium text-stone-700">可用工具</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {MCP_TOOLS.map((tool) => (
              <div key={tool.name} className="rounded-xl border border-stone-200 p-3">
                <div className="font-mono text-sm font-semibold text-stone-900">{tool.name}</div>
                <p className="mt-1 text-xs leading-5 text-stone-500">{tool.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
