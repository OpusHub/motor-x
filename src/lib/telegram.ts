import { getJSON, putJSON } from "./store";

// Notificações pro Victor (bot principal) + leitura do inbox de ideias (bot @inbox_content_opusbot).

const API = "https://api.telegram.org";

export async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // notificação é best-effort, nunca derruba o pipeline
  try {
    await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(chatId), text, disable_web_page_preview: true }),
    });
  } catch {
    // best-effort
  }
}

interface TgUpdate {
  update_id: number;
  message?: { text?: string; caption?: string; chat: { id: number } };
}

// Lê mensagens novas do bot de inbox (braindump do dia). Só texto/caption — áudio
// é ignorado no serverless (o Victor pode mandar texto ou usar o inbox do dashboard).
// Só aceita mensagens do chat do Victor: o bot é público e sem esse filtro qualquer
// pessoa injetaria conteúdo num pipeline que publica sozinho.
export async function readInbox(): Promise<string[]> {
  const token = process.env.TELEGRAM_INBOX_BOT_TOKEN;
  const allowedChat = Number(process.env.TELEGRAM_INBOX_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID ?? 0);
  if (!token || !allowedChat) return [];
  try {
    const state = (await getJSON<{ offset: number }>("state/telegram-inbox-offset.json")) ?? { offset: 0 };
    const res = await fetch(`${API}/bot${token}/getUpdates?offset=${state.offset + 1}&timeout=0`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { ok: boolean; result: TgUpdate[] };
    if (!data.ok || data.result.length === 0) return [];
    const texts = data.result
      .filter((u) => u.message?.chat.id === allowedChat)
      .map((u) => u.message?.text ?? u.message?.caption ?? "")
      .filter((t) => t.length > 0);
    // avança o offset com TODOS os updates (inclusive descartados) pra não reprocessar spam
    const maxId = Math.max(...data.result.map((u) => u.update_id));
    await putJSON("state/telegram-inbox-offset.json", { offset: maxId });
    return texts;
  } catch {
    return [];
  }
}
