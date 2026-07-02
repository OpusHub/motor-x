import { NextRequest, NextResponse } from "next/server";
import { isDashboardAuthed } from "@/lib/auth";
import { connectUrl } from "@/lib/zernio";

export const dynamic = "force-dynamic";

// Gera link OAuth fresco da Zernio pro Victor conectar a conta (X/LinkedIn).
export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  if (!isDashboardAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { platform } = await ctx.params;
  if (platform !== "twitter" && platform !== "linkedin") {
    return NextResponse.json({ error: "plataforma inválida" }, { status: 400 });
  }
  try {
    const url = await connectUrl(platform);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
