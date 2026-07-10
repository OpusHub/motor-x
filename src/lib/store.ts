import { del as blobDel, list, put } from "@vercel/blob";

// Armazenamento JSON sobre Vercel Blob.
// - Paths prefixados com BLOB_PATH_SECRET: o store é público, o segredo no path
//   impede leitura por URL adivinhável.
// - Leituras com cache-bust (query única): o edge cache do Blob segura conteúdo
//   stale por ~60s, o que quebraria o handoff da chain (ler o run recém-salvo).
// - getJSON/existsPath usam URL DETERMINÍSTICA (sem list()): o Blob do Vercel
//   serve qualquer path conhecido em https://<storeId>.public.blob.vercel-storage.com/<path>
//   com addRandomSuffix:false. list()/del() contam como "Advanced Operation"
//   (cota de 2.000/mês no Hobby) — em 10/jul o motor estourou 2.051 porque
//   getJSON fazia list() em TODA leitura (config, lições, prompts, cada
//   chamada). Ler por URL é 1 fetch HTTP comum: zero custo de cota.

function prefix(path: string): string {
  const secret = process.env.BLOB_PATH_SECRET;
  return secret ? `${secret}/${path}` : path;
}

let cachedStoreId: string | null | undefined;

// extrai o id do store do próprio token (formato vercel_blob_rw_<storeId>_<random>)
// — evita 1 chamada de rede só pra descobrir o host do CDN.
function storeId(): string | null {
  if (cachedStoreId !== undefined) return cachedStoreId;
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const match = token.match(/^vercel_blob_rw_([a-zA-Z0-9]+)_/);
  cachedStoreId = match ? match[1] : null;
  return cachedStoreId;
}

function deterministicUrl(path: string): string | null {
  const id = storeId();
  return id ? `https://${id}.public.blob.vercel-storage.com/${prefix(path)}` : null;
}

// Upload binário (imagens do inbox). Retorna a URL pública — a Zernio baixa
// daqui na hora de publicar, e o dashboard usa pra thumbnail.
// SEM prefix(): a URL da mídia circula fora (Zernio/X) e não pode carregar o
// BLOB_PATH_SECRET no caminho. A entropia do nome (uuid) já protege o arquivo.
export async function putBinary(path: string, data: ArrayBuffer, contentType: string): Promise<string> {
  const blob = await put(`public-media/${path}`, data, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });
  return blob.url;
}

export async function putJSON(path: string, data: unknown): Promise<void> {
  await put(prefix(path), JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60, // mínimo permitido; leituras fazem cache-bust
  });
}

async function fetchFresh<T>(url: string): Promise<T | null> {
  const bust = `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(bust, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function getJSON<T>(path: string): Promise<T | null> {
  const direct = deterministicUrl(path);
  if (direct) {
    const data = await fetchFresh<T>(direct);
    if (data !== null) return data;
    // path pode não existir (404 tratado acima) OU o token não bate o padrão
    // esperado — list() é o fallback correto, não o caminho comum
  }
  const full = prefix(path);
  const { blobs } = await list({ prefix: full, limit: 1 });
  const blob = blobs.find((b) => b.pathname === full);
  if (!blob) return null;
  return fetchFresh<T>(blob.url);
}

// Continua usando list() de propósito: listar um DIRETÓRIO (múltiplos arquivos
// desconhecidos) não tem como virar URL determinística. Usar com moderação —
// isto SIM consome a cota de Advanced Operations.
export async function listJSON<T>(pathPrefix: string, limit = 100): Promise<{ path: string; data: T }[]> {
  const secret = process.env.BLOB_PATH_SECRET;
  const { blobs } = await list({ prefix: prefix(pathPrefix), limit });
  const out: { path: string; data: T }[] = [];
  await Promise.all(
    blobs.map(async (b) => {
      try {
        const data = await fetchFresh<T>(b.url);
        if (data !== null) {
          const cleanPath = secret ? b.pathname.replace(`${secret}/`, "") : b.pathname;
          out.push({ path: cleanPath, data });
        }
      } catch {
        // arquivo corrompido não derruba a listagem
      }
    })
  );
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// Remove um JSON do store (ex: override de prompt restaurado pro padrão).
export async function del(path: string): Promise<void> {
  const found = await list({ prefix: prefix(path), limit: 1 });
  if (found.blobs[0]) await blobDel(found.blobs[0].url);
}
