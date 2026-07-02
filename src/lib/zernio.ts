// Client da Zernio (docs.zernio.com) — publicação e agendamento dos posts.

const BASE = "https://zernio.com/api/v1";

function headers(): Record<string, string> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error("ZERNIO_API_KEY ausente");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export class ZernioError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function zfetch<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const h = headers();
  if (init?.idempotencyKey) h["x-request-id"] = init.idempotencyKey;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: h, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ZernioError(
      `Zernio ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 300)}`,
      res.status,
      body
    );
  }
  return (await res.json()) as T;
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  displayName: string;
  enabled: boolean;
  platformStatus: string;
  profileId?: { _id: string; name: string } | string;
}

export async function listAccounts(): Promise<ZernioAccount[]> {
  const data = await zfetch<{ accounts: ZernioAccount[] }>("/accounts");
  return data.accounts ?? [];
}

// Contas do perfil pessoal do Victor (X/LinkedIn), criado em 2026-07-02.
export async function personalAccounts(): Promise<{ twitter?: ZernioAccount; linkedin?: ZernioAccount }> {
  const profileId = process.env.ZERNIO_PROFILE_ID;
  const accounts = await listAccounts();
  const mine = accounts.filter((a) => {
    const pid = typeof a.profileId === "string" ? a.profileId : a.profileId?._id;
    return !profileId || pid === profileId;
  });
  return {
    twitter: mine.find((a) => a.platform === "twitter" && a.enabled),
    linkedin: mine.find((a) => a.platform === "linkedin" && a.enabled),
  };
}

export async function connectUrl(platform: "twitter" | "linkedin"): Promise<string> {
  const profileId = process.env.ZERNIO_PROFILE_ID ?? "";
  const data = await zfetch<{ authUrl: string }>(`/connect/${platform}?profileId=${profileId}`);
  return data.authUrl;
}

export interface ZernioPostResult {
  post: {
    _id: string;
    status: string;
    scheduledFor?: string;
    platforms?: { platform: string; status: string; platformPostUrl?: string }[];
  };
}

export async function createPost(opts: {
  content: string;
  platform: "twitter" | "linkedin";
  accountId?: string;
  scheduledForISO?: string; // UTC ISO — se ausente e isDraft=false, publica na hora
  isDraft?: boolean;
  idempotencyKey?: string;
}): Promise<ZernioPostResult> {
  const body: Record<string, unknown> = {
    content: opts.content,
    timezone: "UTC",
  };
  if (opts.isDraft) {
    body.isDraft = true;
  } else {
    body.platforms = [{ platform: opts.platform, accountId: opts.accountId }];
    if (opts.scheduledForISO) body.scheduledFor = opts.scheduledForISO;
    else body.publishNow = true;
  }
  return zfetch<ZernioPostResult>("/posts", {
    method: "POST",
    body: JSON.stringify(body),
    idempotencyKey: opts.idempotencyKey,
  });
}

export async function getPost(id: string): Promise<ZernioPostResult> {
  return zfetch<ZernioPostResult>(`/posts/${id}`);
}

export async function updatePostContent(id: string, content: string): Promise<unknown> {
  // a API da Zernio expõe PUT (não PATCH) em /posts/{id}; aceita body parcial
  return zfetch(`/posts/${id}`, { method: "PUT", body: JSON.stringify({ content }) });
}

export async function deletePost(id: string): Promise<void> {
  await zfetch(`/posts/${id}`, { method: "DELETE" });
}
