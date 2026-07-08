import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { listPrompts, PROMPT_KEYS, PromptKey, resetPrompt, setPromptOverride } from "@/lib/overrides";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ prompts: await listPrompts() });
}

export async function PUT(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { key?: string; md?: string } | null;
  if (!body?.key || !(body.key in PROMPT_KEYS)) return NextResponse.json({ error: "key inválida" }, { status: 400 });
  if (typeof body.md !== "string" || body.md.trim().length < 20) {
    return NextResponse.json({ error: "conteúdo curto demais (mín 20 chars) — pra voltar ao padrão use restaurar" }, { status: 400 });
  }
  await setPromptOverride(body.key as PromptKey, body.md);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !(key in PROMPT_KEYS)) return NextResponse.json({ error: "key inválida" }, { status: 400 });
  await resetPrompt(key as PromptKey);
  return NextResponse.json({ ok: true, restaurado: key });
}
