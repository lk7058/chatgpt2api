"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthGuard } from "@/lib/use-auth-guard";

import { useSettingsStore } from "./store";

// 卡片按 Tab 懒加载，避免首屏打包全部管理功能
const cardLoading = () => (
  <div className="flex items-center justify-center p-10">
    <LoaderCircle className="size-5 animate-spin text-stone-400" />
  </div>
);
const ConfigCard = dynamic(() => import("./components/config-card").then((m) => m.ConfigCard), { ssr: false, loading: cardLoading });
const UserManagementCard = dynamic(() => import("./components/user-management-card").then((m) => m.UserManagementCard), { ssr: false, loading: cardLoading });
const ThirdPartyApiCard = dynamic(() => import("./components/third-party-api-card").then((m) => m.ThirdPartyApiCard), { ssr: false, loading: cardLoading });
const RedeemCodesCard = dynamic(() => import("./components/redeem-codes-card").then((m) => m.RedeemCodesCard), { ssr: false, loading: cardLoading });
const SMTPCard = dynamic(() => import("./components/smtp-card").then((m) => m.SMTPCard), { ssr: false, loading: cardLoading });
const ProxyRuntimeCard = dynamic(() => import("./components/proxy-runtime-card").then((m) => m.ProxyRuntimeCard), { ssr: false, loading: cardLoading });
const BackupSettingsCard = dynamic(() => import("./components/backup-settings-card").then((m) => m.BackupSettingsCard), { ssr: false, loading: cardLoading });
const UserKeysCard = dynamic(() => import("./components/user-keys-card").then((m) => m.UserKeysCard), { ssr: false, loading: cardLoading });
const ThirdPartyAppsCard = dynamic(() => import("./components/third-party-apps-card").then((m) => m.ThirdPartyAppsCard), { ssr: false, loading: cardLoading });
const ApiDocsCard = dynamic(() => import("./components/api-docs-card").then((m) => m.ApiDocsCard), { ssr: false, loading: cardLoading });
const ApiSettingsCard = dynamic(() => import("./components/api-settings-card").then((m) => m.ApiSettingsCard), { ssr: false, loading: cardLoading });
const CPAPoolsCard = dynamic(() => import("./components/cpa-pools-card").then((m) => m.CPAPoolsCard), { ssr: false, loading: cardLoading });
const Sub2APIConnections = dynamic(() => import("./components/sub2api-connections").then((m) => m.Sub2APIConnections), { ssr: false, loading: cardLoading });
const ImageCleanupCard = dynamic(() => import("./components/image-cleanup-card").then((m) => m.ImageCleanupCard), { ssr: false, loading: cardLoading });
const AnnouncementCard = dynamic(() => import("./components/announcement-card").then((m) => m.AnnouncementCard), { ssr: false, loading: cardLoading });
const AdminTasksCard = dynamic(() => import("./components/admin-tasks-card").then((m) => m.AdminTasksCard), { ssr: false, loading: cardLoading });
const McpManagementCard = dynamic(() => import("./components/mcp-management-card").then((m) => m.McpManagementCard), { ssr: false, loading: cardLoading });
const CPAPoolDialog = dynamic(() => import("./components/cpa-pool-dialog").then((m) => m.CPAPoolDialog), { ssr: false });
const ImportBrowserDialog = dynamic(() => import("./components/import-browser-dialog").then((m) => m.ImportBrowserDialog), { ssr: false });

import { SettingsHeader } from "./components/settings-header";

const settingsTabs = [
  { value: "basic", title: "基础配置" },
  { value: "users", title: "用户管理" },
  { value: "third-party", title: "第三方 API" },
  { value: "redeem", title: "充值卡" },
  { value: "smtp", title: "邮箱设置" },
  { value: "backup", title: "备份" },
  { value: "keys", title: "用户密钥" },
  { value: "api-docs", title: "接口接入" },
  { value: "canvas", title: "画布入口" },
  { value: "proxy", title: "FlareSolverr" },
  { value: "cpa", title: "CPA" },
  { value: "sub2api", title: "Sub2API" },
  { value: "cleanup", title: "数据清理" },
  { value: "announce", title: "公告" },
  { value: "tasks", title: "任务管理" },
  { value: "mcp", title: "MCP 服务" },
];

function SettingsDataController() {
  const didLoadRef = useRef(false);
  const initialize = useSettingsStore((state) => state.initialize);
  const loadPools = useSettingsStore((state) => state.loadPools);
  const loadBackups = useSettingsStore((state) => state.loadBackups);
  const pools = useSettingsStore((state) => state.pools);
  const backupState = useSettingsStore((state) => state.backupState);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const hasRunningJobs = pools.some((pool) => {
      const status = pool.import_job?.status;
      return status === "pending" || status === "running";
    });
    if (!hasRunningJobs) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadPools(true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loadPools, pools]);

  useEffect(() => {
    if (!backupState?.running) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadBackups(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [backupState?.running, loadBackups]);

  return null;
}

function SettingsPageContent() {
  return (
    <>
      <SettingsDataController />
      <SettingsHeader />
      <Tabs defaultValue="basic" className="space-y-4">
        <div className="sticky top-3 z-20 overflow-x-auto rounded-xl border border-white/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          <TabsList variant="line" className="min-w-max justify-start">
            {settingsTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-4">
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="basic">
          <ConfigCard />
        </TabsContent>
        <TabsContent value="users">
          <UserManagementCard />
        </TabsContent>
        <TabsContent value="third-party">
          <ThirdPartyApiCard />
        </TabsContent>
        <TabsContent value="redeem">
          <RedeemCodesCard />
        </TabsContent>
        <TabsContent value="smtp">
          <SMTPCard />
        </TabsContent>
        <TabsContent value="proxy">
          <ProxyRuntimeCard />
        </TabsContent>
        <TabsContent value="backup">
          <BackupSettingsCard />
        </TabsContent>
        <TabsContent value="keys">
          <UserKeysCard />
        </TabsContent>
        <TabsContent value="canvas">
          <ThirdPartyAppsCard />
        </TabsContent>
        <TabsContent value="api-docs">
          <ApiSettingsCard />
          <ApiDocsCard />
        </TabsContent>
        <TabsContent value="cpa">
          <CPAPoolsCard />
        </TabsContent>
        <TabsContent value="sub2api">
          <Sub2APIConnections />
        </TabsContent>
        <TabsContent value="cleanup">
          <ImageCleanupCard />
        </TabsContent>
        <TabsContent value="announce">
          <AnnouncementCard />
        </TabsContent>
        <TabsContent value="tasks">
          <AdminTasksCard />
        </TabsContent>
        <TabsContent value="mcp">
          <McpManagementCard />
        </TabsContent>
      </Tabs>
      <CPAPoolDialog />
      <ImportBrowserDialog />
    </>
  );
}

export default function SettingsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <SettingsPageContent />;
}
