"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Code2, CloudDownload, DatabaseBackup, Flame, KeyRound, LayoutGrid, ListX, LoaderCircle, Mail, Megaphone, Plug, Server, SlidersHorizontal, Ticket, Trash2, UserRound } from "lucide-react";

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
const CPAPoolsCard = dynamic(() => import("./components/cpa-pools-card").then((m) => m.CPAPoolsCard), { ssr: false, loading: cardLoading });
const Sub2APIConnections = dynamic(() => import("./components/sub2api-connections").then((m) => m.Sub2APIConnections), { ssr: false, loading: cardLoading });
const ImageCleanupCard = dynamic(() => import("./components/image-cleanup-card").then((m) => m.ImageCleanupCard), { ssr: false, loading: cardLoading });
const AnnouncementCard = dynamic(() => import("./components/announcement-card").then((m) => m.AnnouncementCard), { ssr: false, loading: cardLoading });
const AdminTasksCard = dynamic(() => import("./components/admin-tasks-card").then((m) => m.AdminTasksCard), { ssr: false, loading: cardLoading });
const CPAPoolDialog = dynamic(() => import("./components/cpa-pool-dialog").then((m) => m.CPAPoolDialog), { ssr: false });
const ImportBrowserDialog = dynamic(() => import("./components/import-browser-dialog").then((m) => m.ImportBrowserDialog), { ssr: false });

import { SettingsHeader } from "./components/settings-header";

type SettingsTab = { value: string; title: string; icon: typeof SlidersHorizontal };

const settingsGroups: { title: string; items: SettingsTab[] }[] = [
  {
    title: "常规",
    items: [
      { value: "basic", title: "基础配置", icon: SlidersHorizontal },
      { value: "announce", title: "公告", icon: Megaphone },
      { value: "smtp", title: "邮箱设置", icon: Mail },
      { value: "backup", title: "备份", icon: DatabaseBackup },
    ],
  },
  {
    title: "用户与额度",
    items: [
      { value: "users", title: "用户管理", icon: UserRound },
      { value: "redeem", title: "充值卡", icon: Ticket },
      { value: "keys", title: "用户密钥", icon: KeyRound },
    ],
  },
  {
    title: "账号池与集成",
    items: [
      { value: "third-party", title: "第三方 API", icon: Plug },
      { value: "proxy", title: "FlareSolverr", icon: Flame },
      { value: "cpa", title: "CPA", icon: CloudDownload },
      { value: "sub2api", title: "Sub2API", icon: Server },
    ],
  },
  {
    title: "系统",
    items: [
      { value: "api-docs", title: "接口接入", icon: Code2 },
      { value: "canvas", title: "画布入口", icon: LayoutGrid },
      { value: "cleanup", title: "数据清理", icon: Trash2 },
      { value: "tasks", title: "任务管理", icon: ListX },
    ],
  },
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
      <Tabs defaultValue="basic" className="items-start gap-5 lg:flex-row">
        {/* 左侧分组侧边栏：宽屏纵向分组导航，窄屏横向滚动 */}
        <div className="w-full shrink-0 lg:w-60">
          <div className="overflow-x-auto rounded-xl border border-white/80 bg-white/90 px-2 py-2 shadow-sm backdrop-blur lg:sticky lg:top-3 lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
            <TabsList variant="line" className="h-auto w-full min-w-max flex-row items-stretch gap-0.5 p-1 lg:min-w-0 lg:flex-col lg:p-2">
              {settingsGroups.map((group) => (
                <div key={group.title} className="contents lg:block">
                  <div className="hidden px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase lg:block">
                    {group.title}
                  </div>
                  {group.items.map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="gap-2 rounded-lg px-3 py-2 text-sm after:hidden data-[state=active]:bg-stone-950 data-[state=active]:text-white hover:bg-stone-100 lg:flex-none lg:justify-start dark:data-[state=active]:bg-white dark:data-[state=active]:text-stone-950 dark:hover:bg-white/10"
                    >
                      <tab.icon className="size-4 shrink-0" />
                      <span className="whitespace-nowrap">{tab.title}</span>
                    </TabsTrigger>
                  ))}
                </div>
              ))}
            </TabsList>
          </div>
        </div>

        {/* 右侧内容区 */}
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
