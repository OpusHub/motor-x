"use client";

import { useEffect, useState } from "react";

// Telas de controle do motor: Dicionário (negative keywords da voz),
// Agentes (pipeline inteiro com prompt editável por etapa) e o bloco de
// Fatos + resumo de daily (combustível). Navegadas pela sidebar do dashboard.

interface TermoBanido { termo: string; tipo: "palavra" | "frase" | "regex"; motivo: string; ativo: boolean }
interface TermoPreferido { termo: string; nota: string; ativo: boolean }
interface Dicionario { banidas: TermoBanido[]; preferidas: TermoPreferido[] }
interface PromptItem { key: string; titulo: string; conteudo: string; customizado: boolean }
interface Fato { id: string; fato: string; fonte: string }

const JSON_HEADERS = { "Content-Type": "application/json" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/* ============================== DICIONÁRIO ============================== */

export function DicionarioView({ showToast }: { showToast: (msg: string) => void }) {
  const [dic, setDic] = useState<Dicionario | null>(null);
  const [busy, setBusy] = useState(false);
  const [novoTermo, setNovoTermo] = useState("");
  const [novoTipo, setNovoTipo] = useState<TermoBanido["tipo"]>("frase");
  const [novoMotivo, setNovoMotivo] = useState("");
  const [novaPreferida, setNovaPreferida] = useState("");
  const [novaNota, setNovaNota] = useState("");

  useEffect(() => {
    void api<Dicionario>("/api/dicionario").then(setDic).catch(() => {});
  }, []);

  async function salvar(next: Dicionario) {
    setBusy(true);
    try {
      await api("/api/dicionario", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(next) });
      setDic(next);
      showToast("dicionário salvo ✓ (vale no próximo run)");
    } catch (err) {
      showToast(`dicionário: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!dic) return <section className="card"><p className="empty">carregando dicionário...</p></section>;

  return (
    <>
      <section className="card">
        <div className="section-title">🚫 banidas ({dic.banidas.filter((b) => b.ativo).length} ativas)</div>
        <p className="small muted" style={{ marginBottom: 10 }}>
          o lint mata em código qualquer post que use termo ativo. palavra = exata · frase = contém · regex = padrão
        </p>
        {dic.banidas.map((b, i) => (
          <div key={i} className="btn-row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, opacity: b.ativo ? 1 : 0.45 }}>
              <input
                type="checkbox"
                checked={b.ativo}
                onChange={(e) => void salvar({ ...dic, banidas: dic.banidas.map((x, j) => (j === i ? { ...x, ativo: e.target.checked } : x)) })}
              />
              <code style={{ wordBreak: "break-all" }}>{b.termo}</code>
              <span className="muted">({b.tipo}{b.motivo ? ` · ${b.motivo}` : ""})</span>
            </label>
            <button className="btn btn-sm" disabled={busy} onClick={() => void salvar({ ...dic, banidas: dic.banidas.filter((_, j) => j !== i) })}>
              remover
            </button>
          </div>
        ))}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <input className="input" style={{ flex: 2, minWidth: 120 }} placeholder="termo ou padrão" value={novoTermo} onChange={(e) => setNovoTermo(e.target.value)} />
          <select className="input" style={{ width: 100 }} value={novoTipo} onChange={(e) => setNovoTipo(e.target.value as TermoBanido["tipo"])}>
            <option value="frase">frase</option>
            <option value="palavra">palavra</option>
            <option value="regex">regex</option>
          </select>
          <input className="input" style={{ flex: 2, minWidth: 120 }} placeholder="motivo (opcional)" value={novoMotivo} onChange={(e) => setNovoMotivo(e.target.value)} />
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || !novoTermo.trim()}
            onClick={() => {
              void salvar({ ...dic, banidas: [...dic.banidas, { termo: novoTermo.trim(), tipo: novoTipo, motivo: novoMotivo.trim(), ativo: true }] });
              setNovoTermo("");
              setNovoMotivo("");
            }}
          >
            banir
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-title">✅ vocabulário preferido ({dic.preferidas.filter((p) => p.ativo).length} ativos)</div>
        <p className="small muted" style={{ marginBottom: 10 }}>
          palavras SUAS que o escritor recebe com a dose anotada — não force, é tempero
        </p>
        {dic.preferidas.map((p, i) => (
          <div key={i} className="btn-row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, opacity: p.ativo ? 1 : 0.45 }}>
              <input
                type="checkbox"
                checked={p.ativo}
                onChange={(e) => void salvar({ ...dic, preferidas: dic.preferidas.map((x, j) => (j === i ? { ...x, ativo: e.target.checked } : x)) })}
              />
              <code>{p.termo}</code>
              <span className="muted">{p.nota}</span>
            </label>
            <button className="btn btn-sm" disabled={busy} onClick={() => void salvar({ ...dic, preferidas: dic.preferidas.filter((_, j) => j !== i) })}>
              remover
            </button>
          </div>
        ))}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <input className="input" style={{ flex: 1, minWidth: 100 }} placeholder='palavra (ex: "papo reto")' value={novaPreferida} onChange={(e) => setNovaPreferida(e.target.value)} />
          <input className="input" style={{ flex: 2, minWidth: 140 }} placeholder="dose (ex: no máx 1x por post)" value={novaNota} onChange={(e) => setNovaNota(e.target.value)} />
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || !novaPreferida.trim()}
            onClick={() => {
              void salvar({ ...dic, preferidas: [...dic.preferidas, { termo: novaPreferida.trim(), nota: novaNota.trim(), ativo: true }] });
              setNovaPreferida("");
              setNovaNota("");
            }}
          >
            adicionar
          </button>
        </div>
      </section>
    </>
  );
}

/* ============================== AGENTES (PIPELINE) ============================== */

const PIPELINE: {
  etapa: string;
  emoji: string;
  desc: string;
  modelo: string;
  prompts: string[]; // keys de /api/prompts editáveis nesta etapa
}[] = [
  { etapa: "coleta", emoji: "📡", desc: "varre Reddit + Hacker News + Product Hunt + teu inbox/fatos; filtra tema já publicado", modelo: "código (sem IA)", prompts: [] },
  { etapa: "pauteiro", emoji: "🗞", desc: "escolhe os assuntos do dia e a FORMA de cada post (F1-F5), rotacionando", modelo: "kimi · reserva haiku", prompts: ["pauteiro"] },
  { etapa: "ghostwriter", emoji: "✍️", desc: "escreve na voz do Victor (1 post por chamada, com dicionário + registro real + registro ácido)", modelo: "sonnet 5", prompts: ["ghostwriter", "registroAcido", "registroReal"] },
  { etapa: "crítico", emoji: "🔪", desc: "julga 1 draft por vez com rubrica de penalidades; o que parece IA morre aqui", modelo: "sonnet 5", prompts: ["critico"] },
  { etapa: "editor", emoji: "📋", desc: "seleciona e ordena o dia; código impede abertura/forma/canal repetidos", modelo: "kimi · reserva haiku", prompts: ["editor"] },
  { etapa: "agenda", emoji: "📆", desc: "calcula horários (janelas 11-14h / 17-20h, espaçados) e publica via Zernio", modelo: "código (sem IA)", prompts: [] },
];

export function AgentesView({ showToast }: { showToast: (msg: string) => void }) {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);

  async function carregar() {
    const p = await api<{ prompts: PromptItem[] }>("/api/prompts");
    setPrompts(p.prompts);
  }
  useEffect(() => {
    void carregar().catch(() => {});
  }, []);

  function abrir(key: string) {
    const p = prompts.find((x) => x.key === key);
    setEditando(key);
    setTexto(p?.conteudo ?? "");
  }

  async function salvar() {
    if (!editando) return;
    setBusy(true);
    try {
      await api("/api/prompts", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ key: editando, md: texto }) });
      await carregar();
      showToast("prompt salvo ✓ (vale no próximo run)");
    } catch (err) {
      showToast(`prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function restaurar() {
    if (!editando) return;
    setBusy(true);
    try {
      await api(`/api/prompts?key=${editando}`, { method: "DELETE" });
      await carregar();
      const p = (await api<{ prompts: PromptItem[] }>("/api/prompts")).prompts.find((x) => x.key === editando);
      setTexto(p?.conteudo ?? "");
      showToast("prompt restaurado pro padrão ✓");
    } catch (err) {
      showToast(`prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {PIPELINE.map((et, idx) => (
        <section key={et.etapa} className="card">
          <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="muted small">{idx + 1}.</span> {et.emoji} {et.etapa}
            <span className="pill badge-gray" style={{ marginLeft: "auto" }}>{et.modelo}</span>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>{et.desc}</p>
          {et.prompts.map((key) => {
            const p = prompts.find((x) => x.key === key);
            if (!p) return null;
            const aberto = editando === key;
            return (
              <div key={key} style={{ marginTop: 10 }}>
                <div className="btn-row" style={{ alignItems: "center" }}>
                  <span className="small" style={{ flex: 1 }}>
                    {p.titulo} {p.customizado && <span className="pill pill-green" style={{ marginLeft: 6 }}>customizado</span>}
                  </span>
                  <button className="btn btn-sm" onClick={() => (aberto ? setEditando(null) : abrir(key))}>
                    {aberto ? "fechar" : "editar"}
                  </button>
                </div>
                {aberto && (
                  <>
                    <textarea
                      className="input"
                      style={{ marginTop: 8, width: "100%", minHeight: 300, fontFamily: "monospace", fontSize: 12, lineHeight: 1.55 }}
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                    />
                    <div className="btn-row" style={{ marginTop: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => void salvar()} disabled={busy || texto.trim().length < 20}>
                        {busy ? "..." : "salvar"}
                      </button>
                      {p.customizado && (
                        <button className="btn btn-sm" onClick={() => void restaurar()} disabled={busy}>
                          restaurar padrão
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

/* ============================== COMBUSTÍVEL: FATOS + DAILY ============================== */

export function FatosBlock({ showToast }: { showToast: (msg: string) => void }) {
  const [fatos, setFatos] = useState<Fato[] | null>(null);
  const [novoFato, setNovoFato] = useState("");
  const [novaFonte, setNovaFonte] = useState("");
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState("");
  const [dailyBusy, setDailyBusy] = useState(false);

  useEffect(() => {
    void api<{ facts: Fato[] }>("/api/fatos").then((d) => setFatos(d.facts)).catch(() => {});
  }, []);

  async function salvarFatos(next: Fato[]) {
    setBusy(true);
    try {
      await api("/api/fatos", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ facts: next }) });
      setFatos(next);
      showToast("fatos salvos ✓ (o pauteiro usa no próximo run)");
    } catch (err) {
      showToast(`fatos: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function enviarDaily() {
    setDailyBusy(true);
    try {
      const form = new FormData();
      form.set("texto", `[DAILY ${new Date().toISOString().slice(0, 10)}] ${daily.trim()}`);
      const res = await fetch("/api/inbox", { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDaily("");
      showToast("resumo da daily no inbox ✓ — o pauteiro extrai só o que pode ser público");
    } catch (err) {
      showToast(`daily: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDailyBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <div className="section-title">📌 fatos reais (banco permanente)</div>
        <p className="small muted" style={{ marginBottom: 8 }}>
          número, decisão, história SUA — post bom nasce daqui. diferente do inbox (que é do dia), fato fica pra sempre até você remover
        </p>
        {(fatos ?? []).map((f, i) => (
          <div key={f.id} className="btn-row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
            <span className="small" style={{ flex: 1 }}>
              {f.fato} <span className="muted">({f.fonte})</span>
            </span>
            <button className="btn btn-sm" disabled={busy} onClick={() => void salvarFatos((fatos ?? []).filter((_, j) => j !== i))}>
              remover
            </button>
          </div>
        ))}
        {fatos && fatos.length === 0 && <p className="empty">nenhum fato dinâmico ainda — os 6 fixos do banco continuam valendo</p>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <input
            className="input"
            style={{ flex: 3, minWidth: 160 }}
            placeholder='fato real (ex: "paywall novo do SkinUp converteu 2x no A/B de julho")'
            value={novoFato}
            onChange={(e) => setNovoFato(e.target.value)}
          />
          <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="fonte (opcional)" value={novaFonte} onChange={(e) => setNovaFonte(e.target.value)} />
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || !novoFato.trim()}
            onClick={() => {
              void salvarFatos([...(fatos ?? []), { id: `f${Date.now().toString(36)}`, fato: novoFato.trim(), fonte: novaFonte.trim() || "Victor (painel)" }]);
              setNovoFato("");
              setNovaFonte("");
            }}
          >
            adicionar
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-title">🎙 resumo da daily / call</div>
        <p className="small muted" style={{ marginBottom: 8 }}>
          cola aqui o transcript ou resumo da call do dia. entra marcado como MATERIAL INTERNO: o pauteiro extrai só aprendizado/decisão que pode ser público — nunca nome de cliente ou número não anunciado. (dá pra automatizar via Google Drive: me pede que eu explico o caminho)
        </p>
        <textarea
          className="textarea"
          rows={5}
          placeholder="resumo/transcript da daily de hoje..."
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
        />
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-sm btn-primary" disabled={dailyBusy || daily.trim().length < 30} onClick={() => void enviarDaily()}>
            {dailyBusy ? "enviando..." : "mandar pro motor"}
          </button>
        </div>
      </section>
    </>
  );
}
