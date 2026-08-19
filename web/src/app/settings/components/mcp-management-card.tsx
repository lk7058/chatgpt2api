"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, LoaderCircle, Power, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  adminResetMcpKey,
  adminSetMcpUserEnabled,
  fetchAdminMcpLogs,
  fetchAdminMcpSettings,
  fetchAdminMcpUsers,
  saveAdminMcpSettings,
  type AdminMcpUser,
  type McpLogItem,
} from "@/lib/api";

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
    second: "2-digit",
  }).format(date);
}

const TOOL_LABELS: Record<string, string> = {
  generate_image: "生图",
  get_quota: "额度查询",
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ok: { label: "成功", className: "bg-emerald-100 text-emerald-700" },
  error: { label: "失败", className: "bg-rose-100 text-rose-700" },
  pending: { label: "处理中", className: "bg-amber-100 text-amber-700" },
};

export function McpManagementCard() {
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [users, setUsers] = useState<AdminMcpUser[]>([]);
  const [logs, setLogs] = useState<McpLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [resetResult, setResetResult] = useState<{ username: string; key: string } | null>(null);
  const [logUserFilter, setLogUserFilter] = useState("");
  const [logToolFilter, setLogToolFilter] = useState("");
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const data = await fetchAdminMcpUsers();
      setUsers(data.items);
      setGlobalEnabled(data.global_enabled);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 MCP 用户列表失败");
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setIsLogsLoading(true);
    try {
      const data = await fetchAdminMcpLogs({
        user_id: logUserFilter || undefined,
        tool: logToolFilter || undefined,
        limit: 100,
      });
      setLogs(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载 MCP 调用日志失败");
    } finally {
      setIsLogsLoading(false);
    }
  }, [logUserFilter, logToolFilter]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const [usersData, settingsData] = await Promise.all([fetchAdminMcpUsers(), fetchAdminMcpSettings()]);
        if (!active) {
          return;
        }
        setUsers(usersData.items);
        setGlobalEnabled(settingsData.mcp.enabled);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载 MCP 配置失败");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      void loadLogs();
    }
  }, [isLoading, loadLogs]);

  const toggleGlobal = async () => {
    setIsSavingGlobal(true);
    try {
      const data = await saveAdminMcpSettings(!globalEnabled);
      setGlobalEnabled(data.mcp.enabled);
      toast.success(data.mcp.enabled ? "全站 MCP 服务已开启" : "全站 MCP 服务已关闭，所有用户调用立即失效");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const withPending = async (userId: string, action: () => Promise<void>) => {
    if (pendingIds.has(userId)) {
      return;
    }
    setPendingIds((prev) => new Set(prev).add(userId));
    try {
      await action();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleToggleUser = (user: AdminMcpUser) =>
    void withPending(user.user_id, async () => {
      try {
        await adminSetMcpUserEnabled(user.user_id, !user.mcp_enabled);
        toast.success(`已${user.mcp_enabled ? "关闭" : "开启"} ${user.username} 的 MCP 功能`);
        await loadUsers();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作失败");
      }
    });

  const handleResetKey = (user: AdminMcpUser) =>
    void withPending(user.user_id, async () => {
      try {
        const data = await adminResetMcpKey(user.user_id);
        setResetResult({ username: user.username, key: data.key });
        await loadUsers();
        toast.success(`已重置 ${user.username} 的 MCP Key，旧 Key 立即失效`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "重置失败");
      }
    });

  const handleCopyKey = async () => {
    if (!resetResult) {
      return;
    }
    try {
      await navigator.clipboard.writeText(resetResult.key);
      toast.success("新 Key 已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const logUserOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of logs) {
      if (item.user_id && !map.has(item.user_id)) {
        map.set(item.user_id, item.username);
      }
    }
    for (const user of users) {
      if (!map.has(user.user_id)) {
        map.set(user.user_id, user.username);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "zh-CN"));
  }, [logs, users]);

  if (isLoading) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-stone-500">
          <LoaderCircle className="size-4 animate-spin" />
          正在加载 MCP 配置…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 全局开关 */}
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4 text-stone-600" />
            全站 MCP 服务
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Badge className={globalEnabled ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}>
              {globalEnabled ? "已开启" : "已关闭"}
            </Badge>
            <span className="text-sm text-stone-500">关闭后所有用户的 MCP 调用立即失效（Key 与配置保留）</span>
          </div>
          <Button
            className={globalEnabled ? "h-9 rounded-xl border border-rose-200 bg-white px-4 text-rose-600 hover:bg-rose-50" : "h-9 rounded-xl bg-emerald-600 px-4 text-white hover:bg-emerald-500"}
            onClick={() => void toggleGlobal()}
            disabled={isSavingGlobal}
          >
            {isSavingGlobal ? <LoaderCircle className="size-4 animate-spin" /> : <Power className="size-4" />}
            {globalEnabled ? "关闭全站 MCP" : "开启全站 MCP"}
          </Button>
        </CardContent>
      </Card>

      {/* 逐用户管理 */}
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <KeyRound className="size-4 text-stone-600" />
              用户 MCP 管理
            </span>
            <Button className="h-8 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-600 hover:bg-stone-50" onClick={() => void loadUsers()}>
              <RefreshCw className="size-3.5" />
              刷新
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs text-stone-500">
                <th className="py-2 pr-3 font-medium">用户</th>
                <th className="py-2 pr-3 font-medium">MCP 状态</th>
                <th className="py-2 pr-3 font-medium">Key</th>
                <th className="py-2 pr-3 font-medium">调用次数</th>
                <th className="py-2 pr-3 font-medium">最近调用</th>
                <th className="py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-stone-400">
                    暂无用户
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.user_id} className="border-b border-stone-100">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-stone-800">{user.username}</div>
                      <div className="text-xs text-stone-400">{user.email || "—"}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {!globalEnabled ? (
                        <Badge className="bg-stone-100 text-stone-500">全站关闭</Badge>
                      ) : user.mcp_enabled ? (
                        <Badge className="bg-emerald-100 text-emerald-700">已启用</Badge>
                      ) : (
                        <Badge className="bg-rose-100 text-rose-700">已关闭</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {user.has_key ? (
                        <div>
                          <code className="font-mono text-xs text-stone-700">{user.key_hint}</code>
                          <div className="text-xs text-stone-400">生成于 {formatDateTime(user.key_created_at)}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-400">未生成</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-stone-600">{user.call_count}</td>
                    <td className="py-2.5 pr-3 text-xs text-stone-500">{formatDateTime(user.last_used_at)}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <Button
                          className={user.mcp_enabled ? "h-8 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-600 hover:bg-stone-50" : "h-8 rounded-lg bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-500"}
                          onClick={() => handleToggleUser(user)}
                          disabled={pendingIds.has(user.user_id) || !globalEnabled}
                        >
                          {pendingIds.has(user.user_id) ? <LoaderCircle className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                          {user.mcp_enabled ? "关闭" : "开启"}
                        </Button>
                        <Button
                          className="h-8 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-600 hover:bg-stone-50"
                          onClick={() => handleResetKey(user)}
                          disabled={pendingIds.has(user.user_id)}
                          title="重置后旧 Key 立即失效"
                        >
                          <KeyRound className="size-3.5" />
                          重置 Key
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 调用日志 */}
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <RefreshCw className="size-4 text-stone-600" />
              MCP 调用日志
            </span>
            <div className="flex items-center gap-2">
              <Select value={logUserFilter} onValueChange={setLogUserFilter}>
                <SelectTrigger className="h-8 w-40 rounded-lg border-stone-200 bg-white text-xs">
                  <SelectValue placeholder="全部用户" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全部用户</SelectItem>
                  {logUserOptions.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={logToolFilter} onValueChange={setLogToolFilter}>
                <SelectTrigger className="h-8 w-36 rounded-lg border-stone-200 bg-white text-xs">
                  <SelectValue placeholder="全部工具" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全部工具</SelectItem>
                  <SelectItem value="generate_image">生图</SelectItem>
                  <SelectItem value="get_quota">额度查询</SelectItem>
                </SelectContent>
              </Select>
              <Button className="h-8 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-600 hover:bg-stone-50" onClick={() => void loadLogs()} disabled={isLogsLoading}>
                {isLogsLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                查询
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {logs.length === 0 ? (
            <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-8 text-center text-sm text-stone-400">暂无 MCP 调用记录</div>
          ) : (
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs text-stone-500">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">用户</th>
                  <th className="py-2 pr-3 font-medium">工具</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">说明</th>
                  <th className="py-2 font-medium">额度</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((item) => {
                  const status = STATUS_LABELS[item.status] || STATUS_LABELS.ok;
                  return (
                    <tr key={item.id} className="border-b border-stone-100">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-stone-500">{formatDateTime(item.time)}</td>
                      <td className="py-2.5 pr-3 text-stone-700">{item.username || item.user_id}</td>
                      <td className="py-2.5 pr-3">
                        <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-700">{TOOL_LABELS[item.tool] || item.tool}</code>
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge className={status.className}>{status.label}</Badge>
                      </td>
                      <td className="max-w-[260px] truncate py-2.5 pr-3 text-xs text-stone-500">{item.message || "—"}</td>
                      <td className="py-2.5 text-stone-600">{item.quota_delta > 0 ? `-${item.quota_delta}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 重置 Key 结果弹窗（仅展示一次） */}
      <Dialog open={resetResult !== null} onOpenChange={(open) => (open ? null : setResetResult(null))}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>已重置 {resetResult?.username} 的 MCP Key</DialogTitle>
            <DialogDescription className="text-sm leading-6">旧 Key 已立即失效。新 Key 仅此一次展示，请复制并安全转交。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <code className="block break-all rounded-xl bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-200">{resetResult?.key}</code>
            <div className="flex justify-end gap-2">
              <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={() => void handleCopyKey()}>
                <Copy className="size-4" />
                复制新 Key
              </Button>
              <Button className="h-9 rounded-xl border border-stone-200 bg-white px-4 text-stone-700 hover:bg-stone-50" onClick={() => setResetResult(null)}>
                关闭
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
