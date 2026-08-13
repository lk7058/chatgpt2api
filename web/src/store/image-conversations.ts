"use client";

import localforage from "localforage";

import type { ImageModel } from "@/lib/api";
import {
  clearGenerationRecords,
  deleteGenerationRecord,
  fetchGenerationRecords,
  upsertGenerationRecord,
} from "@/lib/api";
import { getStoredAuthSession } from "@/store/auth";

export type ImageConversationMode = "generate" | "edit";

export type StoredReferenceImage = {
  name: string;
  type: string;
  dataUrl: string;
};

export type StoredImage = {
  id: string;
  taskId?: string;
  status?: "loading" | "success" | "error";
  taskStatus?: "queued" | "running";
  progress?: string;
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  error?: string;
  startTime?: number;
  elapsedSecs?: number;
  elapsedUpdatedAt?: number;
  durationMs?: number;
};

export type ImageTurnStatus = "queued" | "generating" | "success" | "error";

export type ImageTurn = {
  id: string;
  prompt: string;
  model: ImageModel;
  mode: ImageConversationMode;
  referenceImages: StoredReferenceImage[];
  count: number;
  size: string;
  ratio: string;
  tier: string;
  quality: string;
  images: StoredImage[];
  createdAt: string;
  status: ImageTurnStatus;
  error?: string;
  promptDeleted?: boolean;
  resultsDeleted?: boolean;
};

export type ImageConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ImageTurn[];
};

export type ImageConversationStats = {
  queued: number;
  running: number;
};

const imageConversationStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "image_conversations",
});

const IMAGE_CONVERSATIONS_KEY = "items";
let imageConversationWriteQueue: Promise<void> = Promise.resolve();

// 与后端列表接口一致：超过该长度的 dataUrl 视为重负载，云同步时剥离
const HEAVY_SYNC_BASE64_LEN = 50_000;

// 上传服务端前剥离重负载：结果图 b64_json（裸 base64，可达数 MB）与超大参考图 dataUrl
// 只在本机使用；服务端记录保留 url/元数据即可，跨设备展示与编辑会回源 url 重建。
function stripHeavyPayloadForSync(conversation: ImageConversation): ImageConversation {
  return {
    ...conversation,
    turns: conversation.turns.map((turn) => ({
      ...turn,
      images: turn.images.map(({ b64_json: _b64, ...rest }) => rest),
      referenceImages: turn.referenceImages.map((image) =>
        image.dataUrl.length > HEAVY_SYNC_BASE64_LEN ? { ...image, dataUrl: "" } : image,
      ),
    })),
  };
}

function normalizeStoredImage(image: StoredImage): StoredImage {
  const normalized = {
    ...image,
    taskId: typeof image.taskId === "string" && image.taskId ? image.taskId : undefined,
    taskStatus: image.taskStatus === "queued" || image.taskStatus === "running" ? image.taskStatus : undefined,
    url: typeof image.url === "string" && image.url ? image.url : undefined,
    revised_prompt: typeof image.revised_prompt === "string" ? image.revised_prompt : undefined,
    startTime: typeof image.startTime === "number" ? image.startTime : undefined,
    elapsedSecs: typeof image.elapsedSecs === "number" ? image.elapsedSecs : undefined,
    elapsedUpdatedAt: typeof image.elapsedUpdatedAt === "number" ? image.elapsedUpdatedAt : undefined,
    durationMs: typeof image.durationMs === "number" ? image.durationMs : undefined,
  };
  if (image.status === "loading" || image.status === "error" || image.status === "success") {
    return normalized;
  }
  return {
    ...normalized,
    status: image.b64_json || image.url ? "success" : "loading",
  };
}

function normalizeReferenceImage(image: StoredReferenceImage): StoredReferenceImage {
  return {
    name: image.name || "reference.png",
    type: image.type || "image/png",
    dataUrl: image.dataUrl,
  };
}

function dataUrlMimeType(dataUrl: string) {
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match?.[1] || "image/png";
}

function getLegacyReferenceImages(source: Record<string, unknown>): StoredReferenceImage[] {
  if (Array.isArray(source.referenceImages)) {
    return source.referenceImages
      .filter((image): image is StoredReferenceImage => {
        if (!image || typeof image !== "object") {
          return false;
        }
        const candidate = image as StoredReferenceImage;
        return typeof candidate.dataUrl === "string" && candidate.dataUrl.length > 0;
      })
      .map(normalizeReferenceImage);
  }

  if (source.sourceImage && typeof source.sourceImage === "object") {
    const image = source.sourceImage as { dataUrl?: unknown; fileName?: unknown };
    if (typeof image.dataUrl === "string" && image.dataUrl) {
      return [
        {
          name: typeof image.fileName === "string" && image.fileName ? image.fileName : "reference.png",
          type: dataUrlMimeType(image.dataUrl),
          dataUrl: image.dataUrl,
        },
      ];
    }
  }

  return [];
}

function normalizeTurn(turn: ImageTurn & Record<string, unknown>): ImageTurn {
  const normalizedImages = Array.isArray(turn.images) ? turn.images.map(normalizeStoredImage) : [];
  const derivedStatus: ImageTurnStatus =
    normalizedImages.some((image) => image.status === "loading")
      ? "generating"
      : normalizedImages.some((image) => image.status === "error")
        ? "error"
        : "success";

  return {
    id: String(turn.id || `${Date.now()}`),
    prompt: String(turn.prompt || ""),
    model: (turn.model as ImageModel) || "gpt-image-2",
    mode: turn.mode === "edit" ? "edit" : "generate",
    referenceImages: getLegacyReferenceImages(turn),
    count: Math.max(1, Number(turn.count || normalizedImages.length || 1)),
    size: typeof turn.size === "string" ? turn.size : "",
    ratio: typeof turn.ratio === "string" && turn.ratio ? turn.ratio : "1:1",
    tier: typeof turn.tier === "string" && turn.tier ? turn.tier : "1k",
    quality: typeof turn.quality === "string" && turn.quality ? turn.quality : "auto",
    images: normalizedImages,
    createdAt: String(turn.createdAt || new Date().toISOString()),
    status:
      turn.status === "queued" ||
      turn.status === "generating" ||
      turn.status === "success" ||
      turn.status === "error"
        ? turn.status
        : derivedStatus,
    error: typeof turn.error === "string" ? turn.error : undefined,
    promptDeleted: turn.promptDeleted === true,
    resultsDeleted: turn.resultsDeleted === true,
  };
}

function normalizeConversation(conversation: ImageConversation & Record<string, unknown>): ImageConversation {
  const turns = Array.isArray(conversation.turns)
    ? conversation.turns.map((turn) => normalizeTurn(turn as ImageTurn & Record<string, unknown>))
    : [
        normalizeTurn({
          id: String(conversation.id || `${Date.now()}`),
          prompt: String(conversation.prompt || ""),
          model: (conversation.model as ImageModel) || "gpt-image-2",
          mode: conversation.mode === "edit" ? "edit" : "generate",
          referenceImages: getLegacyReferenceImages(conversation),
          count: Number(conversation.count || 1),
          size: typeof conversation.size === "string" ? conversation.size : "",
          ratio: typeof conversation.ratio === "string" && conversation.ratio ? conversation.ratio : "1:1",
          tier: typeof conversation.tier === "string" && conversation.tier ? conversation.tier : "1k",
          quality: typeof conversation.quality === "string" && conversation.quality ? conversation.quality : "auto",
          images: Array.isArray(conversation.images) ? (conversation.images as StoredImage[]) : [],
          createdAt: String(conversation.createdAt || new Date().toISOString()),
          status:
            conversation.status === "generating" || conversation.status === "success" || conversation.status === "error"
              ? conversation.status
              : "success",
          error: typeof conversation.error === "string" ? conversation.error : undefined,
        }),
      ];
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;

  return {
    id: String(conversation.id || `${Date.now()}`),
    title: String(conversation.title || ""),
    createdAt: String(conversation.createdAt || lastTurn?.createdAt || new Date().toISOString()),
    updatedAt: String(conversation.updatedAt || lastTurn?.createdAt || new Date().toISOString()),
    turns,
  };
}

function sortImageConversations(conversations: ImageConversation[]): ImageConversation[] {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getTimestamp(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function pickLatestConversation(current: ImageConversation, next: ImageConversation) {
  return getTimestamp(next.updatedAt) >= getTimestamp(current.updatedAt) ? next : current;
}

function queueImageConversationWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = imageConversationWriteQueue.then(operation);
  imageConversationWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ── 云同步：按登录账号记录到服务端（保留本地缓存兜底） ──────

async function getSessionUserId(): Promise<string | null> {
  try {
    const session = await getStoredAuthSession();
    return session?.userId || null;
  } catch {
    return null;
  }
}

async function syncPushConversations(conversations: ImageConversation[]): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) {
    return;
  }
  try {
    for (const conversation of conversations) {
      await upsertGenerationRecord({
        id: conversation.id,
        kind: "image",
        title: conversation.title || conversation.turns[0]?.prompt?.slice(0, 50) || "未命名",
        payload: stripHeavyPayloadForSync(conversation),
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
      });
    }
  } catch {
    // 云同步失败不阻塞本地使用
  }
}

async function syncPullConversations(): Promise<ImageConversation[] | null> {
  const userId = await getSessionUserId();
  if (!userId) {
    return null;
  }
  try {
    const data = await fetchGenerationRecords(500);
    const items: ImageConversation[] = [];
    for (const record of data.items) {
      if (record.kind !== "image" || !record.payload) {
        continue;
      }
      const conversation = normalizeConversation(record.payload as ImageConversation & Record<string, unknown>);
      items.push(conversation);
    }
    if (items.length === 0 && data.items.length > 0) {
      return null;
    }
    return items;
  } catch {
    return null;
  }
}

async function readStoredImageConversations(): Promise<ImageConversation[]> {
  const items =
    (await imageConversationStorage.getItem<Array<ImageConversation & Record<string, unknown>>>(
      IMAGE_CONVERSATIONS_KEY,
    )) || [];
  return items.map(normalizeConversation);
}

// 仅读本地缓存（秒开），不做任何网络请求
export async function readLocalImageConversations(): Promise<ImageConversation[]> {
  return sortImageConversations(await readStoredImageConversations());
}

// 合并服务端记录与本地缓存：优先取较新版本；若服务端版本较新但缺少 b64_json
// （上传时已剥离），把本地独有的 b64_json 补回，保证同设备上结果图可即时展示与作为编辑参考图。
function mergeSyncedConversations(synced: ImageConversation[], local: ImageConversation[]): ImageConversation[] {
  const merged = new Map<string, ImageConversation>();
  for (const conversation of synced) {
    merged.set(conversation.id, conversation);
  }
  for (const conversation of local) {
    const server = merged.get(conversation.id);
    if (!server) {
      merged.set(conversation.id, conversation);
      continue;
    }
    const latest = pickLatestConversation(server, conversation);
    if (latest === conversation) {
      merged.set(conversation.id, conversation);
      continue;
    }
    // 服务端版本较新但缺 b64_json：把本地对应的 b64_json 补回去
    const localTurns = new Map(conversation.turns.map((turn) => [turn.id, turn]));
    const turns = latest.turns.map((turn) => {
      const localTurn = localTurns.get(turn.id);
      if (!localTurn) {
        return turn;
      }
      const localImages = new Map(localTurn.images.map((image) => [image.id, image]));
      const images = turn.images.map((image) => {
        const localImage = localImages.get(image.id);
        return localImage?.b64_json && !image.b64_json ? { ...image, b64_json: localImage.b64_json } : image;
      });
      return { ...turn, images };
    });
    merged.set(conversation.id, { ...latest, turns });
  }
  return sortImageConversations([...merged.values()]);
}

// 后台同步：从服务端拉取记录并与本地缓存合并后写回缓存。
// 未登录或同步失败时返回 null，调用方应保留本地数据继续使用。
export async function syncImageConversationsFromServer(): Promise<ImageConversation[] | null> {
  const synced = await syncPullConversations();
  if (synced === null) {
    return null;
  }
  const local = await readStoredImageConversations();
  const result = mergeSyncedConversations(synced, local);
  void imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, result);
  return result;
}

export async function listImageConversations(): Promise<ImageConversation[]> {
  const synced = await syncImageConversationsFromServer();
  return synced ?? (await readLocalImageConversations());
}

export async function saveImageConversations(conversations: ImageConversation[]): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    const conversationMap = new Map(items.map((item) => [item.id, item]));
    for (const conversation of conversations.map(normalizeConversation)) {
      const current = conversationMap.get(conversation.id);
      conversationMap.set(conversation.id, current ? pickLatestConversation(current, conversation) : conversation);
    }
    const nextItems = sortImageConversations([...conversationMap.values()]);
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, nextItems);
    await syncPushConversations(nextItems);
  });
}

export async function saveImageConversation(conversation: ImageConversation): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    const nextConversation = normalizeConversation(conversation);
    const current = items.find((item) => item.id === nextConversation.id);
    const persistedConversation = current ? pickLatestConversation(current, nextConversation) : nextConversation;
    const nextItems = sortImageConversations([
      persistedConversation,
      ...items.filter((item) => item.id !== persistedConversation.id),
    ]);
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, nextItems);
    await syncPushConversations([persistedConversation]);
  });
}

export async function renameImageConversation(id: string, title: string): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    const target = items.find((item) => item.id === id);
    if (!target) return;
    const updated = { ...target, title, updatedAt: new Date().toISOString() };
    const nextItems = sortImageConversations([
      updated,
      ...items.filter((item) => item.id !== id),
    ]);
    await imageConversationStorage.setItem(IMAGE_CONVERSATIONS_KEY, nextItems);
    await syncPushConversations([updated]);
  });
}

export async function deleteImageConversation(id: string): Promise<void> {
  await queueImageConversationWrite(async () => {
    const items = await readStoredImageConversations();
    await imageConversationStorage.setItem(
      IMAGE_CONVERSATIONS_KEY,
      items.filter((item) => item.id !== id),
    );
    const userId = await getSessionUserId();
    if (userId) {
      try {
        await deleteGenerationRecord(id);
      } catch {
        // 忽略删除失败
      }
    }
  });
}

export async function clearImageConversations(): Promise<void> {
  await queueImageConversationWrite(async () => {
    await imageConversationStorage.removeItem(IMAGE_CONVERSATIONS_KEY);
    const userId = await getSessionUserId();
    if (userId) {
      try {
        await clearGenerationRecords();
      } catch {
        // 忽略清空失败
      }
    }
  });
}

export function getImageConversationStats(conversation: ImageConversation | null): ImageConversationStats {
  if (!conversation) {
    return { queued: 0, running: 0 };
  }

  return conversation.turns.reduce(
    (acc, turn) => {
      if (turn.resultsDeleted) {
        return acc;
      }
      if (turn.status === "queued") {
        acc.queued += 1;
      } else if (turn.status === "generating") {
        acc.running += 1;
      }
      return acc;
    },
    { queued: 0, running: 0 },
  );
}
