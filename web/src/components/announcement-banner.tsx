"use client";

import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";

import { fetchPublicAnnouncements } from "@/lib/api";

const BANNER_DISMISS_KEY = "chatgpt2api:banner_dismiss";

type BannerData = { title: string; content: string; link: string };

export function AnnouncementBanner() {
  const [banner, setBanner] = useState<BannerData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchPublicAnnouncements();
        if (cancelled || !data?.banner) {
          return;
        }
        try {
          if (localStorage.getItem(BANNER_DISMISS_KEY)) {
            return;
          }
        } catch {
          // ignore
        }
        setBanner(data.banner);
      } catch {
        // 公告加载失败不打扰用户
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!banner) {
    return null;
  }

  const content = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Megaphone className="size-3.5 shrink-0" />
      {banner.title ? <span className="shrink-0 font-semibold">{banner.title}</span> : null}
      <span className="truncate">{banner.content}</span>
    </span>
  );

  return (
    <div className="relative flex items-center justify-center gap-3 rounded-xl border border-stone-200 bg-stone-100/80 py-2 pl-4 pr-10 text-xs text-stone-700 dark:border-white/10 dark:bg-stone-800/60 dark:text-stone-200">
      {banner.link ? (
        <a
          href={banner.link}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-2 hover:underline"
        >
          {content}
        </a>
      ) : (
        content
      )}
      <button
        type="button"
        aria-label="关闭公告"
        onClick={() => {
          try {
            localStorage.setItem(BANNER_DISMISS_KEY, "1");
          } catch {
            // ignore
          }
          setBanner(null);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-stone-400 transition hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
