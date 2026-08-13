"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchPublicAnnouncements } from "@/lib/api";

const ANNOUNCEMENT_READ_PREFIX = "chatgpt2api:announcement_read";

function readKeyFor(content: string) {
  return `${ANNOUNCEMENT_READ_PREFIX}:${content.length}:${content.slice(0, 64)}`;
}

export function AnnouncementPopup() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchPublicAnnouncements();
        if (cancelled || !data?.popup) {
          return;
        }
        // 已读记忆：内容变化后重新弹窗
        try {
          if (localStorage.getItem(readKeyFor(data.popup.content))) {
            return;
          }
        } catch {
          // localStorage 不可用时每次都弹
        }
        setTitle(data.popup.title);
        setContent(data.popup.content);
        setOpen(true);
      } catch {
        // 公告加载失败不打扰用户
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = () => {
    try {
      localStorage.setItem(readKeyFor(content), "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          handleClose();
        }
      }}
    >
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-4" />
            {title || "公告"}
          </DialogTitle>
          <DialogDescription className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-stone-600 dark:text-stone-300">
            {content}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={handleClose} className="rounded-xl">
            我知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
