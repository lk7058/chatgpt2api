"use client";

import dynamic from "next/dynamic";
import { LoaderCircle } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthGuard } from "@/lib/use-auth-guard";

// 面板按 Tab 懒加载（search-panel 引入 react-markdown，移出首屏）
const panelLoading = () => (
  <div className="flex items-center justify-center p-10">
    <LoaderCircle className="size-5 animate-spin text-stone-400" />
  </div>
);
const ChatPanel = dynamic(() => import("./components/chat-panel").then((m) => m.ChatPanel), { ssr: false, loading: panelLoading });
const PptPanel = dynamic(() => import("./components/ppt-panel").then((m) => m.PptPanel), { ssr: false, loading: panelLoading });
const PsdPanel = dynamic(() => import("./components/psd-panel").then((m) => m.PsdPanel), { ssr: false, loading: panelLoading });
const SearchPanel = dynamic(() => import("./components/search-panel").then((m) => m.SearchPanel), { ssr: false, loading: panelLoading });
const SkillPanel = dynamic(() => import("./components/skill-panel").then((m) => m.SkillPanel), { ssr: false, loading: panelLoading });

const tabs = [
  { value: "skills", title: "搜索Skills" },
  { value: "search", title: "搜索" },
  { value: "ppt", title: "PPT生成" },
  { value: "psd", title: "PSD生成" },
  { value: "chat", title: "对话" },
];

export default function DebugPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[calc(100vh-49px)] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="skills" className="mx-auto flex min-h-[calc(100vh-49px)] w-full max-w-[1600px] flex-col gap-4 px-4 pt-3 pb-6 md:px-8">
      <TabsList variant="line" className="w-full">
        {tabs.map(({ value, title }) => (
          <TabsTrigger key={value} value={value}>
            {title}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="skills">
        <SkillPanel />
      </TabsContent>
      <TabsContent value="search" className="min-h-0">
        <SearchPanel />
      </TabsContent>
      <TabsContent value="ppt" className="min-h-0">
        <PptPanel />
      </TabsContent>
      <TabsContent value="psd" className="min-h-0">
        <PsdPanel />
      </TabsContent>
      <TabsContent value="chat" className="min-h-0">
        <ChatPanel />
      </TabsContent>
    </Tabs>
  );
}
