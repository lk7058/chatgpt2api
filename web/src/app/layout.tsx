import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeScript } from "@/components/theme-script";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "chatgpt2api",
  description: "OpenAI 兼容的图片生成 / 聊天 API 代理服务",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0ebe3" },
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <ThemeScript />
        {/* 首屏即设置网站标题：HTML 解析阶段同步读取公开配置，避免先显示默认标题 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=new XMLHttpRequest();r.open("GET","/api/public-settings",false);r.send();if(r.status===200){var d=JSON.parse(r.responseText);if(d&&d.site_title){document.title=d.site_title;}}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className="antialiased"
        style={{
          fontFamily:
            '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
        }}
      >
        <Toaster position="top-center" richColors offset={48} />
        <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.92),_rgba(245,239,231,0.96)_42%,_rgba(240,235,227,0.99)_100%)] px-4 pt-0 pb-2 text-stone-900 transition-colors duration-300 dark:bg-[radial-gradient(circle_at_top_left,_rgba(55,48,43,0.72),_rgba(28,25,23,0.98)_40%,_rgba(12,10,9,1)_100%)] dark:text-stone-100 sm:px-6 sm:pt-2 lg:px-8">
          <div className="mx-auto box-border flex min-h-screen max-w-[1440px] flex-col gap-2 pt-[env(safe-area-inset-top)] sm:gap-5 sm:pt-0">
            <TopNav />
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
