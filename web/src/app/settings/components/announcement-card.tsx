"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Megaphone, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchAdminAnnouncements, saveAdminAnnouncements } from "@/lib/api";

type FormState = {
  popup: { title: string; content: string; enabled: boolean };
  banner: { title: string; content: string; link: string; enabled: boolean };
};

const EMPTY_FORM: FormState = {
  popup: { title: "", content: "", enabled: false },
  banner: { title: "", content: "", link: "", enabled: false },
};

export function AnnouncementCard() {
  const didLoadRef = useRef(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void (async () => {
      try {
        const data = await fetchAdminAnnouncements();
        setForm({
          popup: {
            title: data.popup?.title || "",
            content: data.popup?.content || "",
            enabled: Boolean(data.popup?.enabled),
          },
          banner: {
            title: data.banner?.title || "",
            content: data.banner?.content || "",
            link: data.banner?.link || "",
            enabled: Boolean(data.banner?.enabled),
          },
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载公告配置失败");
      }
    })();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveAdminAnnouncements({
        popup: form.popup,
        banner: form.banner,
      });
      toast.success("已发布公告与广告");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="size-4" />
          公告与广告
        </CardTitle>
        <CardDescription>
          弹窗公告会在用户打开站点时弹出一次（同一内容只弹一次）；广告栏显示在页面顶部，用户可手动关闭。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">弹窗公告</Label>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <Checkbox
                checked={form.popup.enabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, popup: { ...prev.popup, enabled: Boolean(checked) } }))
                }
              />
              启用
            </label>
          </div>
          <div className="grid gap-3">
            <div>
              <Label className="text-xs text-stone-500">公告标题</Label>
              <Input
                value={form.popup.title}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, popup: { ...prev.popup, title: event.target.value } }))
                }
                className="mt-1 rounded-xl"
                placeholder="例如：系统升级通知"
              />
            </div>
            <div>
              <Label className="text-xs text-stone-500">公告内容</Label>
              <Textarea
                value={form.popup.content}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, popup: { ...prev.popup, content: event.target.value } }))
                }
                className="mt-1 min-h-[96px] rounded-xl"
                placeholder="输入公告正文，支持换行"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">广告显示栏</Label>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              <Checkbox
                checked={form.banner.enabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, banner: { ...prev.banner, enabled: Boolean(checked) } }))
                }
              />
              启用
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-stone-500">广告标题（可选）</Label>
              <Input
                value={form.banner.title}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, banner: { ...prev.banner, title: event.target.value } }))
                }
                className="mt-1 rounded-xl"
                placeholder="例如：限时活动"
              />
            </div>
            <div>
              <Label className="text-xs text-stone-500">广告文案</Label>
              <Input
                value={form.banner.content}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, banner: { ...prev.banner, content: event.target.value } }))
                }
                className="mt-1 rounded-xl"
                placeholder="广告显示内容"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs text-stone-500">点击跳转链接（可选）</Label>
              <Input
                value={form.banner.link}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, banner: { ...prev.banner, link: event.target.value } }))
                }
                className="mt-1 rounded-xl"
                placeholder="https://..."
              />
            </div>
          </div>
        </div>

        <Button onClick={() => void handleSave()} disabled={isSaving} className="rounded-xl bg-stone-950 text-white hover:bg-stone-800">
          {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          发布
        </Button>
      </CardContent>
    </Card>
  );
}
