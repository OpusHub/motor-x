import { AppConfig, Selecionado } from "@/lib/types";

// Cálculo determinístico de horários (código, não LLM).
// BRT = UTC-3 fixo (sem horário de verão desde 2019).

const BRT_OFFSET_HOURS = 3;
const MIN_SPACING_MIN = 70;

function seededJitter(key: string, rangeMin: number): number {
  let h = 2166136261;
  for (const c of key) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return (h % (rangeMin * 2 + 1)) - rangeMin; // [-range, +range]
}

function brtToUTC(dateBRT: string, hour: number, minute: number): Date {
  const [y, m, d] = dateBRT.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + BRT_OFFSET_HOURS, minute));
}

function baseTimes(window: [number, number], count: number): { hour: number; minute: number }[] {
  const [start, end] = window;
  const spanMin = (end - start) * 60;
  const out: { hour: number; minute: number }[] = [];
  for (let i = 0; i < count; i++) {
    const offset = Math.round(((i + 0.5) / count) * spanMin);
    out.push({ hour: start + Math.floor(offset / 60), minute: offset % 60 });
  }
  return out;
}

// Retorna mapa pautaId -> ISO UTC. Respeita janela sugerida pelo editor,
// espaçamento mínimo e nunca agenda pro passado (buffer de 25min).
export function computeSlots(
  dateBRT: string,
  selecionados: Selecionado[],
  config: AppConfig
): Map<string, string> {
  const byJanela = {
    almoco: selecionados.filter((s) => s.janela === "almoco").sort((a, b) => a.rank - b.rank),
    tarde: selecionados.filter((s) => s.janela === "tarde").sort((a, b) => a.rank - b.rank),
  };

  const slots: { id: string; when: Date }[] = [];
  for (const janela of ["almoco", "tarde"] as const) {
    const items = byJanela[janela];
    if (items.length === 0) continue;
    const times = baseTimes(config.windows[janela], items.length);
    items.forEach((s, i) => {
      const jitter = seededJitter(`${dateBRT}-${s.id}`, 9);
      const t = times[i];
      const totalMin = t.hour * 60 + t.minute + jitter;
      slots.push({ id: s.id, when: brtToUTC(dateBRT, Math.floor(totalMin / 60), ((totalMin % 60) + 60) % 60) });
    });
  }

  // ordena, aplica "nunca no passado" e espaçamento mínimo
  slots.sort((a, b) => a.when.getTime() - b.when.getTime());
  const floor = Date.now() + 25 * 60 * 1000;
  let prev = 0;
  for (const slot of slots) {
    let t = Math.max(slot.when.getTime(), floor);
    if (prev > 0 && t - prev < MIN_SPACING_MIN * 60 * 1000) {
      t = prev + MIN_SPACING_MIN * 60 * 1000;
    }
    slot.when = new Date(t);
    prev = t;
  }

  return new Map(slots.map((s) => [s.id, s.when.toISOString()]));
}

export function todayBRT(now = new Date()): string {
  const brt = new Date(now.getTime() - BRT_OFFSET_HOURS * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}
