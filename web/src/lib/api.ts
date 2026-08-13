import { httpRequest, request } from "@/lib/request";

export type AccountType = string;
export type AccountStatus = "正常" | "限流" | "异常" | "禁用";
export type ImageModel = string;
export type AuthRole = "admin" | "user";
export type ImageStorageMode = "local" | "webdav" | "both";

export type ImageStorageSettings = {
  enabled: boolean;
  mode: ImageStorageMode;
  webdav_url: string;
  webdav_username: string;
  webdav_password: string;
  webdav_root_path: string;
  public_base_url: string;
  has_webdav_password?: boolean;
};

export type Account = {
  access_token: string;
  type: AccountType;
  source_type?: string | null;
  status: AccountStatus;
  quota: number;
  email?: string | null;
  user_id?: string | null;
  limits_progress?: Array<{
    feature_name?: string;
    remaining?: number;
    reset_after?: string;
  }>;
  default_model_slug?: string | null;
  restore_at?: string | null;
  success: number;
  fail: number;
  /** 当前图片在途数(正在生成、尚未结束的图片数)。号池空闲时持续 > 0 表示并发槽位泄漏。 */
  image_inflight?: number;
  last_used_at?: string | null;
  proxy?: string | null;
};

export type AccountImportPayload = {
  access_token: string;
  accessToken?: string;
  type?: string;
  export_type?: string;
  source_type?: string;
  [key: string]: unknown;
};

export type Model = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  permission: unknown[];
  root: string;
  parent: string | null;
};

type AccountListResponse = {
  items: Account[];
};

type ModelListResponse = {
  object: string;
  data: Model[];
};

type AccountMutationResponse = {
  items: Account[];
  added?: number;
  skipped?: number;
  removed?: number;
  refreshed?: number;
  relogined?: number;
  errors?: Array<{ access_token: string; error: string }>;
};

export type AccountRefreshResponse = {
  items: Account[];
  refreshed: number;
  relogined?: number;
  errors: Array<{ access_token: string; error: string }>;
};

export type RefreshProgressResponse = {
  total: number;
  processed: number;
  done: boolean;
  error: string | null;
  status_counts?: Record<string, number>;
  total_quota?: number;
  result?: AccountRefreshResponse | null;
  results?: Array<{ token: string; status: string; error?: string | null }>;
};

type AccountUpdateResponse = {
  item: Account;
  items: Account[];
};

export type ProxyRuntimeEgressMode = "direct" | "single_proxy";
export type ProxyRuntimeClearanceMode = "none" | "manual" | "flaresolverr";

export type ProxyRuntimeClearanceSettings = {
  enabled: boolean;
  mode: ProxyRuntimeClearanceMode;
  cf_cookies: string;
  cf_clearance: string;
  user_agent: string;
  browser: string;
  flaresolverr_url: string;
  timeout_sec: number | string;
  refresh_interval: number | string;
  warm_up_on_start: boolean;
  has_cf_cookies?: boolean;
  has_cf_clearance?: boolean;
};

export type ProxyRuntimeSettings = {
  enabled: boolean;
  egress_mode: ProxyRuntimeEgressMode;
  proxy_url: string;
  resource_proxy_url: string;
  skip_ssl_verify: boolean;
  reset_session_status_codes: number[];
  clearance: ProxyRuntimeClearanceSettings;
};

export type ProxyRuntimeStatus = {
  enabled: boolean;
  egress_mode: ProxyRuntimeEgressMode | string;
  proxy_source: string;
  has_proxy: boolean;
  clearance_enabled: boolean;
  clearance_mode: ProxyRuntimeClearanceMode | string;
  has_clearance_bundle: boolean;
  cached_clearance_hosts: string[];
};

export type ProxyRuntimeResponse = {
  runtime: ProxyRuntimeSettings;
  status: ProxyRuntimeStatus;
};

export type ThirdPartyAppsSettings = {
  infinite_canvas: {
    enabled: boolean;
    url: string;
  };
};

export type SettingsConfig = {
  proxy: string;
  base_url?: string;
  global_system_prompt?: string;
  default_upstream_model_name?: string;
  default_thinking_effort?: "auto" | "standard" | "extended" | "max";
  sensitive_words?: string[];
  ai_review?: {
    enabled?: boolean;
    base_url?: string;
    api_key?: string;
    model?: string;
    prompt?: string;
  };
  refresh_account_interval_minute?: number | string;
  image_retention_days?: number | string;
  image_local_download_enabled?: boolean;
  image_local_retention_days?: number | string;
  image_prefer_b64_json?: boolean;
  image_download_proxy?: string;
  image_poll_timeout_secs?: number | string;
  image_account_concurrency?: number | string;
  image_parallel_generation?: boolean;
  image_settle_enabled?: boolean;
  image_check_before_hit_enabled?: boolean;
  image_remove_conversation_after_result?: boolean;
  image_remove_conversation_always?: boolean;
  image_settle_secs?: number | string;
  image_timeout_retry_secs?: number | string;
  auto_remove_invalid_accounts?: boolean;
  auto_remove_rate_limited_accounts?: boolean;
  auto_relogin_after_refresh?: boolean;
  log_levels?: string[];
  image_storage?: ImageStorageSettings;
  proxy_runtime?: ProxyRuntimeSettings;
  third_party_apps?: ThirdPartyAppsSettings;
  registration_enabled?: boolean;
  registration_bonus_quota?: number;
  checkin_bonus_quota?: number;
  checkin_streak_bonuses?: { days: number; bonus: number }[];
  site_title?: string;
  smtp?: {
    enabled?: boolean;
    host?: string;
    port?: number | string;
    username?: string;
    password?: string;
    from?: string;
    from_name?: string;
    use_ssl?: boolean;
    has_password?: boolean;
  };
  turnstile?: {
    enabled?: boolean;
    site_key?: string;
    secret_key?: string;
    has_secret_key?: boolean;
  };
  model_quota_weights?: Record<string, number>;
  third_party_apis?: ThirdPartyApi[];
  admin_account?: {
    username?: string;
    has_password?: boolean;
  };
  backup?: BackupSettings;
  backup_state?: BackupState;
  [key: string]: unknown;
};

export type BackupInclude = {
  config: boolean;
  cpa: boolean;
  sub2api: boolean;
  logs: boolean;
  image_tasks: boolean;
  accounts_snapshot: boolean;
  auth_keys_snapshot: boolean;
  images: boolean;
};

export type BackupSettings = {
  enabled: boolean;
  provider: "cloudflare_r2" | string;
  account_id: string;
  access_key_id: string;
  secret_access_key: string;
  bucket: string;
  prefix: string;
  interval_minutes: number | string;
  rotation_keep: number | string;
  encrypt: boolean;
  passphrase: string;
  include: BackupInclude;
  has_secret_access_key?: boolean;
  has_passphrase?: boolean;
};

export type BackupState = {
  running: boolean;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_status?: string;
  last_error?: string | null;
  last_object_key?: string | null;
};

export type BackupItem = {
  key: string;
  name: string;
  size: number;
  updated_at?: string | null;
  encrypted: boolean;
};

export type BackupDetail = {
  key: string;
  name: string;
  encrypted: boolean;
  created_at?: string | null;
  trigger?: string | null;
  app_version?: string | null;
  storage_backend?: Record<string, unknown> | null;
  files: Array<{
    name: string;
    exists: boolean;
    content_type?: string;
    size: number;
    sha256?: string;
  }>;
  snapshots: Array<{
    name: string;
    count: number;
  }>;
};

export type ManagedImage = {
  rel: string;
  path?: string;
  name: string;
  date: string;
  size: number;
  url: string;
  thumbnail_url?: string;
  created_at: string;
  width?: number;
  height?: number;
  tags?: string[];
};

export type SystemLog = {
  id: string;
  time: string;
  type: "call" | "account" | string;
  summary?: string;
  detail?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ImageResponse = {
  created: number;
  data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
};

export type ImageTask = {
  id: string;
  status: "queued" | "running" | "success" | "error" | "cancelled";
  mode: "generate" | "edit";
  model?: ImageModel;
  size?: string;
  quality?: string;
  created_at: string;
  updated_at: string;
  conversation_id?: string;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: string;
  progress?: string;
  elapsed_secs?: number;
  duration_ms?: number;
  cancel_reason?: "user" | "admin";
};

type ImageTaskListResponse = {
  items: ImageTask[];
  missing_ids: string[];
};

export type LoginResponse = {
  ok: boolean;
  version: string;
  role: AuthRole;
  subject_id: string;
  name: string;
};

export type AuthUser = {
  id: string;
  username: string;
  role: AuthRole;
  quota_total: number;
  quota_used: number;
  quota_left: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  email: string;
  email_verified: boolean;
  last_checkin_date: string;
  checkin_streak: number;
  total_checkins: number;
};

export type StreakBonus = {
  days: number;
  bonus: number;
};

export type CheckinStatus = {
  ok: boolean;
  checked_today: boolean;
  checkin_streak: number;
  total_checkins: number;
  last_checkin_date: string;
  bonus_quota: number;
  streak_bonuses: StreakBonus[];
  next_streak_bonus?: StreakBonus | null;
  today: string;
};

export type CheckinResult = {
  ok: boolean;
  bonus_quota: number;
  streak_bonus?: number;
  quota_left: number;
  checkin_streak: number;
  total_checkins: number;
  checked_today: boolean;
};

export type LoginResult = {
  ok: boolean;
  token: string;
  role: AuthRole;
  subject_id: string;
  name: string;
  user: AuthUser;
};

export type MeResult = {
  ok: boolean;
  role: AuthRole;
  subject_id: string;
  name: string;
  user: AuthUser | null;
  quota_left: number;
  quota_total: number;
  quota_used: number;
};

export type ThirdPartyApi = {
  id: string;
  name: string;
  base_url: string;
  has_api_key: boolean;
  models: string[];
  enabled: boolean;
  default: boolean;
  created_at: string;
};

export type GenerationRecord = {
  id: string;
  kind: string;
  title: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

export async function loginWithPassword(email: string, password: string) {
  return httpRequest<LoginResult>("/auth/login", {
    method: "POST",
    body: { username: email, password },
    redirectOnUnauthorized: false,
  });
}

export async function registerWithPassword(username: string, password: string) {
  return httpRequest<LoginResult>("/auth/register", {
    method: "POST",
    body: { username, password },
    redirectOnUnauthorized: false,
  });
}

export async function logoutSession() {
  return httpRequest<{ ok: boolean }>("/auth/logout", { method: "POST", body: {} });
}

export async function fetchMe() {
  return httpRequest<MeResult>("/api/me");
}

export async function fetchCheckinStatus() {
  return httpRequest<CheckinStatus>("/api/checkin/status");
}

export async function doCheckin() {
  return httpRequest<CheckinResult>("/api/checkin", { method: "POST", body: {} });
}

export type QuotaRecord = {
  id: string;
  type: "income" | "expense";
  amount: number;
  balance_after: number;
  source: string;
  note: string;
  created_at: string;
};

export type QuotaRecordsResponse = {
  items: QuotaRecord[];
  summary: {
    total_income: number;
    total_expense: number;
    count: number;
  };
};

export async function fetchQuotaRecords(limit = 100) {
  return httpRequest<QuotaRecordsResponse>(`/api/quota/records?limit=${limit}`);
}

export async function fetchCheckinCalendar(days = 60) {
  return httpRequest<{ dates: string[] }>(`/api/checkin/calendar?days=${days}`);
}

export async function changeMyPassword(oldPassword: string, newPassword: string) {
  return httpRequest<{ ok: boolean; item: AuthUser }>("/api/me/password", {
    method: "POST",
    body: { old_password: oldPassword, new_password: newPassword },
  });
}

export async function sendRegisterEmailCode(email: string, captchaId = "", captchaCode = "") {
  return httpRequest<{ ok: boolean; message: string }>("/auth/register", {
    method: "POST",
    body: { password: "pending123", email, captcha_id: captchaId, captcha_code: captchaCode },
    redirectOnUnauthorized: false,
  });
}

export type PublicSettings = {
  site_title: string;
  turnstile_site_key: string;
  turnstile_enabled: boolean;
};

export async function fetchPublicSettings() {
  return httpRequest<PublicSettings>("/api/public-settings");
}

export async function deleteRedeemCode(codeId: string) {
  return httpRequest<{ ok: boolean }>(`/api/redeem-codes/${encodeURIComponent(codeId)}`, {
    method: "DELETE",
  });
}

export async function registerWithEmail(email: string, password: string, code: string) {
  return httpRequest<LoginResult>("/auth/register/verify", {
    method: "POST",
    body: { username: email, password, email, code },
    redirectOnUnauthorized: false,
  });
}

export async function sendForgotPasswordCode(email: string, captchaId = "", captchaCode = "") {
  return httpRequest<{ ok: boolean; message: string }>("/auth/forgot-password", {
    method: "POST",
    body: { email, captcha_id: captchaId, captcha_code: captchaCode },
    redirectOnUnauthorized: false,
  });
}

export async function resetPasswordWithEmail(email: string, code: string, newPassword: string) {
  return httpRequest<{ ok: boolean; message: string }>("/auth/forgot-password/verify", {
    method: "POST",
    body: { email, code, new_password: newPassword },
    redirectOnUnauthorized: false,
  });
}

export async function sendBindEmailCode(email: string) {
  return httpRequest<{ ok: boolean; message: string }>("/api/me/email/send-code", {
    method: "POST",
    body: { email },
  });
}

export async function bindEmail(email: string, code: string) {
  return httpRequest<{ ok: boolean; item: AuthUser }>("/api/me/email/bind", {
    method: "POST",
    body: { email, code },
  });
}

export type RedeemCode = {
  id: string;
  code: string;
  amount: number;
  status: "unused" | "used";
  created_by: string;
  created_at: string;
  used_by: string;
  used_username: string;
  used_at: string;
};

export async function generateRedeemCodes(count: number, amount: number) {
  return httpRequest<{ items: RedeemCode[]; count: number }>("/api/redeem-codes/generate", {
    method: "POST",
    body: { count, amount },
  });
}

export async function fetchRedeemCodes(status = "") {
  return httpRequest<{ items: RedeemCode[] }>(`/api/redeem-codes?status=${status}`);
}

export async function redeemCode(code: string) {
  return httpRequest<{ ok: boolean; amount: number; code: string; quota_left?: number }>("/api/redeem", {
    method: "POST",
    body: { code },
  });
}

export async function fetchMyRedeems() {
  return httpRequest<{ items: RedeemCode[] }>("/api/redeem/mine");
}

export async function testSmtp(email: string) {
  return httpRequest<{ ok: boolean; message: string }>("/api/smtp/test", {
    method: "POST",
    body: { email },
  });
}

export async function addUserQuota(userId: string, amount: number) {
  return httpRequest<{ item: AuthUser }>(`/api/users/${encodeURIComponent(userId)}/quota/add`, {
    method: "POST",
    body: { amount },
  });
}

export async function subtractUserQuota(userId: string, amount: number) {
  return httpRequest<{ item: AuthUser }>(`/api/users/${encodeURIComponent(userId)}/quota/subtract`, {
    method: "POST",
    body: { amount },
  });
}

export async function resetUserQuota(userId: string) {
  return httpRequest<{ item: AuthUser }>(`/api/users/${encodeURIComponent(userId)}/quota/reset`, {
    method: "POST",
    body: {},
  });
}

export async function fetchUsers() {
  return httpRequest<{ items: AuthUser[] }>("/api/users");
}

export async function createUser(email: string, password: string) {
  return httpRequest<{ item: AuthUser; items: AuthUser[] }>("/api/users", {
    method: "POST",
    body: { username: email, password, email },
  });
}

export async function setUserQuota(userId: string, quotaTotal: number) {
  return httpRequest<{ item: AuthUser }>(`/api/users/${encodeURIComponent(userId)}/quota`, {
    method: "POST",
    body: { quota_total: quotaTotal },
  });
}

export async function resetUserPassword(userId: string, password: string) {
  return httpRequest<{ item: AuthUser }>(`/api/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body: { password },
  });
}

export async function setUserEnabled(userId: string, enabled: boolean) {
  return httpRequest<{ item: AuthUser }>(`/api/users/${encodeURIComponent(userId)}/enabled`, {
    method: "POST",
    body: { enabled },
  });
}

export async function deleteUser(userId: string) {
  return httpRequest<{ ok: boolean; items: AuthUser[] }>(`/api/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export async function fetchThirdPartyApis() {
  return httpRequest<{ items: ThirdPartyApi[] }>("/api/third-party-apis");
}

export async function upsertThirdPartyApi(body: {
  id?: string;
  name: string;
  base_url: string;
  api_key?: string;
  models?: string[];
  enabled?: boolean;
  default?: boolean;
}) {
  return httpRequest<{ item: ThirdPartyApi; items: ThirdPartyApi[] }>("/api/third-party-apis", {
    method: "POST",
    body,
  });
}

export async function testThirdPartyApi(body: { name: string; base_url: string; api_key?: string }) {
  return httpRequest<{ result: { ok: boolean; status?: number; error?: string } }>("/api/third-party-apis/test", {
    method: "POST",
    body,
  });
}

export async function fetchThirdPartyModels(body: { name: string; base_url: string; api_key?: string }) {
  return httpRequest<{ result: { ok: boolean; models?: string[]; status?: number; error?: string } }>(
    "/api/third-party-apis/models",
    {
      method: "POST",
      body,
    },
  );
}

export async function deleteThirdPartyApi(apiId: string) {
  return httpRequest<{ ok: boolean; items: ThirdPartyApi[] }>(`/api/third-party-apis/${encodeURIComponent(apiId)}`, {
    method: "DELETE",
  });
}

export async function fetchGenerationRecords(limit = 200) {
  return httpRequest<{ items: GenerationRecord[] }>(`/api/records?limit=${limit}`);
}

// 拉取单条完整记录（保留参考图 dataUrl，跨环境补齐参考图时使用）
export async function fetchGenerationRecord(recordId: string) {
  return httpRequest<{ item: GenerationRecord }>(`/api/records/${encodeURIComponent(recordId)}`);
}

export async function upsertGenerationRecord(record: {
  id?: string;
  kind?: string;
  title?: string;
  payload?: unknown;
  created_at?: string;
  updated_at?: string;
}) {
  return httpRequest<{ item: GenerationRecord }>("/api/records", {
    method: "POST",
    body: record,
  });
}

export async function deleteGenerationRecord(recordId: string) {
  return httpRequest<{ ok: boolean }>(`/api/records/${encodeURIComponent(recordId)}`, {
    method: "DELETE",
  });
}

export async function clearGenerationRecords() {
  return httpRequest<{ ok: boolean; removed: number }>("/api/records", {
    method: "DELETE",
  });
}

export type UserKey = {
  id: string;
  name: string;
  role: "user";
  enabled: boolean;
  created_at: string | null;
  last_used_at: string | null;
};

export async function login(authKey: string) {
  const normalizedAuthKey = String(authKey || "").trim();
  return httpRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: {},
    headers: {
      Authorization: `Bearer ${normalizedAuthKey}`,
    },
    redirectOnUnauthorized: false,
  });
}

export async function fetchAccounts() {
  return httpRequest<AccountListResponse>("/api/accounts");
}

export async function fetchModels() {
  return httpRequest<ModelListResponse>("/v1/models");
}

export async function createAccounts(tokens: string[], accounts: AccountImportPayload[] = []) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "POST",
    body: { tokens, accounts },
  });
}

export type OAuthLoginStartResponse = {
  session_id: string;
  authorize_url: string;
  expires_in: string;
  redirect_uri_prefix: string;
};

export async function startOAuthLogin(emailHint?: string) {
  return httpRequest<OAuthLoginStartResponse>("/api/accounts/oauth/start", {
    method: "POST",
    body: { email_hint: emailHint ?? "" },
  });
}

export async function finishOAuthLogin(sessionId: string, callback: string) {
  return httpRequest<AccountMutationResponse>("/api/accounts/oauth/finish", {
    method: "POST",
    body: { session_id: sessionId, callback },
  });
}

export async function deleteAccounts(tokens: string[]) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "DELETE",
    body: { tokens },
  });
}

export async function refreshAccounts(accessTokens: string[]) {
  return httpRequest<{ progress_id: string }>("/api/accounts/refresh", {
    method: "POST",
    body: { access_tokens: accessTokens },
  });
}

export async function fetchRefreshProgress(progressId: string) {
  return httpRequest<RefreshProgressResponse>(`/api/accounts/refresh/progress/${progressId}`);
}

export async function reLoginAccounts(accessTokens: string[]) {
  return httpRequest<{ progress_id: string }>("/api/accounts/re-login", {
    method: "POST",
    body: { access_tokens: accessTokens },
  });
}

export async function fetchReLoginProgress(progressId: string) {
  return httpRequest<RefreshProgressResponse>(`/api/accounts/re-login/progress/${progressId}`);
}

export async function updateAccount(
  accessToken: string,
  updates: {
    type?: AccountType;
    status?: AccountStatus;
    quota?: number;
    proxy?: string;
  },
) {
  return httpRequest<AccountUpdateResponse>("/api/accounts/update", {
    method: "POST",
    body: {
      access_token: accessToken,
      ...updates,
    },
  });
}

export async function generateImage(prompt: string, model?: ImageModel, size?: string, quality = "auto") {
  return httpRequest<ImageResponse>(
    "/v1/images/generations",
    {
      method: "POST",
      body: {
        prompt,
        ...(model ? { model } : {}),
        ...(size ? { size } : {}),
        quality,
        n: 1,
        response_format: "b64_json",
      },
    },
  );
}

export async function editImage(files: File | File[], prompt: string, model?: ImageModel, size?: string, quality = "auto") {
  const formData = new FormData();
  const uploadFiles = Array.isArray(files) ? files : [files];

  uploadFiles.forEach((file) => {
    formData.append("image", file);
  });
  formData.append("prompt", prompt);
  if (model) {
    formData.append("model", model);
  }
  if (size) {
    formData.append("size", size);
  }
  formData.append("quality", quality);
  formData.append("n", "1");

  return httpRequest<ImageResponse>(
    "/v1/images/edits",
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function createImageGenerationTask(clientTaskId: string, prompt: string, model?: ImageModel, size?: string, quality = "auto") {
  return httpRequest<ImageTask>("/api/image-tasks/generations", {
    method: "POST",
    body: {
      client_task_id: clientTaskId,
      prompt,
      ...(model ? { model } : {}),
      ...(size ? { size } : {}),
      quality,
    },
  });
}

export async function createImageEditTask(
  clientTaskId: string,
  files: File | File[],
  prompt: string,
  model?: ImageModel,
  size?: string,
  quality = "auto",
) {
  const formData = new FormData();
  const uploadFiles = Array.isArray(files) ? files : [files];

  uploadFiles.forEach((file) => {
    formData.append("image", file);
  });
  formData.append("client_task_id", clientTaskId);
  formData.append("prompt", prompt);
  if (model) {
    formData.append("model", model);
  }
  if (size) {
    formData.append("size", size);
  }
  formData.append("quality", quality);

  return httpRequest<ImageTask>("/api/image-tasks/edits", {
    method: "POST",
    body: formData,
  });
}

export async function fetchImageTasks(ids: string[]) {
  const params = new URLSearchParams();
  if (ids.length > 0) {
    params.set("ids", ids.join(","));
  }
  params.set("_t", String(Date.now()));
  return httpRequest<ImageTaskListResponse>(`/api/image-tasks?${params.toString()}`);
}

// 用户取消自己的排队/进行中任务
export async function cancelImageTasks(taskIds: string[]) {
  return httpRequest<{ cancelled: number }>("/api/image-tasks/cancel", {
    method: "POST",
    body: { task_ids: taskIds },
  });
}

export type AdminImageTask = {
  id: string;
  status: string;
  mode: string;
  model?: string;
  size?: string;
  created_at: string;
  updated_at: string;
  owner_id?: string;
  cancel_reason?: string;
  progress?: string;
};

export async function fetchAdminImageTasks() {
  return httpRequest<{ items: AdminImageTask[] }>("/api/admin/image-tasks");
}

// 管理员批量/一键取消任务
export async function cancelAdminImageTasks(body: { task_ids?: string[]; all_tasks?: boolean }) {
  return httpRequest<{ cancelled: number }>("/api/admin/image-tasks/cancel", {
    method: "POST",
    body,
  });
}

export async function resumeImagePoll(taskId: string, extraTimeoutSecs = 30) {
  return httpRequest<ImageTask>(`/api/image-tasks/${encodeURIComponent(taskId)}/resume-poll`, {
    method: "POST",
    body: { extra_timeout_secs: extraTimeoutSecs },
  });
}

export async function fetchSettingsConfig() {
  return httpRequest<{ config: SettingsConfig }>("/api/settings");
}

export async function updateSettingsConfig(settings: SettingsConfig) {
  return httpRequest<{ config: SettingsConfig }>("/api/settings", {
    method: "POST",
    body: settings,
  });
}

export async function fetchThirdPartyApps() {
  return httpRequest<{ third_party_apps: ThirdPartyAppsSettings }>("/api/third-party-apps");
}

export async function testBackupConnection() {
  return httpRequest<{ result: { ok: boolean; status: number } }>("/api/backup/test", {
    method: "POST",
    body: {},
  });
}

export async function testImageStorageConnection() {
  return httpRequest<{ result: { ok: boolean; status: number; error?: string } }>("/api/image-storage/test", {
    method: "POST",
    body: {},
  });
}

export async function syncImageStorage() {
  return httpRequest<{ result: { uploaded: number; skipped: number; failed: number } }>("/api/image-storage/sync", {
    method: "POST",
    body: {},
  });
}

export async function fetchBackups() {
  return httpRequest<{ items: BackupItem[]; state: BackupState; settings: BackupSettings }>("/api/backups");
}

export async function runBackupNow() {
  return httpRequest<{ result: { key: string; size: number; encrypted: boolean } }>("/api/backups/run", {
    method: "POST",
    body: {},
  });
}

export async function deleteBackup(key: string) {
  return httpRequest<{ ok: boolean }>("/api/backups/delete", {
    method: "POST",
    body: { key },
  });
}

export async function fetchBackupDetail(key: string) {
  const params = new URLSearchParams();
  params.set("key", key);
  return httpRequest<{ item: BackupDetail }>(`/api/backups/detail?${params.toString()}`);
}

export function getBackupDownloadUrl(key: string) {
  const params = new URLSearchParams();
  params.set("key", key);
  return `/api/backups/download?${params.toString()}`;
}

export async function fetchManagedImages(filters: { start_date?: string; end_date?: string }) {
  const params = new URLSearchParams();
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);
  return httpRequest<{ items: ManagedImage[]; groups: Array<{ date: string; items: ManagedImage[] }> }>(
    `/api/images${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

export async function deleteManagedImages(body: { paths?: string[]; start_date?: string; end_date?: string; all_matching?: boolean }) {
  return httpRequest<{ removed: number }>("/api/images/delete", { method: "POST", body });
}

export async function downloadImages(paths: string[]) {
  const response = await request.post("/api/images/download", { paths }, { responseType: "blob" });
  const blob = response.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "images.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadSingleImage(path: string) {
  const response = await request.get(`/api/images/download/${path}`, { responseType: "blob" });
  const blob = response.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() || "image.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function fetchImageTags() {
  return httpRequest<{ tags: string[] }>("/api/images/tags");
}

export async function setImageTags(path: string, tags: string[]) {
  return httpRequest<{ ok: boolean; tags: string[] }>("/api/images/tags", {
    method: "POST",
    body: { path, tags },
  });
}

export async function deleteImageTag(tag: string) {
  return httpRequest<{ ok: boolean; removed_from: number }>(`/api/images/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
}

export type ImageStorageStats = {
  disk_total_mb: number; disk_used_mb: number; disk_free_mb: number;
  image_count: number; image_size_mb: number; image_size_bytes: number;
};

export async function fetchImageStorage() {
  return httpRequest<ImageStorageStats>("/api/images/storage");
}

// ── 公告 ─────────────────────────────────────────────
export type PublicAnnouncement = {
  popup: { title: string; content: string } | null;
  banner: { title: string; content: string; link: string } | null;
};

export type AnnouncementConfig = {
  popup: { title: string; content: string; link: string; enabled: boolean; updated_at: string };
  banner: { title: string; content: string; link: string; enabled: boolean; updated_at: string };
};

export async function fetchPublicAnnouncements() {
  return httpRequest<PublicAnnouncement>("/api/public-announcements");
}

export async function fetchAdminAnnouncements() {
  return httpRequest<AnnouncementConfig>("/api/admin/announcements");
}

export async function saveAdminAnnouncements(body: {
  popup: { title: string; content: string; link?: string; enabled: boolean };
  banner: { title: string; content: string; link: string; enabled: boolean };
}) {
  return httpRequest<AnnouncementConfig>("/api/admin/announcements", { method: "POST", body });
}

export async function compressAllImages() {
  return httpRequest<{ compressed: number; saved_bytes: number; saved_mb: number }>("/api/images/storage/compress", { method: "POST" });
}

export async function deleteToTarget(targetFreeMb: number) {
  return httpRequest<{ removed: number; freed_mb: number; done: boolean }>(
    `/api/images/storage/cleanup-to-target?target_free_mb=${targetFreeMb}&dry_run=false`,
    { method: "POST" },
  );
}

export async function fetchSystemLogs(filters: { type?: string; start_date?: string; end_date?: string }) {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);
  return httpRequest<{ items: SystemLog[] }>(`/api/logs${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function deleteSystemLogs(ids: string[]) {
  return httpRequest<{ removed: number }>("/api/logs/delete", {
    method: "POST",
    body: { ids },
  });
}

export async function fetchUserKeys() {
  return httpRequest<{ items: UserKey[] }>("/api/auth/users");
}

export async function createUserKey(name: string) {
  return httpRequest<{ item: UserKey; key: string; items: UserKey[] }>("/api/auth/users", {
    method: "POST",
    body: { name },
  });
}

export async function updateUserKey(keyId: string, updates: { enabled?: boolean; name?: string; key?: string }) {
  return httpRequest<{ item: UserKey; items: UserKey[] }>(`/api/auth/users/${keyId}`, {
    method: "POST",
    body: updates,
  });
}

export async function deleteUserKey(keyId: string) {
  return httpRequest<{ items: UserKey[] }>(`/api/auth/users/${keyId}`, {
    method: "DELETE",
  });
}

// ── CPA (CLIProxyAPI) ──────────────────────────────────────────────

export type CPAPool = {
  id: string;
  name: string;
  base_url: string;
  import_job?: CPAImportJob | null;
};

export type CPARemoteFile = {
  name: string;
  email: string;
};

export type CPAImportJob = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  total: number;
  completed: number;
  added: number;
  skipped: number;
  refreshed: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
};

export async function fetchCPAPools() {
  return httpRequest<{ pools: CPAPool[] }>("/api/cpa/pools");
}

export async function createCPAPool(pool: { name: string; base_url: string; secret_key: string }) {
  return httpRequest<{ pool: CPAPool; pools: CPAPool[] }>("/api/cpa/pools", {
    method: "POST",
    body: pool,
  });
}

export async function updateCPAPool(
  poolId: string,
  updates: { name?: string; base_url?: string; secret_key?: string },
) {
  return httpRequest<{ pool: CPAPool; pools: CPAPool[] }>(`/api/cpa/pools/${poolId}`, {
    method: "POST",
    body: updates,
  });
}

export async function deleteCPAPool(poolId: string) {
  return httpRequest<{ pools: CPAPool[] }>(`/api/cpa/pools/${poolId}`, {
    method: "DELETE",
  });
}

export async function fetchCPAPoolFiles(poolId: string) {
  return httpRequest<{ pool_id: string; files: CPARemoteFile[] }>(`/api/cpa/pools/${poolId}/files`);
}

export async function startCPAImport(poolId: string, names: string[]) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/cpa/pools/${poolId}/import`, {
    method: "POST",
    body: { names },
  });
}

export async function fetchCPAPoolImportJob(poolId: string) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/cpa/pools/${poolId}/import`);
}

// ── Sub2API ────────────────────────────────────────────────────────

export type Sub2APIServer = {
  id: string;
  name: string;
  base_url: string;
  email: string;
  has_api_key: boolean;
  group_id: string;
  import_job?: CPAImportJob | null;
};

export type Sub2APIRemoteAccount = {
  id: string;
  name: string;
  email: string;
  plan_type: string;
  status: string;
  expires_at: string;
  has_refresh_token: boolean;
};

export type Sub2APIRemoteGroup = {
  id: string;
  name: string;
  description: string;
  platform: string;
  status: string;
  account_count: number;
  active_account_count: number;
};

export async function fetchSub2APIServers() {
  return httpRequest<{ servers: Sub2APIServer[] }>("/api/sub2api/servers");
}

export async function createSub2APIServer(server: {
  name: string;
  base_url: string;
  email: string;
  password: string;
  api_key: string;
  group_id: string;
}) {
  return httpRequest<{ server: Sub2APIServer; servers: Sub2APIServer[] }>("/api/sub2api/servers", {
    method: "POST",
    body: server,
  });
}

export async function updateSub2APIServer(
  serverId: string,
  updates: {
    name?: string;
    base_url?: string;
    email?: string;
    password?: string;
    api_key?: string;
    group_id?: string;
  },
) {
  return httpRequest<{ server: Sub2APIServer; servers: Sub2APIServer[] }>(`/api/sub2api/servers/${serverId}`, {
    method: "POST",
    body: updates,
  });
}

export async function fetchSub2APIServerGroups(serverId: string) {
  return httpRequest<{ server_id: string; groups: Sub2APIRemoteGroup[] }>(
    `/api/sub2api/servers/${serverId}/groups`,
  );
}

export async function deleteSub2APIServer(serverId: string) {
  return httpRequest<{ servers: Sub2APIServer[] }>(`/api/sub2api/servers/${serverId}`, {
    method: "DELETE",
  });
}

export async function fetchSub2APIServerAccounts(serverId: string) {
  return httpRequest<{ server_id: string; accounts: Sub2APIRemoteAccount[] }>(
    `/api/sub2api/servers/${serverId}/accounts`,
  );
}

export async function startSub2APIImport(serverId: string, accountIds: string[]) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/sub2api/servers/${serverId}/import`, {
    method: "POST",
    body: { account_ids: accountIds },
  });
}

export async function fetchSub2APIImportJob(serverId: string) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/sub2api/servers/${serverId}/import`);
}

// ── Upstream proxy ────────────────────────────────────────────────

export type ProxySettings = {
  enabled: boolean;
  url: string;
};

export type ProxyTestResult = {
  ok: boolean;
  status: number;
  latency_ms: number;
  error: string | null;
  proxy_source?: string;
  has_proxy?: boolean;
};

export type ClearanceTestResult = {
  ok: boolean;
  status: string;
  latency_ms: number;
  has_cookies: boolean;
  user_agent: string;
  error: string | null;
  runtime: ProxyRuntimeStatus;
};

export async function fetchProxy() {
  return httpRequest<{ proxy: ProxySettings }>("/api/proxy");
}

export async function updateProxy(updates: { enabled?: boolean; url?: string }) {
  return httpRequest<{ proxy: ProxySettings }>("/api/proxy", {
    method: "POST",
    body: updates,
  });
}

export async function testProxy(url?: string) {
  return httpRequest<{ result: ProxyTestResult }>("/api/proxy/test", {
    method: "POST",
    body: { url: url ?? "" },
  });
}

export async function fetchProxyRuntime() {
  return httpRequest<ProxyRuntimeResponse>("/api/proxy/runtime");
}

export async function updateProxyRuntime(runtime: ProxyRuntimeSettings) {
  return httpRequest<ProxyRuntimeResponse>("/api/proxy/runtime", {
    method: "POST",
    body: runtime,
  });
}

export async function testProxyClearance(targetUrl?: string) {
  return httpRequest<{ result: ClearanceTestResult }>("/api/proxy/clearance/test", {
    method: "POST",
    body: { target_url: targetUrl ?? "https://chatgpt.com" },
  });
}
