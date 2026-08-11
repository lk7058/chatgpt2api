"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

type TurnstileWidgetProps = {
  siteKey: string;
  onToken: (token: string) => void;
  onExpire?: () => void;
};

const TURNSTILE_SCRIPT_ID = "turnstile-script";
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 15000;

function loadTurnstileScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.getElementById(TURNSTILE_SCRIPT_ID) || window.turnstile) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    let settled = false;
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.appendChild(script);
    // 超时兜底：脚本加载卡住时视为失败
    window.setTimeout(() => finish(Boolean(window.turnstile)), SCRIPT_TIMEOUT_MS);
  });
}

export function TurnstileWidget({ siteKey, onToken, onExpire }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setLoadFailed(false);
    setIsLoading(true);

    const render = async () => {
      const ok = await loadTurnstileScript();
      if (cancelled) {
        return;
      }
      if (!ok || !window.turnstile) {
        setLoadFailed(true);
        setIsLoading(false);
        return;
      }
      // 小延迟等 window.turnstile 就绪
      const retryRender = (attempt: number) => {
        if (!window.turnstile) {
          if (attempt < 5) {
            window.setTimeout(() => retryRender(attempt + 1), 300);
          } else {
            setLoadFailed(true);
            setIsLoading(false);
          }
          return;
        }
        if (cancelled || !containerRef.current) {
          return;
        }
        try {
          if (widgetIdRef.current) {
            window.turnstile.remove(widgetIdRef.current);
            widgetIdRef.current = undefined;
          }
          const widgetId = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: "light",
            callback: (token: string) => {
              onToken(token);
            },
            "expired-callback": () => {
              onExpire?.();
            },
            "error-callback": () => {
              onExpire?.();
            },
          });
          widgetIdRef.current = widgetId;
          setLoadFailed(false);
          setIsLoading(false);
        } catch {
          setLoadFailed(true);
          setIsLoading(false);
        }
      };
      retryRender(0);
    };

    void render();
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // 忽略清理错误
        }
        widgetIdRef.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, retryCount]);

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-5">
        <div className="flex items-center gap-2 text-sm text-rose-700">
          <ShieldAlert className="size-4" />
          人机验证组件加载失败
        </div>
        <p className="text-center text-xs leading-5 text-rose-600">
          无法连接 Cloudflare 验证服务（challenges.cloudflare.com），
          请检查网络或防火墙设置后重试。若持续失败，请联系管理员。
        </p>
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
          onClick={() => {
            // 移除旧脚本标记，强制重新加载
            document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
            const anyWindow = window as unknown as { turnstile?: unknown };
            delete anyWindow.turnstile;
            setRetryCount((current) => current + 1);
          }}
        >
          <RefreshCw className="size-3.5" />
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-h-[65px] w-full overflow-hidden rounded-xl">
      {isLoading ? (
        <div className="flex h-[65px] items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-50 text-xs text-stone-400">
          <LoaderCircle className="size-4 animate-spin" />
          正在加载人机验证...
        </div>
      ) : null}
      <div ref={containerRef} className={isLoading ? "invisible absolute inset-0" : ""} />
    </div>
  );
}
