"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentesView, DicionarioView, FatosBlock } from "./voz-client";
import type { AppConfig, InboxItem, RunStage, ScheduledPost } from "@/lib/types";

// ---------- tipos da API ----------

type StoredPost = ScheduledPost & { score?: number; feedback?: "gostei" | "nao_sou_eu" };

interface RunInfo {
  id: string;
  stage: RunStage;
  error?: string;
  log: string[];
  mode: "auto" | "review";
  previa?: {
    drafts: { id: string; texto: string }[];
    finalistas: { id: string; texto: string; score: number }[];
    mortos: { id: string; motivo: string }[];
  };
}

interface PostsData {
  date: string;
  posts: StoredPost[];
  run: RunInfo | null;
}

interface StatusData {
  config: AppConfig;
  accounts: { twitter: string | null; linkedin: string | null };
}

// PUT /api/config aceita patch com channels parciais (merge no server).
type ConfigPatch = Partial<Omit<AppConfig, "channels">> & {
  channels?: {
    x?: { enabled?: boolean; accountId?: string };
    linkedin?: { enabled?: boolean; accountId?: string };
  };
};

// ---------- helpers ----------

const STAGES: { key: RunStage; label: string }[] = [
  { key: "gather", label: "coleta" },
  { key: "pautas", label: "pautas" },
  { key: "drafts", label: "drafts" },
  { key: "critico", label: "crítico" },
  { key: "editor", label: "editor" },
  { key: "agendar", label: "agenda" },
  { key: "notificar", label: "notif" },
  { key: "done", label: "fim" },
];

function brtToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function hourBRT(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function dateLabel(date: string): string {
  const today = brtToday();
  if (date === today) return "hoje";
  if (date === shiftDate(today, -1)) return "ontem";
  if (date === shiftDate(today, 1)) return "amanhã";
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

const STATUS_BADGE: Record<StoredPost["status"], { label: string; cls: string }> = {
  scheduled: { label: "agendado", cls: "badge-blue" },
  draft: { label: "rascunho", cls: "badge-amber" },
  failed: { label: "falhou", cls: "badge-red" },
  killed: { label: "morto", cls: "badge-gray" },
};

// ---------- componente ----------

export default function DashboardClient() {
  const [view, setView] = useState<"posts" | "combustivel" | "dicionario" | "agentes" | "config">("posts");
  const [date, setDate] = useState<string>(() => brtToday());
  const [status, setStatus] = useState<StatusData | null>(null);
  const [data, setData] = useState<PostsData | null>(null);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxFile, setInboxFile] = useState<File | null>(null);
  const [inboxText, setInboxText] = useState("");
  const [inboxBusy, setInboxBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [connectBusy, setConnectBusy] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<ConfigPatch>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<StatusData>("/api/status"));
    } catch (err) {
      showToast(`status: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showToast]);

  const loadPosts = useCallback(
    async (d: string) => {
      try {
        setData(await api<PostsData>(`/api/posts?date=${d}`));
      } catch (err) {
        showToast(`posts: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [showToast]
  );

  const loadInbox = useCallback(async (d: string) => {
    try {
      const res = await api<{ date: string; items: (string | InboxItem)[] }>(`/api/inbox?date=${d}`);
      setInboxItems(res.items.map((it, i) => (typeof it === "string" ? { id: `m${i}`, texto: it } : it)));
    } catch {
      // inbox não é crítico
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    setData(null);
    void loadPosts(date);
    void loadInbox(date);
  }, [date, loadPosts, loadInbox]);

  const run = data?.run ?? null;
  const runActive = !!run && run.stage !== "done" && run.stage !== "error";

  // poll a cada 15s enquanto o run está ativo
  useEffect(() => {
    if (!runActive) return;
    const t = setInterval(() => void loadPosts(date), 15_000);
    return () => clearInterval(t);
  }, [runActive, date, loadPosts]);

  // ---------- ações ----------

  async function connect(platform: "twitter" | "linkedin") {
    setConnectBusy(platform);
    try {
      const { url } = await api<{ url: string }>(`/api/connect/${platform}`);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      showToast(`conectar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConnectBusy(null);
    }
  }

  async function triggerRun(mode?: "review") {
    setRunBusy(true);
    try {
      await api("/api/run/trigger", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(mode ? { mode } : {}),
      });
      await loadPosts(date);
    } catch (err) {
      showToast(`run: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunBusy(false);
    }
  }

  async function continueRun(runId: string) {
    setRunBusy(true);
    try {
      await api("/api/run/continue", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ runId }),
      });
      await loadPosts(date);
    } catch (err) {
      showToast(`retomar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunBusy(false);
    }
  }

  function startEdit(post: StoredPost) {
    setEditingId(post.pautaId);
    setEditText(post.texto);
  }

  async function saveEdit(pautaId: string) {
    if (!editText.trim()) return;
    setEditBusy(true);
    try {
      const res = await api<{ post: StoredPost }>(`/api/posts/${pautaId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ date, texto: editText }),
      });
      setData((cur) =>
        cur
          ? { ...cur, posts: cur.posts.map((p) => (p.pautaId === pautaId ? res.post : p)) }
          : cur
      );
      setEditingId(null);
    } catch (err) {
      showToast(`editar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEditBusy(false);
    }
  }

  async function feedbackPost(post: StoredPost, veredito: "gostei" | "nao_sou_eu") {
    try {
      await api("/api/feedback", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ date, pautaId: post.pautaId, veredito }),
      });
      setData((cur) =>
        cur
          ? { ...cur, posts: cur.posts.map((p) => (p.pautaId === post.pautaId ? { ...p, feedback: veredito } : p)) }
          : cur
      );
      showToast(veredito === "gostei" ? "👍 registrado — o motor aprende esse padrão" : "👎 registrado — o motor evita esse jeito");
    } catch (err) {
      showToast(`feedback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function killPost(post: StoredPost) {
    if (!confirm(`Matar o post das ${hourBRT(post.scheduledForISO)}?`)) return;
    try {
      const res = await api<{ post: StoredPost }>(`/api/posts/${post.pautaId}`, {
        method: "DELETE",
        headers: JSON_HEADERS,
        body: JSON.stringify({ date }),
      });
      setData((cur) =>
        cur
          ? { ...cur, posts: cur.posts.map((p) => (p.pautaId === post.pautaId ? res.post : p)) }
          : cur
      );
    } catch (err) {
      showToast(`matar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function sendInbox() {
    const texto = inboxText.trim();
    if (!texto && !inboxFile) return;
    setInboxBusy(true);
    try {
      if (inboxFile) {
        const form = new FormData();
        form.append("texto", texto);
        form.append("imagem", inboxFile);
        await api("/api/inbox", { method: "POST", body: form });
      } else {
        await api("/api/inbox", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ texto }),
        });
      }
      setInboxText("");
      setInboxFile(null);
      await loadInbox(date);
    } catch (err) {
      showToast(`inbox: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInboxBusy(false);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      showToast("senha precisa de pelo menos 8 caracteres");
      return;
    }
    setPwBusy(true);
    try {
      await api("/api/password", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ newPassword }),
      });
      setNewPassword("");
      showToast("senha trocada ✓ (vale no próximo login)");
    } catch (err) {
      showToast(`senha: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPwBusy(false);
    }
  }

  const patchConfig = useCallback(
    (patch: ConfigPatch) => {
      // otimista na tela
      setStatus((cur) => {
        if (!cur) return cur;
        const c = cur.config;
        const next: AppConfig = {
          ...c,
          ...patch,
          windows: c.windows,
          channels: {
            x: { ...c.channels.x, ...patch.channels?.x },
            linkedin: { ...c.channels.linkedin, ...patch.channels?.linkedin },
          },
        };
        return { ...cur, config: next };
      });
      // acumula e salva com debounce
      pendingPatch.current = {
        ...pendingPatch.current,
        ...patch,
        channels:
          patch.channels || pendingPatch.current.channels
            ? {
                x: { ...pendingPatch.current.channels?.x, ...patch.channels?.x },
                linkedin: {
                  ...pendingPatch.current.channels?.linkedin,
                  ...patch.channels?.linkedin,
                },
              }
            : undefined,
      };
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const body = pendingPatch.current;
        pendingPatch.current = {};
        try {
          const res = await api<{ config: AppConfig }>("/api/config", {
            method: "PUT",
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
          });
          setStatus((cur) => (cur ? { ...cur, config: res.config } : cur));
          setSaveState("saved");
          setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
        } catch (err) {
          setSaveState("error");
          showToast(`config: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, 500);
    },
    [showToast]
  );

  // ---------- derivados ----------

  const config = status?.config ?? null;
  const accounts = status?.accounts ?? { twitter: null, linkedin: null };

  const pill = config?.paused
    ? { cls: "pill-amber", label: "pausado" }
    : runActive
      ? { cls: "pill-blue", label: "rodando" }
      : { cls: "pill-green", label: "ok" };

  const stageIndex = run ? STAGES.findIndex((s) => s.key === run.stage) : -1;
  const posts = [...(data?.posts ?? [])].sort((a, b) =>
    a.scheduledForISO.localeCompare(b.scheduledForISO)
  );

  // ---------- render ----------

  return (
    <main className="shell">
      {/* HEADER */}
      <header className="header">
        <div className="header-top">
          <h1>motor x</h1>
          <span className={`pill ${pill.cls}`}>
            <span className="pill-dot" />
            {pill.label}
          </span>
        </div>
        <div className="date-nav">
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => setDate((d) => shiftDate(d, -1))}
            aria-label="dia anterior"
          >
            ‹
          </button>
          <span className="date-label">
            {dateLabel(date)}
            <span className="small muted">{date}</span>
          </span>
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => setDate((d) => shiftDate(d, 1))}
            aria-label="próximo dia"
          >
            ›
          </button>
        </div>
      </header>

      <div className="layout">
        <nav className="sidebar">
          {(
            [
              ["posts", "📅", "posts do dia"],
              ["combustivel", "🧠", "combustível"],
              ["dicionario", "📖", "dicionário"],
              ["agentes", "🤖", "agentes"],
              ["config", "⚙️", "config"],
            ] as const
          ).map(([id, emoji, label]) => (
            <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => setView(id)}>
              <span className="nav-emoji">{emoji}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="content">
      {view === "config" && (<>
      {/* CONTAS */}
      <section className="card">
        <div className="section-title">contas</div>
        <div className="accounts">
          {accounts.twitter ? (
            <span className="pill pill-green">X: {accounts.twitter} ✓</span>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => void connect("twitter")}
              disabled={connectBusy === "twitter"}
            >
              {connectBusy === "twitter" ? "gerando link..." : "conectar X"}
            </button>
          )}
          {config && !config.channels.linkedin.enabled ? (
            <span className="pill badge-gray">LinkedIn: fase 2</span>
          ) : accounts.linkedin ? (
            <span className="pill pill-green">LinkedIn: {accounts.linkedin} ✓</span>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => void connect("linkedin")}
              disabled={connectBusy === "linkedin"}
            >
              {connectBusy === "linkedin" ? "gerando link..." : "conectar LinkedIn"}
            </button>
          )}
        </div>
      </section>

      </>)}

      {view === "posts" && (<>
      {/* RUN DO DIA */}
      <section className="card">
        <div className="section-title">run do dia</div>

        {run && (
          <>
            <p className="small muted">
              {run.id} · modo {run.mode === "review" ? "revisão" : "auto"}
            </p>
            <div className="stages">
              {STAGES.map((s, i) => {
                const failed = run.stage === "error" && i === Math.max(stageIndex, 0);
                const isDone =
                  run.stage === "done" ? true : stageIndex >= 0 && i < stageIndex;
                const isCurrent = run.stage !== "done" && run.stage !== "error" && i === stageIndex;
                const cls = [
                  "stage",
                  isDone ? "done" : "",
                  isCurrent ? "current" : "",
                  failed ? "failed" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div key={s.key} className={cls}>
                    <div className="stage-bar" />
                    <div className="stage-label">{s.label}</div>
                  </div>
                );
              })}
            </div>

            {run.stage === "error" && (
              <div className="error-box">
                <span>{run.error ?? "erro sem detalhe"}</span>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => void continueRun(run.id)}
                  disabled={runBusy}
                >
                  retomar
                </button>
              </div>
            )}

            {run.stage !== "done" && (run.previa?.drafts.length ?? 0) > 0 && (
              <details className="log-details" open>
                <summary>
                  prévia do lote ({run.previa!.finalistas.length} aprovados · {run.previa!.drafts.length} drafts ·{" "}
                  {run.previa!.mortos.length} mortos)
                </summary>
                <div className="post-list" style={{ marginTop: 8 }}>
                  {(run.previa!.finalistas.length > 0 ? run.previa!.finalistas : run.previa!.drafts).map((d) => (
                    <article key={d.id} className="post-card">
                      {"score" in d && <span className="small muted">score {(d as { score: number }).score}</span>}
                      <p className="post-text">{d.texto}</p>
                    </article>
                  ))}
                </div>
              </details>
            )}

            {run.log.length > 0 && (
              <details className="log-details">
                <summary>log ({run.log.length})</summary>
                <pre className="log-pre">{run.log.join("\n")}</pre>
              </details>
            )}
          </>
        )}

        {!run && data && <p className="empty">nenhum run pra esse dia ainda.</p>}
        {!data && <p className="empty">carregando...</p>}

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={() => void triggerRun()}
            disabled={runBusy || runActive}
          >
            {runActive ? "rodando..." : "gerar agora"}
          </button>
          <button
            className="btn"
            onClick={() => void triggerRun("review")}
            disabled={runBusy || runActive}
          >
            gerar em modo revisão
          </button>
        </div>
      </section>

      {/* POSTS DO DIA */}
      <section className="card">
        <div className="section-title">posts do dia</div>
        {posts.length === 0 && <p className="empty">nenhum post pra esse dia.</p>}
        <div className="post-list">
          {posts.map((post) => {
            const badge = STATUS_BADGE[post.status];
            const editing = editingId === post.pautaId;
            return (
              <article
                key={post.pautaId}
                className={`post-card${post.status === "killed" ? " killed" : ""}`}
              >
                <div className="post-head">
                  <span className="post-hour">{hourBRT(post.scheduledForISO)}</span>
                  <div className="post-meta">
                    {typeof post.score === "number" && (
                      <span className="small muted">score {post.score}</span>
                    )}
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                </div>

                {editing ? (
                  <>
                    <textarea
                      className="textarea"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={5}
                    />
                    <div className="post-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => void saveEdit(post.pautaId)}
                        disabled={editBusy || !editText.trim()}
                      >
                        {editBusy ? "salvando..." : "salvar"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingId(null)}
                        disabled={editBusy}
                      >
                        cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {post.mediaUrl && <img className="post-img" src={post.mediaUrl} alt="" />}
                    <p className="post-text">{post.texto}</p>
                    {post.erro && <p className="post-error">{post.erro}</p>}
                    {post.status !== "killed" && (
                      <div className="post-actions">
                        <button className="btn btn-sm" onClick={() => startEdit(post)}>
                          editar
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => void killPost(post)}
                        >
                          matar
                        </button>
                        <span className="spacer" />
                        <button
                          className={`judge-btn ${post.feedback === "gostei" ? "on-good" : ""}`}
                          title="isso sou eu — o motor aprende esse padrão"
                          onClick={() => void feedbackPost(post, "gostei")}
                        >
                          {post.feedback === "gostei" ? "👍 aprendido" : "👍 sou eu"}
                        </button>
                        <button
                          className={`judge-btn ${post.feedback === "nao_sou_eu" ? "on-bad" : ""}`}
                          title="não soa como eu — vira veto de padrão"
                          onClick={() => void feedbackPost(post, "nao_sou_eu")}
                        >
                          {post.feedback === "nao_sou_eu" ? "👎 vetado" : "👎 não sou eu"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>

      </>)}

      {view === "combustivel" && (<>
      {/* INBOX */}
      <section className="card">
        <div className="section-title">inbox</div>
        <textarea
          className="textarea"
          placeholder="joga uma ideia pro pauteiro..."
          value={inboxText}
          onChange={(e) => setInboxText(e.target.value)}
          rows={3}
        />
        <div className="btn-row" style={{ marginTop: 8 }}>
          <label className="btn btn-sm file-btn">
            {inboxFile ? `📎 ${inboxFile.name.slice(0, 18)}` : "📎 print"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => setInboxFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {inboxFile && (
            <button className="btn btn-ghost btn-sm" onClick={() => setInboxFile(null)}>
              ✕
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => void sendInbox()}
            disabled={inboxBusy || (!inboxText.trim() && !inboxFile)}
          >
            {inboxBusy ? "enviando..." : "enviar"}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          print + contexto = o motor lê a imagem e o post sai com ela anexada
        </p>
        {inboxItems.length > 0 && (
          <ul className="inbox-list">
            {inboxItems.map((item, i) => (
              <li key={item.id ?? i}>
                {item.mediaUrl && <img className="thumb" src={item.mediaUrl} alt="" />}
                <span>{item.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FatosBlock showToast={showToast} />
      </>)}

      {view === "config" && (<>
      {/* AJUSTES */}
      <section className="card">
        <details className="settings-details">
          <summary>
            <span>ajustes</span>
            <span className={`save-feedback ${saveState}`}>
              {saveState === "saving" && "salvando..."}
              {saveState === "saved" && "salvo ✓"}
              {saveState === "error" && "erro ao salvar"}
            </span>
          </summary>

          {config ? (
            <>
              <div className="setting-row">
                <span className="setting-label">posts por dia</span>
                <div className="setting-control">
                  <input
                    className="input input-number"
                    type="number"
                    min={1}
                    max={8}
                    value={config.postsPerDay}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(8, Number(e.target.value) || 1));
                      patchConfig({ postsPerDay: v });
                    }}
                  />
                </div>
              </div>

              <div className="setting-row setting-range">
                <div className="range-head">
                  <span className="setting-label">% em português</span>
                  <span className="small muted">{Math.round(config.ptShare * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(config.ptShare * 100)}
                  onChange={(e) => patchConfig({ ptShare: Number(e.target.value) / 100 })}
                />
              </div>

              <div className="setting-row">
                <span className="setting-label">
                  pausar sistema
                  <span className="small muted">não gera nem agenda nada</span>
                </span>
                <div className="setting-control">
                  <input
                    type="checkbox"
                    className="switch"
                    checked={config.paused}
                    onChange={(e) => patchConfig({ paused: e.target.checked })}
                  />
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">
                  modo
                  <span className="small muted">review segura como rascunho</span>
                </span>
                <div className="setting-control">
                  <div className="segmented">
                    <button
                      className={config.mode === "auto" ? "active" : ""}
                      onClick={() => patchConfig({ mode: "auto" })}
                    >
                      auto
                    </button>
                    <button
                      className={config.mode === "review" ? "active" : ""}
                      onClick={() => patchConfig({ mode: "review" })}
                    >
                      review
                    </button>
                  </div>
                </div>
              </div>

              <div className="setting-row">
                <span className="setting-label">LinkedIn</span>
                <div className="setting-control">
                  <input
                    type="checkbox"
                    className="switch"
                    checked={config.channels.linkedin.enabled}
                    onChange={(e) =>
                      patchConfig({ channels: { linkedin: { enabled: e.target.checked } } })
                    }
                  />
                </div>
              </div>

              <div className="setting-row setting-range">
                <span className="setting-label">
                  trocar senha
                  <span className="small muted">mínimo 8 caracteres, vale no próximo login</span>
                </span>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 160 }}
                    type="password"
                    placeholder="senha nova"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    className="btn btn-sm"
                    onClick={() => void changePassword()}
                    disabled={pwBusy || newPassword.length < 8}
                  >
                    {pwBusy ? "trocando..." : "trocar"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="empty">carregando config...</p>
          )}
        </details>
      </section>

      </>)}

      {view === "dicionario" && <DicionarioView showToast={showToast} />}
      {view === "agentes" && <AgentesView showToast={showToast} />}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
