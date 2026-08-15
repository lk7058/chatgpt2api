"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

// 额度中心已合并进「用户中心」（/center）的「额度明细」分区，旧地址重定向
export default function RedeemPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/center");
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <LoaderCircle className="size-5 animate-spin text-stone-400" />
    </div>
  );
}
