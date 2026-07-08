import { createSign } from "node:crypto";
import { getJSON, putJSON } from "./store";
import { InboxItem } from "./types";
import { todayBRT } from "@/pipeline/schedule";

// Integração Google Drive SEM SDK: REST puro + JWT de service account assinado
// com node:crypto. O Victor tem uma pasta no Drive onde caem os transcripts das
// dailies; o motor puxa os arquivos NOVOS e injeta no inbox do dia como [DAILY].
// Zero dependência nova: o SDK oficial pesa MB e só usamos 3 endpoints.

const STATE_PATH = "state/drive-sync.json";
const MAX_FILE_BYTES = 300 * 1024; // transcript gigante não vira pauta boa
const MAX_TEXT_CHARS = 6000;
const PROCESSED_CAP = 200;

interface DriveState {
  processedIds: string[];
  lastSyncISO?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string; // a API do Drive devolve size como string
}

export interface DriveSyncResult {
  enabled: boolean;
  novos: number;
  nomes: string[];
}

function envs(): { email: string; key: string; folderId: string } | null {
  const email = process.env.GDRIVE_SA_EMAIL;
  const key = process.env.GDRIVE_SA_PRIVATE_KEY;
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!email || !key || !folderId) return null;
  // a Vercel salva o PEM com \n escapados numa linha só; sem normalizar, o
  // createSign rejeita a chave
  return { email, key: key.replace(/\\n/g, "\n"), folderId };
}

export function driveEnabled(): boolean {
  return envs() !== null;
}

// ---- token: JWT RS256 assinado na mão + troca por access token ----

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

// cache em módulo: a instância serverless costuma sobreviver várias invocações
// e o token vale 1h, então pedir um novo a cada sync é round-trip jogado fora
let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const cfg = envs();
  if (!cfg) throw new Error("drive: envs ausentes");
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: cfg.email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(cfg.key).toString("base64url");
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`drive: token falhou (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { access_token: string };
  // 55min de cache (o token vale 60): margem pra nunca usar token vencido no meio do sync
  cachedToken = { token: data.access_token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return data.access_token;
}

// ---- listar e baixar ----

async function listFiles(token: string, folderId: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    orderBy: "modifiedTime desc",
    pageSize: "20",
    fields: "files(id,name,mimeType,modifiedTime,size)",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`drive: list falhou (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

const TEXT_EXT = /\.(txt|vtt|srt|md)$/i;

// decide como baixar cada arquivo; null = tipo que não interessa (pular)
function downloadUrl(file: DriveFile): string | null {
  // Google Doc não tem bytes — só existe via export
  if (file.mimeType === "application/vnd.google-apps.document") {
    return `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
  }
  // texto puro, ou binário genérico com nome de transcript (o Meet às vezes
  // sobe .vtt como octet-stream)
  const isText = file.mimeType.startsWith("text/");
  const isOctetTranscript = file.mimeType === "application/octet-stream" && TEXT_EXT.test(file.name);
  if (isText || isOctetTranscript) {
    return `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  }
  return null;
}

async function downloadText(token: string, url: string): Promise<string> {
  // o timeout cobre a request E a leitura do body (o signal aborta o stream)
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`drive: download falhou (${res.status})`);
  return res.text();
}

// ---- limpeza do texto ----

// VTT/SRT: o pauteiro quer a FALA, não a marcação. Timestamps e números de
// cue só queimam os 6000 chars do corte
function stripCues(texto: string): string {
  return texto
    .replace(/^WEBVTT.*$/gm, "")
    .replace(/^\d+\s*$/gm, "") // número de cue do SRT
    .replace(/^.*\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}[:.]\d{2}[.,]\d{3}.*$/gm, "");
}

function cleanText(texto: string, name: string): string {
  let t = texto;
  if (/\.(vtt|srt)$/i.test(name)) t = stripCues(t);
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > MAX_TEXT_CHARS) t = t.slice(0, MAX_TEXT_CHARS) + "...";
  return t;
}

// ---- sync ----

// Puxa arquivos novos da pasta e injeta no inbox do dia como [DAILY].
// `date` = dia do inbox alvo (o run passa run.date pra não vazar material pro
// dia seguinte se o gather atravessar a meia-noite); default = hoje BRT.
// Envs ausentes: no-op silencioso (o motor roda igual sem Drive configurado).
export async function driveSync(date?: string): Promise<DriveSyncResult> {
  const cfg = envs();
  if (!cfg) return { enabled: false, novos: 0, nomes: [] };

  const token = await accessToken();
  const files = await listFiles(token, cfg.folderId);

  const state = (await getJSON<DriveState>(STATE_PATH)) ?? { processedIds: [] };
  const processed = new Set(state.processedIds);

  const novos: InboxItem[] = [];
  const nomes: string[] = [];
  for (const file of files) {
    if (processed.has(file.id)) continue;
    const url = downloadUrl(file);
    if (!url) {
      // mimeType que não vira texto (imagem, planilha...): marca como visto
      // pra não reavaliar a cada sync
      processed.add(file.id);
      continue;
    }
    if (file.size && Number(file.size) > MAX_FILE_BYTES) {
      processed.add(file.id);
      continue;
    }
    let conteudo: string;
    try {
      conteudo = cleanText(await downloadText(token, url), file.name);
    } catch {
      // download falhou: NÃO marca como processado, tenta de novo no próximo sync
      continue;
    }
    processed.add(file.id);
    if (!conteudo) continue;
    novos.push({
      // 12 chars do id do Drive: quase todos começam com "1", então 8 dava
      // pouca entropia real pro dedup abaixo
      id: `drv${file.id.slice(0, 12)}`,
      texto: `[DAILY ${file.name}] ${conteudo}`,
    });
    nomes.push(file.name);
  }

  if (novos.length > 0) {
    const inboxPath = `inbox/${date ?? todayBRT()}.json`;
    const items = (await getJSON<(string | InboxItem)[]>(inboxPath)) ?? [];
    // dedup por id: se o write do state falhou no sync anterior (inbox gravado,
    // state não), o retry NÃO duplica o mesmo transcript no inbox
    const existentes = new Set(items.map((it) => (typeof it === "string" ? "" : it.id)));
    const ineditos = novos.filter((n) => !existentes.has(n.id));
    if (ineditos.length > 0) await putJSON(inboxPath, [...items, ...ineditos]);
  }

  await putJSON(STATE_PATH, {
    processedIds: [...processed].slice(-PROCESSED_CAP),
    lastSyncISO: new Date().toISOString(),
  } satisfies DriveState);

  return { enabled: true, novos: novos.length, nomes };
}

// Versão pra rodar DENTRO do pipeline: falha do Drive nunca pode derrubar o
// run do dia (o gather segue com o resto dos insumos)
export async function driveSyncSafe(date?: string): Promise<DriveSyncResult> {
  try {
    return await driveSync(date);
  } catch (err) {
    console.error("drive-sync falhou:", err instanceof Error ? err.message : err);
    return { enabled: driveEnabled(), novos: 0, nomes: [] };
  }
}

// Estado pro GET da rota (dashboard mostra se o Drive tá ligado e sincronizando)
export async function driveStatus(): Promise<{ enabled: boolean; lastSyncISO?: string; processados: number }> {
  // sem envs: no-op de verdade — nem toca o Blob (quem não configurou Drive
  // não paga round-trip nem corre risco de erro aqui)
  if (!driveEnabled()) return { enabled: false, processados: 0 };
  const state = await getJSON<DriveState>(STATE_PATH);
  return {
    enabled: driveEnabled(),
    lastSyncISO: state?.lastSyncISO,
    processados: state?.processedIds.length ?? 0,
  };
}
