"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HeaderActions } from "@/components/header-actions";
import {
  loginWithPassword,
  registerWithEmail,
  resetPasswordWithEmail,
  sendForgotPasswordCode,
  sendRegisterEmailCode,
  fetchPublicSettings,
  fetchSettingsConfig,
} from "@/lib/api";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { useRedirectIfAuthenticated } from "@/lib/use-auth-guard";
import { getDefaultRouteForRole, setStoredAuthSession } from "@/store/auth";

type LoginMode = "login" | "register" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("login");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const { isCheckingAuth } = useRedirectIfAuthenticated();

  // 探测注册开关、Turnstile 配置与邮箱域名白名单（一次 fetchPublicSettings，失败时回退旧接口）
  useEffect(() => {
    fetchPublicSettings()
      .then((data) => {
        setRegistrationEnabled(true);
        setTurnstileSiteKey(data.turnstile_site_key);
        setTurnstileEnabled(data.turnstile_enabled);
        setAllowedDomains(data.allowed_email_domains || []);
      })
      .catch(() => {
        // 失败时尝试旧接口
        fetchSettingsConfig()
          .then((data) => setRegistrationEnabled(Boolean(data.config?.registration_enabled)))
          .catch(() => {});
      });
  }, []);

  const handleLogin = async () => {
    const normalizedEmail = email.trim();
    const normalizedPassword = password;
    if (!normalizedEmail || !normalizedPassword) {
      toast.error("请输入邮箱和密码");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await loginWithPassword(normalizedEmail, normalizedPassword);
      await setStoredAuthSession({
        key: data.token,
        role: data.role,
        subjectId: data.subject_id,
        name: data.name,
        username: data.user?.username || data.name,
        userId: data.user?.id,
        quotaLeft: data.user?.quota_left,
        quotaTotal: data.user?.quota_total,
      });
      toast.success(`欢迎回来，${data.name}`);
      router.replace(getDefaultRouteForRole(data.role));
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileKey, setTurnstileKey] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setResendCountdown((current) => current - 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown > 0]);

  const handleSendCode = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      toast.error("请填写有效邮箱");
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      toast.error("请先完成人机验证");
      return;
    }
    setIsSendingCode(true);
    try {
      if (mode === "register") {
        await sendRegisterEmailCode(normalizedEmail, "", turnstileToken);
      } else {
        await sendForgotPasswordCode(normalizedEmail, "", turnstileToken);
      }
      setCodeSent(true);
      setResendCountdown(60);
      toast.success("验证码已发送到邮箱，请查收");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送验证码失败");
      // 刷新 Turnstile（token 已失效）
      setTurnstileToken("");
      setTurnstileKey((current) => current + 1);
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleRegister = async () => {
    const normalizedEmail = email.trim();
    const normalizedPassword = password;
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      toast.error("请填写有效邮箱");
      return;
    }
    if (!normalizedPassword || normalizedPassword.length < 4) {
      toast.error("密码至少 8 位");
      return;
    }
    if (normalizedPassword !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    if (!emailCode.trim()) {
      toast.error("请输入邮箱验证码");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await registerWithEmail(normalizedEmail, normalizedPassword, emailCode.trim());
      await setStoredAuthSession({
        key: data.token,
        role: data.role,
        subjectId: data.subject_id,
        name: data.name,
        username: data.user?.username || data.name,
        userId: data.user?.id,
        quotaLeft: data.user?.quota_left,
        quotaTotal: data.user?.quota_total,
      });
      toast.success("注册成功，已自动登录");
      router.replace(getDefaultRouteForRole(data.role));
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    const normalizedEmail = email.trim();
    const normalizedPassword = password;
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      toast.error("请填写有效邮箱");
      return;
    }
    if (!normalizedPassword || normalizedPassword.length < 4) {
      toast.error("新密码至少 8 位");
      return;
    }
    if (normalizedPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    if (!emailCode.trim()) {
      toast.error("请输入邮箱验证码");
      return;
    }

    setIsSubmitting(true);
    try {
      await resetPasswordWithEmail(normalizedEmail, emailCode.trim(), normalizedPassword);
      toast.success("密码已重置，请使用新密码登录");
      setMode("login");
      setPassword("");
      setConfirmPassword("");
      setEmailCode("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重置密码失败");
      // 刷新 Turnstile（token 已失效）
      setTurnstileToken("");
      setTurnstileKey((current) => current + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isForgot = mode === "forgot";

  const submitAction = () => {
    if (isLogin) {
      void handleLogin();
    } else if (isRegister) {
      void handleRegister();
    } else {
      void handleResetPassword();
    }
  };

  return (
    <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
      <HeaderActions className="fixed top-4 right-4 z-10" />
      <Card className="w-full max-w-[505px] rounded-[30px] border-white/80 bg-white/95 shadow-[0_28px_90px_rgba(28,25,23,0.10)]">
        <CardContent className="space-y-7 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm">
              {isLogin ? <LockKeyhole className="size-5" /> : isRegister ? <Mail className="size-5" /> : <KeyRound className="size-5" />}
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950">
                {isLogin ? "欢迎回来" : isRegister ? "注册账号" : "找回密码"}
              </h1>
              <p className="text-sm leading-6 text-stone-500">
                {isLogin
                  ? "使用邮箱登录后继续使用生成功能。"
                  : isRegister
                    ? "注册后即可使用生成功能，额度由管理员分配。"
                    : "通过绑定邮箱重置密码，验证码 10 分钟内有效。"}
              </p>
              {isRegister && allowedDomains.length > 0 ? (
                <p className="text-xs leading-5 text-amber-600">
                  仅支持以下邮箱域名注册：{allowedDomains.map((domain) => `@${domain}`).join("、")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="email" className="block text-sm font-medium text-stone-700">
              邮箱
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={isForgot ? "请输入绑定的邮箱" : "请输入邮箱"}
              className="h-13 rounded-2xl border-stone-200 bg-white px-4"
            />
          </div>

          {isLogin ? (
            <div className="space-y-3">
              <label htmlFor="password" className="block text-sm font-medium text-stone-700">
                密码
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitAction();
                  }
                }}
                placeholder="请输入密码"
                className="h-13 rounded-2xl border-stone-200 bg-white px-4"
              />
            </div>
          ) : null}

          {!isLogin ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-stone-700">
                  {isRegister ? "密码" : "新密码"}
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位"
                  className="h-13 rounded-2xl border-stone-200 bg-white px-4"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-password" className="block text-sm font-medium text-stone-700">
                  确认密码
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitAction();
                    }
                  }}
                  placeholder="请再次输入密码"
                  className="h-13 rounded-2xl border-stone-200 bg-white px-4"
                />
              </div>
              <label htmlFor="captcha" className="block text-sm font-medium text-stone-700">
                人机验证
              </label>
              {turnstileEnabled && turnstileSiteKey ? (
                <TurnstileWidget
                  key={turnstileKey}
                  siteKey={turnstileSiteKey}
                  onToken={(token) => setTurnstileToken(token)}
                  onExpire={() => setTurnstileToken("")}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-stone-200 px-4 py-5 text-center text-xs text-stone-400">
                  系统未配置人机验证，可直接获取验证码
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value)}
                  placeholder="邮箱验证码"
                  className="h-13 flex-1 rounded-2xl border-stone-200 bg-white px-4"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-13 shrink-0 rounded-2xl border-stone-200 bg-white px-4 text-stone-700"
                  onClick={() => void handleSendCode()}
                  disabled={isSendingCode || resendCountdown > 0}
                >
                  {isSendingCode ? <LoaderCircle className="size-4 animate-spin" /> : resendCountdown > 0 ? `${resendCountdown}s 后重发` : codeSent ? "重新发送" : "获取验证码"}
                </Button>
              </div>
            </div>
          ) : null}

          <Button
            className="h-13 w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800"
            onClick={submitAction}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {isLogin ? "登录" : isRegister ? "注册并登录" : "重置密码"}
          </Button>

          <div className="flex flex-col items-center gap-2 text-sm text-stone-500">
            {isLogin && registrationEnabled ? (
              <button
                type="button"
                className="text-stone-700 underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("register");
                  setPassword("");
                  setConfirmPassword("");
                  setEmailCode("");
                  setCodeSent(false);
                  setResendCountdown(0);
                }}
              >
                还没有账号？去注册
              </button>
            ) : null}
            {isLogin ? (
              <button
                type="button"
                className="text-stone-700 underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("forgot");
                  setPassword("");
                  setConfirmPassword("");
                  setEmailCode("");
                  setCodeSent(false);
                  setResendCountdown(0);
                }}
              >
                忘记密码？
              </button>
            ) : null}
            {!isLogin ? (
              <button
                type="button"
                className="text-stone-700 underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("login");
                  setPassword("");
                  setConfirmPassword("");
                  setEmailCode("");
                  setCodeSent(false);
                  setResendCountdown(0);
                }}
              >
                已有账号？返回登录
              </button>
            ) : null}
            <p className="text-xs text-stone-400">
              {isForgot ? "验证码将发送至您绑定的邮箱，请妥善保管新密码。" : "请妥善保管账号密码，忘记密码可通过绑定邮箱找回。"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
