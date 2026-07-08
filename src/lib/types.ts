export type Idioma = "pt" | "en";
export type Objetivo = "alcance" | "bookmark" | "prova" | "seguidor" | "momento" | "produto" | "oferta";
export type Janela = "almoco" | "tarde";
export type Platform = "twitter" | "linkedin";

export interface Fato {
  texto: string;
  fonte: string;
  origem: "inbox" | "trend" | "banco";
}

export interface InboxItem {
  id: string;
  texto: string;
  mediaUrl?: string; // print/imagem anexada (URL pública no Blob)
  mediaDescricao?: string; // leitura da imagem pelo modelo (preenchida no gather)
}

export interface Pauta {
  id: string;
  pilar: 1 | 2 | 3 | 4 | 5;
  objetivo: Objetivo;
  mov: string;
  idioma: Idioma;
  fato: Fato;
  angulo: string;
  forma?: "F1" | "F2" | "F3" | "F4" | "F5"; // forma do post (registro-real) — rotacionada pelo pauteiro
  inbox_media_id?: string | null; // id do item do inbox cujo print sai anexado no post
}

export interface Draft {
  pautaId: string;
  texto: string;
  seedDescartada?: string;
}

export interface Finalista {
  id: string;
  texto: string;
  score: number;
  mudancas: string;
}

export interface Morto {
  id: string;
  motivo: string;
}

export interface Selecionado {
  id: string;
  rank: number;
  janela: Janela;
  motivo: string;
}

export interface ScheduledPost {
  pautaId: string;
  texto: string;
  platform: Platform;
  scheduledForISO: string;
  zernioPostId?: string;
  status: "scheduled" | "draft" | "failed" | "killed";
  erro?: string;
  mediaUrl?: string; // imagem anexada ao post (quando a pauta veio de print do inbox)
}

export interface TrendItem {
  texto: string;
  autor: string;
  url?: string;
  metricas?: string;
}

export interface GatherResult {
  inbox: InboxItem[];
  trends: TrendItem[];
  facts: { id: string; fato: string; fonte: string }[];
  historico: string[]; // textos publicados/agendados nos últimos 7 dias (anti-repetição)
  voiceAnchors: string[]; // tweets reais recentes do Victor (âncora viva do gate cego)
  lessons: string[]; // lições acumuladas: padrões que o crítico matou em runs anteriores
}

export type RunStage =
  | "gather"
  | "pautas"
  | "drafts"
  | "critico"
  | "regen"
  | "editor"
  | "agendar"
  | "notificar"
  | "done"
  | "error";

export interface RunState {
  id: string; // run-YYYY-MM-DD[-hhmm]
  date: string; // YYYY-MM-DD (BRT)
  stage: RunStage;
  mode: "auto" | "review";
  startedAt: string;
  updatedAt: string;
  insumos?: GatherResult;
  pautas?: Pauta[];
  drafts?: Draft[];
  finalistas?: Finalista[];
  mortos?: Morto[];
  selecionados?: Selecionado[];
  scheduled?: ScheduledPost[];
  error?: string;
  failedStage?: RunStage; // estágio em que o erro aconteceu (pra retomada)
  processingUntil?: string; // lease: evita 2 processadores no mesmo run
  log: string[];
}

export interface AppConfig {
  paused: boolean;
  mode: "auto" | "review";
  postsPerDay: number; // teto, não meta
  ptShare: number; // 0..1 — fração de pautas em PT (idioma único por post)
  windows: { almoco: [number, number]; tarde: [number, number] }; // horas BRT
  channels: {
    x: { enabled: boolean; accountId?: string };
    linkedin: { enabled: boolean; accountId?: string };
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  paused: false,
  mode: "auto",
  postsPerDay: 5,
  ptShare: 0.8,
  windows: { almoco: [11, 14], tarde: [17, 20] },
  channels: {
    x: { enabled: true },
    linkedin: { enabled: false },
  },
};
