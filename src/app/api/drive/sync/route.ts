import { NextRequest, NextResponse } from "next/server";
import { isCronAuthed, isDashboardAuthed } from "@/lib/auth";
import { driveEnabled, driveStatus, driveSync } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sync manual da pasta do Drive (dashboard) ou via automação (x-run-secret).
// O pipeline também sincroniza sozinho no gather; esta rota é pro Victor forçar
// o puxão sem esperar o cron.
export async function POST(req: NextRequest) {
  if (!isDashboardAuthed(req) && !isCronAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await driveSync();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message.slice(0, 300) : String(err) },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  if (!isDashboardAuthed(req) && !isCronAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = await driveStatus();
  return NextResponse.json({
    enabled: driveEnabled(),
    folder: !!process.env.GDRIVE_FOLDER_ID,
    lastSyncISO: status.lastSyncISO ?? null,
    processados: status.processados,
  });
}
