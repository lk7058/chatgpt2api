"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, Coins, LoaderCircle, Plus, Trash2, UserRound } from "lucide-react";
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
import {
  addUserQuota,
  createUser,
  deleteUser,
  fetchUsers,
  resetUserPassword,
  resetUserQuota,
  setUserEnabled,
  subtractUserQuota,
  type AuthUser,
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
  }).format(date);
}

function formatQuota(user: AuthUser) {
  if (user.quota_total < 0) {
    return "不限量";
  }
  return `${user.quota_left} / ${user.quota_total}`;
}

export function UserManagementCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<AuthUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [quotaUser, setQuotaUser] = useState<AuthUser | null>(null);
  const [quotaValue, setQuotaValue] = useState("");
  const [isSavingQuota, setIsSavingQuota] = useState(false);
  const [passwordUser, setPasswordUser] = useState<AuthUser | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [deletingUser, setDeletingUser] = useState<AuthUser | null>(null);

  const load = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const data = await fetchUsers();
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载用户列表失败");
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

  const setItemPending = (id: string, isPending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (isPending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    const email = createEmail.trim();
    if (!email || !email.includes("@") || !createPassword) {
      toast.error("请填写邮箱和密码");
      return;
    }
    setIsCreating(true);
    try {
      const data = await createUser(email, createPassword);
      setItems(data.items);
      setIsCreateOpen(false);
      setCreateEmail("");
      setCreatePassword("");
      toast.success("用户已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建用户失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (user: AuthUser) => {
    setItemPending(user.id, true);
    try {
      const data = await setUserEnabled(user.id, !user.enabled);
      setItems((current) => current.map((item) => (item.id === user.id ? data.item : item)));
      toast.success(user.enabled ? "用户已禁用" : "用户已启用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新用户状态失败");
    } finally {
      setItemPending(user.id, false);
    }
  };

  const [quotaAction, setQuotaAction] = useState<"add" | "subtract" | null>(null);

  const handleQuotaAction = async (action: "add" | "subtract") => {
    if (!quotaUser) {
      return;
    }
    const amount = Number(quotaValue);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("请输入大于 0 的整数");
      return;
    }
    setIsSavingQuota(true);
    try {
      const data = action === "add"
        ? await addUserQuota(quotaUser.id, Math.floor(amount))
        : await subtractUserQuota(quotaUser.id, Math.floor(amount));
      setItems((current) => current.map((item) => (item.id === quotaUser.id ? data.item : item)));
      setQuotaUser(null);
      setQuotaValue("");
      setQuotaAction(null);
      toast.success(action === "add" ? `已增加 ${Math.floor(amount)} 额度` : `已减少 ${Math.floor(amount)} 额度`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsSavingQuota(false);
    }
  };

  const handleResetQuota = async (user: AuthUser) => {
    setItemPending(user.id, true);
    try {
      const data = await resetUserQuota(user.id);
      setItems((current) => current.map((item) => (item.id === user.id ? data.item : item)));
      toast.success("额度已清零");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清零失败");
    } finally {
      setItemPending(user.id, false);
    }
  };

  const handleSavePassword = async () => {
    if (!passwordUser) {
      return;
    }
    if (!passwordValue || passwordValue.length < 4) {
      toast.error("密码至少 8 位");
      return;
    }
    setIsSavingPassword(true);
    try {
      const data = await resetUserPassword(passwordUser.id, passwordValue);
      setItems((current) => current.map((item) => (item.id === passwordUser.id ? data.item : item)));
      setPasswordUser(null);
      setPasswordValue("");
      toast.success("密码已重置");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重置密码失败");
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) {
      return;
    }
    const user = deletingUser;
    setItemPending(user.id, true);
    try {
      const data = await deleteUser(user.id);
      setItems(data.items);
      setDeletingUser(null);
      toast.success("用户已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除用户失败");
    } finally {
      setItemPending(user.id, false);
    }
  };

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <UserRound className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">用户管理</h2>
                <p className="text-sm text-stone-500">管理登录账号，为普通用户分配生成额度（-1 表示不限量）。</p>
              </div>
            </div>
            <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={() => setIsCreateOpen(true)}>
              <Plus className="size-4" />
              新建用户
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
                    <th className="px-4 py-3 font-medium">邮箱</th>
                    <th className="px-4 py-3 font-medium">角色</th>
                    <th className="px-4 py-3 font-medium">额度（剩余/总量）</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">创建时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-stone-900">{user.email || "—"}</td>
                      <td className="px-4 py-3">
                        {user.role === "admin" ? (
                          <Badge className="bg-stone-950 text-white">管理员</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-stone-100 text-stone-600">普通用户</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-700">{formatQuota(user)}</td>
                      <td className="px-4 py-3">
                        {user.enabled ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="size-3.5" /> 正常
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-600">
                            <Ban className="size-3.5" /> 禁用
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-500">{formatDateTime(user.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 text-xs text-emerald-700"
                            disabled={pendingIds.has(user.id)}
                            onClick={() => {
                              setQuotaUser(user);
                              setQuotaValue("");
                              setQuotaAction("add");
                            }}
                          >
                            <Coins className="size-3.5" /> 增加
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 text-xs text-rose-600"
                            disabled={pendingIds.has(user.id)}
                            onClick={() => {
                              setQuotaUser(user);
                              setQuotaValue("");
                              setQuotaAction("subtract");
                            }}
                          >
                            <Coins className="size-3.5" /> 减少
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 text-xs text-stone-500"
                            disabled={pendingIds.has(user.id) || user.quota_total <= 0}
                            onClick={() => void handleResetQuota(user)}
                          >
                            {pendingIds.has(user.id) ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                            清零
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 text-xs text-stone-600"
                            disabled={pendingIds.has(user.id)}
                            onClick={() => {
                              setPasswordUser(user);
                              setPasswordValue("");
                            }}
                          >
                            重置密码
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-8 rounded-lg px-2 text-xs"
                            disabled={pendingIds.has(user.id)}
                            onClick={() => void handleToggle(user)}
                          >
                            {pendingIds.has(user.id) ? <LoaderCircle className="size-3.5 animate-spin" /> : user.enabled ? "禁用" : "启用"}
                          </Button>
                          {user.role !== "admin" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 rounded-lg px-2 text-xs text-rose-600 hover:text-rose-700"
                              disabled={pendingIds.has(user.id)}
                              onClick={() => setDeletingUser(user)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                        暂无用户，点击右上角「新建用户」创建
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新建用户 */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              新用户默认额度为 0，创建后可在列表中使用「额度」分配生成额度。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
              placeholder="邮箱（如 user@example.com）"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <Input
              type="password"
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
              placeholder="密码（至少 8 位）"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button type="button" className="rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={() => void handleCreate()} disabled={isCreating}>
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : null}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 增加/减少额度 */}
      <Dialog open={quotaUser !== null} onOpenChange={(open) => { if (!open) { setQuotaUser(null); setQuotaAction(null); } }}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>{quotaAction === "add" ? "增加额度" : "减少额度"}</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              为用户 <span className="font-medium text-stone-900">{quotaUser?.email || quotaUser?.username}</span>
              {quotaAction === "add" ? " 增加额度（当前剩余 " : " 减少额度（当前剩余 "}
              {quotaUser ? (quotaUser.quota_total < 0 ? "不限" : String(quotaUser.quota_left)) : "—"}）
            </DialogDescription>
          </DialogHeader>
          <Input
            type="number"
            value={quotaValue}
            onChange={(event) => setQuotaValue(event.target.value)}
            placeholder="输入数量"
            className="h-10 rounded-xl border-stone-200 bg-white"
          />
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => { setQuotaUser(null); setQuotaAction(null); }}>
              取消
            </Button>
            <Button type="button" className="rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={() => void handleQuotaAction(quotaAction ?? "add")} disabled={isSavingQuota}>
              {isSavingQuota ? <LoaderCircle className="size-4 animate-spin" /> : null}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码 */}
      <Dialog open={passwordUser !== null} onOpenChange={(open) => { if (!open) setPasswordUser(null); }}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              为用户 <span className="font-medium text-stone-900">{passwordUser?.email || passwordUser?.username}</span> 设置新密码，重置后该用户所有登录会话将失效。
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            value={passwordValue}
            onChange={(event) => setPasswordValue(event.target.value)}
            placeholder="新密码（至少 8 位）"
            className="h-10 rounded-xl border-stone-200 bg-white"
          />
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => setPasswordUser(null)}>
              取消
            </Button>
            <Button type="button" className="rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={() => void handleSavePassword()} disabled={isSavingPassword}>
              {isSavingPassword ? <LoaderCircle className="size-4 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={deletingUser !== null} onOpenChange={(open) => { if (!open) setDeletingUser(null); }}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确定要删除用户 <span className="font-medium text-stone-900">{deletingUser?.email || deletingUser?.username}</span> 吗？该用户的生成记录将一并删除，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700" onClick={() => setDeletingUser(null)}>
              取消
            </Button>
            <Button type="button" className="rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleDelete()} disabled={deletingUser ? pendingIds.has(deletingUser.id) : false}>
              {deletingUser && pendingIds.has(deletingUser.id) ? <LoaderCircle className="size-4 animate-spin" /> : null}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
