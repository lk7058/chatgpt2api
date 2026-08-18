"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Rocket } from "lucide-react";
import { toast } from "sonner";

import { fetchAppVersion } from "@/lib/api";
import { cn } from "@/lib/utils";

const GITHUB_REPO = "lk7058/chatgpt2api";
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

/** 简单语义化版本比较：1.0.0 < 1.0.1 < 1.1.0；非法版本视为 0 */
function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    String(value || "")
      .replace(/^v/i, "")
      .split(".")
      .map((part) => {
        const num = Number.parseInt(part, 10);
        return Number.isNaN(num) ? 0 : num;
      });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** 顶栏版本徽标：显示当前版本，并静默检测 GitHub 最新发行版；有更新时高亮提示，点击跳转发行版页。仅管理员可见（由调用方控制）。 */
export function VersionCheck() {
  const [version, setVersion] = useState("");
  const [latest, setLatest] = useState("");
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await fetchAppVersion();
        if (active) {
          setVersion(data.version);
        }
      } catch {
        // 忽略：版本信息加载失败不阻塞导航栏
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!version) {
      return;
    }
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { tag_name?: string };
        const tag = String(data.tag_name || "").replace(/^v/i, "");
        if (!active || !tag) {
          return;
        }
        setLatest(tag);
        setHasUpdate(compareVersions(tag, version) > 0);
      } catch {
        // 忽略：GitHub 不可达时保持静默
      }
    };
    void check();
    return () => {
      active = false;
    };
  }, [version]);

  const handleClick = () => {
    if (hasUpdate) {
      toast.success(`发现新版本 v${latest}，正在打开发行版页面…`);
    } else {
      toast.success(`已是最新版本 v${version}`);
    }
    window.open(`${RELEASES_URL}/latest`, "_blank", "noopener,noreferrer");
  };

  if (!version) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={hasUpdate ? `发现新版本 v${latest}，点击查看发行版` : `当前版本 v${version}，点击查看发行版`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
        hasUpdate
          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/20"
          : "border-stone-200 bg-white/70 text-stone-500 hover:bg-stone-50 hover:text-stone-900 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white",
      )}
    >
      {hasUpdate ? <Rocket className="size-3.5" /> : <CheckCircle2 className="size-3.5 text-emerald-500" />}
      <span>v{version}</span>
      {hasUpdate ? <span className="font-semibold">· 新 {latest}</span> : null}
    </button>
  );
}
