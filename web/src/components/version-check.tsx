"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, Mail, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAppVersion } from "@/lib/api";
import { cn } from "@/lib/utils";

const GITHUB_REPO = "lk7058/chatgpt2api";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

type GitHubRelease = {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  body: string | null;
};

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

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 顶栏版本徽标：显示当前版本，静默检测 GitHub 最新发行版；有新版时高亮。点击弹出发布页，展示版本记录 / 更新说明 / 是否有新版。仅管理员可见（由调用方控制）。 */
export function VersionCheck() {
  const [version, setVersion] = useState("");
  const [latestTag, setLatestTag] = useState("");
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [releases, setReleases] = useState<GitHubRelease[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

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

  // 静默检测最新发行版：有新版时徽标高亮
  useEffect(() => {
    if (!version) {
      return;
    }
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`${RELEASES_API}/latest`, {
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
        setLatestTag(tag);
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

  const loadReleases = async () => {
    if (releases || isLoading) {
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`${RELEASES_API}?per_page=10`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`GitHub 返回 ${response.status}`);
      }
      const data = (await response.json()) as GitHubRelease[];
      setReleases(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载版本记录失败，请稍后再试");
    } finally {
      setIsLoading(false);
    }
  };

  const openDialog = () => {
    setIsOpen(true);
    void loadReleases();
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title={hasUpdate ? `发现新版本 v${latestTag}，点击查看发布记录` : `当前版本 v${version}，点击查看发布记录`}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
          hasUpdate
            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/20"
            : "border-stone-200 bg-white/70 text-stone-500 hover:bg-stone-50 hover:text-stone-900 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white",
        )}
      >
        {hasUpdate ? <Rocket className="size-3.5" /> : <CheckCircle2 className="size-3.5 text-emerald-500" />}
        <span>v{version}</span>
        {hasUpdate ? <span className="font-semibold">· 新 {latestTag}</span> : null}
      </button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>版本信息</DialogTitle>
            <DialogDescription>查看当前版本与 GitHub 发行版记录。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 当前版本 + 是否有新版 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                当前版本
                <Badge className="bg-stone-950 text-white">v{version || "—"}</Badge>
              </span>
              {hasUpdate ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <Rocket className="size-4" />
                  发现新版本 v{latestTag}
                  <a
                    href={RELEASES_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-0.5 font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
                  >
                    前往发行版
                  </a>
                </span>
              ) : version ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <CheckCircle2 className="size-4" />
                  已是最新版本
                </span>
              ) : null}
            </div>

            {/* 版本记录与更新说明 */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-100">版本记录</h3>
              {isLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在加载版本记录…
                </div>
              ) : error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</div>
              ) : releases && releases.length > 0 ? (
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {releases.map((release) => (
                    <div key={release.tag_name} className="rounded-xl border border-stone-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={release.html_url || `${RELEASES_URL}/tag/${release.tag_name}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sm font-semibold text-stone-900 hover:underline dark:text-stone-100"
                        >
                          v{release.tag_name.replace(/^v/i, "")}
                        </a>
                        <span className="shrink-0 text-xs text-stone-400">{formatDate(release.published_at)}</span>
                      </div>
                      {release.body ? (
                        <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600 dark:bg-white/5 dark:text-stone-300">
                          {release.body}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-stone-400">（无更新说明）</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-500">暂无发布记录</div>
              )}
            </div>

            {/* 反馈邮箱 */}
            <div className="flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
              <Mail className="size-4" />
              反馈邮箱：
              <a
                href="mailto:l@w.cx"
                className="font-medium text-stone-700 underline underline-offset-2 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"
              >
                l@w.cx
              </a>
            </div>

            {/* 前往发行版页 */}
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-700 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"
            >
              <ExternalLink className="size-4" />
              前往 GitHub 发行版页
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
