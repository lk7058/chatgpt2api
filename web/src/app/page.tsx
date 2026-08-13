"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Images, LoaderCircle, Mail, Megaphone, ShieldCheck, UserRound } from "lucide-react";

import { ImageLightbox } from "@/components/image-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchGenerationRecords, fetchMe, fetchPublicAnnouncements, type GenerationRecord } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";

type HistoryImage = {
  url: string;
  conversationId: string;
  prompt: string;
  createdAt: string;
};

function extractHistoryImages(records: GenerationRecord[]): HistoryImage[] {
  const items: HistoryImage[] = [];
  for (const record of records) {
    if (record.kind !== "image" || !record.payload || typeof record.payload !== "object") {
      continue;
    }
    const payload = record.payload as { turns?: unknown };
    if (!Array.isArray(payload.turns)) {
      continue;
    }
    for (const turn of payload.turns) {
      if (!turn || typeof turn !== "object") {
        continue;
      }
      const t = turn as { resultsDeleted?: boolean; prompt?: unknown; createdAt?: unknown; images?: unknown };
      if (t.resultsDeleted || !Array.isArray(t.images)) {
        continue;
      }
      for (const image of t.images) {
        if (!image || typeof image !== "object") {
          continue;
        }
        const img = image as { status?: unknown; url?: unknown };
        if (img.status === "success" && typeof img.url === "string" && img.url) {
          items.push({
            url: img.url,
            conversationId: String(record.id),
            prompt: String(t.prompt || ""),
            createdAt: String(t.createdAt || record.created_at || ""),
          });
        }
      }
    }
  }
  return items;
}

function formatTime(value: string) {
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

function ClearedPlaceholder() {
  return (
    <div className="flex h-full min-h-[120px] w-full items-center justify-center bg-stone-100 px-2 text-center text-[11px] leading-4 text-stone-400">
      缓存已清理，不可恢复
    </div>
  );
}

function HomePageContent() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchMe>> | null>(null);
  const [announcement, setAnnouncement] = useState<Awaited<ReturnType<typeof fetchPublicAnnouncements>> | null>(null);
  const [history, setHistory] = useState<HistoryImage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchMe();
        setMe(data);
      } catch {
        // 个人信息加载失败不阻塞页面
      }
      try {
        const data = await fetchPublicAnnouncements();
        setAnnouncement(data);
      } catch {
        // 公告加载失败不阻塞页面
      }
      try {
        const data = await fetchGenerationRecords(500);
        setHistory(extractHistoryImages(data.items));
      } catch {
        // 历史图片加载失败不阻塞页面
      } finally {
        setIsLoadingHistory(false);
      }
    })();
  }, []);

  const displayName = me?.user?.username || me?.name || "用户";
  const email = me?.user?.email || "";
  const isAdmin = me?.role === "admin";
  const quotaTotal = Number(me?.quota_total ?? me?.user?.quota_total ?? 0);
  const quotaLeft = Number(me?.quota_left ?? me?.user?.quota_left ?? 0);
  const quotaUsed = Number(me?.quota_used ?? me?.user?.quota_used ?? 0);
  const quotaPercent = quotaTotal > 0 ? Math.max(0, Math.min(100, Math.round((quotaLeft / quotaTotal) * 100))) : 0;
  const unlimited = quotaTotal <= 0;

  const lightboxImages = useMemo(
    () => history.map((item, index) => ({ id: `${item.conversationId}-${index}`, src: item.url })),
    [history],
  );

  const popup = announcement?.popup;
  const banner = announcement?.banner;
  const hasAnnouncement = Boolean(popup || banner);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">欢迎回来，{displayName}</h1>
          <p className="mt-1 text-sm text-stone-500">在这里查看公告、额度和历史生成的图片</p>
        </div>
        {email ? (
          <div className="hidden items-center gap-2 rounded-full bg-stone-100 px-3 py-1.5 text-xs text-stone-500 sm:flex">
            <Mail className="size-3.5" />
            {email}
          </div>
        ) : null}
      </div>

      {hasAnnouncement ? (
        <Card className="overflow-hidden rounded-2xl border-amber-200/70 bg-amber-50/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="size-4 text-amber-600" />
              {popup?.title || banner?.title || "公告"}
            </CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm leading-6 text-stone-700">
            {popup?.content || banner?.content}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4" />
              个人信息
            </CardTitle>
            <CardDescription>账号信息与额度</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-stone-900 text-lg font-semibold text-white">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-stone-900">{displayName}</div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Badge variant={isAdmin ? "default" : "secondary"} className="rounded-md text-[10px]">
                    {isAdmin ? "管理员" : "普通用户"}
                  </Badge>
                  {isAdmin ? <ShieldCheck className="size-3.5 text-stone-500" /> : null}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-stone-500">剩余额度</span>
                <span className="font-medium text-stone-900">
                  {unlimited ? "不限" : `${quotaLeft}`}
                  {!unlimited && quotaTotal > 0 ? ` / ${quotaTotal}` : ""}
                </span>
              </div>
              {!unlimited && quotaTotal > 0 ? (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-stone-900 transition-all"
                      style={{ width: `${quotaPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-stone-400">已用 {quotaUsed} · 剩余 {quotaPercent}%</div>
                </>
              ) : (
                <div className="text-xs text-stone-400">
                  {quotaUsed > 0 ? `已用 ${quotaUsed}` : "当前不限额"}
                </div>
              )}
            </div>

            <Button
              variant="outline"
              className="w-full rounded-xl border-stone-200 bg-white text-stone-700"
              onClick={() => {
                window.location.href = "/center";
              }}
            >
              去签到 / 查看详情
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Images className="size-4" />
                历史生成图片
              </CardTitle>
              <CardDescription>最近生成的图片，点击可查看大图</CardDescription>
            </div>
            <Button
              variant="outline"
              className="rounded-xl border-stone-200 bg-white text-stone-600"
              onClick={() => {
                window.location.href = "/image";
              }}
            >
              去生成图片
            </Button>
          </CardHeader>
          <CardContent>
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-16 text-stone-400">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-stone-400">
                <ImageIcon className="size-8" />
                <span className="text-sm">还没有生成过图片，去生成第一张吧</span>
                <Button
                  className="mt-2 rounded-xl bg-stone-950 text-white hover:bg-stone-800"
                  onClick={() => {
                    window.location.href = "/image";
                  }}
                >
                  去生成图片
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
                {history.map((item, index) => (
                  <div
                    key={`${item.conversationId}-${index}`}
                    className="group aspect-square cursor-zoom-in overflow-hidden rounded-xl border border-stone-200/80 bg-stone-100"
                    onClick={() => {
                      setLightboxIndex(index);
                      setLightboxOpen(true);
                    }}
                  >
                    <img
                      src={item.url}
                      alt={item.prompt || `历史图片 ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition duration-200 group-hover:brightness-90"
                      onError={(event) => {
                        // 图片缓存被清理后显示占位
                        const target = event.currentTarget;
                        target.style.display = "none";
                        target.parentElement?.querySelector(".cleared-placeholder")?.removeAttribute("hidden");
                      }}
                    />
                    <div hidden className="cleared-placeholder h-full w-full">
                      <ClearedPlaceholder />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {history.length > 0 ? (
              <div className="mt-3 text-right text-xs text-stone-400">共 {history.length} 张</div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
    </div>
  );
}

export default function HomePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!session) {
    // 未登录跳转登录页
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <HomePageContent />;
}
