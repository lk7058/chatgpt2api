"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Mail, Save, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ShieldCheck } from "lucide-react";
import { testSmtp } from "@/lib/api";
import { useSettingsStore } from "../store";
import { EmailTemplateManager } from "./email-template-manager";

export function SMTPCard() {
  const config = useSettingsStore((state) => state.config);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const setSMTPField = useSettingsStore((state) => state.setSMTPField);
  const setTurnstileField = useSettingsStore((state) => state.setTurnstileField);
  const setAllowedEmailDomains = useSettingsStore((state) => state.setAllowedEmailDomains);
  const saveConfig = useSettingsStore((state) => state.saveConfig);
  const [testEmail, setTestEmail] = useState("");
  const [isTesting, setIsTesting] = useState(false);

  const smtp = config?.smtp;
  const turnstile = config?.turnstile;

  useEffect(() => {
    if (smtp?.host && !testEmail) {
      setTestEmail(smtp.username || "");
    }
  }, [smtp?.host, smtp?.username]);

  const handleSave = async () => {
    const ok = await saveConfig();
    if (ok) {
      toast.success("邮箱设置已保存");
    }
  };

  const handleTest = async () => {
    if (!testEmail || !testEmail.includes("@")) {
      toast.error("请填写收件邮箱");
      return;
    }
    setIsTesting(true);
    try {
      const data = await testSmtp(testEmail);
      toast.success("测试邮件已发送，请查收");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败");
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoadingConfig) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="flex items-center justify-center p-10">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
            <Mail className="size-5 text-stone-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">邮箱 SMTP 设置</h2>
            <p className="text-sm text-stone-500">配置后用户注册需通过邮箱验证码验证。</p>
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-stone-700">
          <Checkbox
            checked={Boolean(smtp?.enabled)}
            onCheckedChange={(checked) => setSMTPField("enabled", Boolean(checked))}
          />
          启用邮箱验证（注册需要邮箱验证码）
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm text-stone-700">SMTP 服务器</label>
            <Input value={String(smtp?.host || "")} onChange={(event) => setSMTPField("host", event.target.value)} placeholder="smtp.example.com" className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">端口</label>
            <Input type="number" value={String(smtp?.port ?? 465)} onChange={(event) => setSMTPField("port", event.target.value)} placeholder="465" className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">用户名（邮箱）</label>
            <Input value={String(smtp?.username || "")} onChange={(event) => setSMTPField("username", event.target.value)} placeholder="your@example.com" className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">密码 / 授权码</label>
            <Input type="password" value={String(smtp?.password || "")} onChange={(event) => setSMTPField("password", event.target.value)} placeholder={smtp?.has_password ? "已保存，留空保持不变" : "请输入"} className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">发件人地址</label>
            <Input value={String(smtp?.from || "")} onChange={(event) => setSMTPField("from", event.target.value)} placeholder="your@example.com（留空用用户名）" className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">发件人名称</label>
            <Input value={String(smtp?.from_name || "chatgpt2api")} onChange={(event) => setSMTPField("from_name", event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-stone-700">
          <Checkbox
            checked={Boolean(smtp?.use_ssl !== false)}
            onCheckedChange={(checked) => setSMTPField("use_ssl", Boolean(checked))}
          />
          使用 SSL/TLS 加密连接（465 端口通常勾选；587 端口使用 STARTTLS 时取消勾选）
        </label>

        <div className="space-y-2">
          <label className="text-sm text-stone-700">允许注册的邮箱域名（可选）</label>
          <Input
            value={Array.isArray(config?.allowed_email_domains) ? config.allowed_email_domains.join(", ") : String(config?.allowed_email_domains || "")}
            onChange={(event) => setAllowedEmailDomains(event.target.value)}
            placeholder="例如：ice11.cn, gmail.com（留空 = 不限制）"
            className="h-10 rounded-xl border-stone-200 bg-white"
          />
          <p className="text-xs leading-5 text-stone-500">
            注册时仅允许这些邮箱域名，多个用英文逗号分隔；留空表示不限域名。
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleSave()} disabled={isSavingConfig}>
            {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存设置
          </Button>
          <div className="flex flex-1 items-center gap-2">
            <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="测试收件邮箱" className="h-10 max-w-xs rounded-xl border-stone-200 bg-white" />
            <Button type="button" variant="outline" className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={() => void handleTest()} disabled={isTesting}>
              {isTesting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              发送测试邮件
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <EmailTemplateManager />

    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
            <ShieldCheck className="size-5 text-stone-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">人机验证（Cloudflare Turnstile）</h2>
            <p className="text-sm text-stone-500">注册发送邮件前需通过人机验证。在 Cloudflare 控制台创建 Turnstile 站点获取 Site Key 和 Secret Key。</p>
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-stone-700">
          <Checkbox
            checked={Boolean(turnstile?.enabled)}
            onCheckedChange={(checked) => setTurnstileField("enabled", Boolean(checked))}
          />
          启用 Cloudflare Turnstile 人机验证
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Site Key</label>
            <Input value={String(turnstile?.site_key || "")} onChange={(event) => setTurnstileField("site_key", event.target.value)} placeholder="0x4AAAAA..." className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">Secret Key</label>
            <Input type="password" value={String(turnstile?.secret_key || "")} onChange={(event) => setTurnstileField("secret_key", event.target.value)} placeholder={turnstile?.has_secret_key ? "已保存，留空保持不变" : "0x4AAAAA..."} className="h-10 rounded-xl border-stone-200 bg-white" />
          </div>
        </div>
        <p className="text-xs leading-5 text-stone-500">
          配置步骤：Cloudflare 控制台 → Turnstile → 添加站点 → 选择「非交互式/托管」模式 → 复制 Site Key 与 Secret Key 填入此处 → 保存。
        </p>

        <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void handleSave()} disabled={isSavingConfig}>
          {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存设置
        </Button>
      </CardContent>
    </Card>
    </>
  );
}
