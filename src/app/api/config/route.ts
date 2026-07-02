import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { loadConfig, saveConfig } from "@/lib/config";
import { AppConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ config: await loadConfig() });
}

export async function PUT(req: NextRequest) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const patch = (await req.json().catch(() => ({}))) as Partial<AppConfig>;
  const current = await loadConfig();
  const next: AppConfig = {
    ...current,
    ...patch,
    postsPerDay: Math.max(1, Math.min(8, patch.postsPerDay ?? current.postsPerDay)),
    windows: { ...current.windows, ...patch.windows },
    channels: {
      x: { ...current.channels.x, ...patch.channels?.x },
      linkedin: { ...current.channels.linkedin, ...patch.channels?.linkedin },
    },
  };
  await saveConfig(next);
  return NextResponse.json({ config: next });
}
