"use client";

import { useEffect, useRef, useState } from "react";

// Telas de controle do motor: Dicionário (chips com switch), Agentes (trilho
// do pipeline com prompt editável por etapa) e Combustível (fatos + daily com
// anexo de transcript + sync do Drive). Navegadas pela sidebar do dashboard.

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

function ChipLista<T extends { ativo: boolean }>({
  itens,
  principal,
  nota,
  onToggle,
  onRemove,
}: {
  itens: T[];
  principal: (t: T) => string;
  nota: (t: T) => string;
  onToggle: (i: number, ativo: boolean) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="chip-grid">
      {itens.map((t, i) => (
        <div key={i} className={`term-chip ${t.ativo ? "" : "off"}`}>
          <input
            type="checkbox"
            className="switch"
            checked={t.ativo}
            title={t.ativo ? "ativo — clique pra desativar" : "inativo"}
            onChange={(e) => onToggle(i, e.target.checked)}
          />
          <span className="term-main">
            <code>{principal(t)}</code>
            {nota(t) && <span className="term-note">{nota(t)}</span>}
          </span>
          <button className="chip-x" title="remover" onClick={() => onRemove(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

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

  async function salvar(next: Dicionario, msg = "dicionário salvo ✓ (vale no próximo run)") {
    setBusy(true);
    try {
      await api("/api/dicionario", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(next) });
      setDic(next);
      showToast(msg);
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
        <div className="section-title">🚫 banidas · {dic.banidas.filter((b) => b.ativo).length} ativas</div>
        <p className="fuel-hint">
          post que usar termo ativo morre no lint, antes de qualquer IA. o interruptor desliga sem apagar.
        </p>
        <ChipLista
          itens={dic.banidas}
          principal={(b) => b.termo}
          nota={(b) => `${b.tipo}${b.motivo ? ` · ${b.motivo}` : ""}`}
          onToggle={(i, ativo) => void salvar({ ...dic, banidas: dic.banidas.map((x, j) => (j === i ? { ...x, ativo } : x)) }, ativo ? "banida ativada ✓" : "banida desativada")}
          onRemove={(i) => void salvar({ ...dic, banidas: dic.banidas.filter((_, j) => j !== i) }, "termo removido")}
        />
        <div className="form-add">
          <div className="form-add-row">
            <input className="input" placeholder="termo ou padrão a banir" value={novoTermo} onChange={(e) => setNovoTermo(e.target.value)} />
            <select className="input" style={{ maxWidth: 130 }} value={novoTipo} onChange={(e) => setNovoTipo(e.target.value as TermoBanido["tipo"])}>
              <option value="frase">frase</option>
              <option value="palavra">palavra</option>
              <option value="regex">regex</option>
            </select>
          </div>
          <div className="form-add-row">
            <input className="input" placeholder="motivo (opcional, aparece no chip)" value={novoMotivo} onChange={(e) => setNovoMotivo(e.target.value)} />
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || !novoTermo.trim()}
              onClick={() => {
                void salvar({ ...dic, banidas: [...dic.banidas, { termo: novoTermo.trim(), tipo: novoTipo, motivo: novoMotivo.trim(), ativo: true }] }, "banida adicionada ✓");
                setNovoTermo("");
                setNovoMotivo("");
              }}
            >
              banir
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-title">✅ vocabulário preferido · {dic.preferidas.filter((p) => p.ativo).length} ativos</div>
        <p className="fuel-hint">
          palavras SUAS que o escritor recebe com a dose anotada. é tempero, não obrigação.
        </p>
        <ChipLista
          itens={dic.preferidas}
          principal={(p) => p.termo}
          nota={(p) => p.nota}
          onToggle={(i, ativo) => void salvar({ ...dic, preferidas: dic.preferidas.map((x, j) => (j === i ? { ...x, ativo } : x)) }, ativo ? "preferida ativada ✓" : "preferida desativada")}
          onRemove={(i) => void salvar({ ...dic, preferidas: dic.preferidas.filter((_, j) => j !== i) }, "termo removido")}
        />
        <div className="form-add">
          <div className="form-add-row">
            <input className="input" placeholder='palavra sua (ex: "papo reto")' value={novaPreferida} onChange={(e) => setNovaPreferida(e.target.value)} />
            <input className="input" placeholder="dose (ex: no máx 1x por post)" value={novaNota} onChange={(e) => setNovaNota(e.target.value)} />
          </div>
          <div className="form-add-row">
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || !novaPreferida.trim()}
              onClick={() => {
                void salvar({ ...dic, preferidas: [...dic.preferidas, { termo: novaPreferida.trim(), nota: novaNota.trim(), ativo: true }] }, "preferida adicionada ✓");
                setNovaPreferida("");
                setNovaNota("");
              }}
            >
              adicionar
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

/* ============================== AGENTES (PIPELINE) ============================== */

const PIPELINE: { etapa: string; emoji: string; desc: string; modelo: string; prompts: string[] }[] = [
  { etapa: "coleta", emoji: "📡", desc: "varre Reddit, Hacker News e Product Hunt + teu inbox e fatos; filtra tema já publicado", modelo: "código", prompts: [] },
  { etapa: "pauteiro", emoji: "🗞", desc: "escolhe os assuntos do dia e a forma de cada post (F1-F5), rotacionando", modelo: "kimi → haiku", prompts: ["pauteiro"] },
  { etapa: "ghostwriter", emoji: "✍️", desc: "escreve na tua voz, 1 post por chamada, com dicionário + registro real + registro ácido", modelo: "sonnet 5", prompts: ["ghostwriter", "registroAcido", "registroReal"] },
  { etapa: "crítico", emoji: "🔪", desc: "julga cada draft com rubrica de penalidades; o que parece IA morre aqui", modelo: "sonnet 5", prompts: ["critico"] },
  { etapa: "editor", emoji: "📋", desc: "seleciona e ordena o dia; código impede abertura, forma e canal repetidos", modelo: "kimi → haiku", prompts: ["editor"] },
  { etapa: "agenda", emoji: "📆", desc: "calcula horários (11-14h e 17-20h, espaçados) e publica via Zernio", modelo: "código", prompts: [] },
];

export function AgentesView({ showToast }: { showToast: (msg: string) => void }) {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);

  async function carregar() {
    const p = await api<{ prompts: PromptItem[] }>("/api/prompts");
    setPrompts(p.prompts);
    return p.prompts;
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
      const lista = await carregar();
      setTexto(lista.find((x) => x.key === editando)?.conteudo ?? "");
      showToast("prompt restaurado pro padrão ✓");
    } catch (err) {
      showToast(`prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="section-title">🤖 o pipeline · 6 etapas</div>
      <p className="fuel-hint">cada post do dia passa por essa esteira, de cima pra baixo. clica em editar pra mexer no cérebro da etapa.</p>
      <div className="pipe">
        {PIPELINE.map((et, idx) => (
          <div key={et.etapa} className="pipe-step">
            <div className="pipe-node">{idx + 1}</div>
            <div className="pipe-card">
              <div className="pipe-head">
                <span>{et.emoji}</span>
                <span className="pipe-name">{et.etapa}</span>
                <span className="pipe-model">{et.modelo}</span>
              </div>
              <p className="pipe-desc">{et.desc}</p>
              {et.prompts.map((key) => {
                const p = prompts.find((x) => x.key === key);
                if (!p) return null;
                const aberto = editando === key;
                return (
                  <div key={key}>
                    <div className="prompt-row">
                      <span className="prompt-name">
                        {p.titulo}
                        {p.customizado && <span className="pill pill-green" style={{ marginLeft: 8 }}>customizado</span>}
                      </span>
                      <button className="btn btn-sm" onClick={() => (aberto ? setEditando(null) : abrir(key))}>
                        {aberto ? "fechar" : "editar"}
                      </button>
                    </div>
                    {aberto && (
                      <>
                        <textarea className="prompt-editor" value={texto} onChange={(e) => setTexto(e.target.value)} />
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
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================== COMBUSTÍVEL: FATOS + DAILY + DRIVE ============================== */

export function FatosBlock({ showToast }: { showToast: (msg: string) => void }) {
  const [fatos, setFatos] = useState<Fato[] | null>(null);
  const [novoFato, setNovoFato] = useState("");
  const [novaFonte, setNovaFonte] = useState("");
  const [busy, setBusy] = useState(false);
  const [daily, setDaily] = useState("");
  const [dailyBusy, setDailyBusy] = useState(false);
  const [drive, setDrive] = useState<{ enabled: boolean; lastSyncISO?: string } | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<{ facts: Fato[] }>("/api/fatos").then((d) => setFatos(d.facts)).catch(() => {});
    void api<{ enabled: boolean; lastSyncISO?: string }>("/api/drive/sync").then(setDrive).catch(() => setDrive(null));
  }, []);

  async function salvarFatos(next: Fato[], msg = "fatos salvos ✓ (o pauteiro usa no próximo run)") {
    setBusy(true);
    try {
      await api("/api/fatos", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ facts: next }) });
      setFatos(next);
      showToast(msg);
    } catch (err) {
      showToast(`fatos: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function anexarTranscript(file: File) {
    if (file.size > 400_000) {
      showToast("arquivo grande demais (máx ~400KB de texto)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let txt = String(reader.result ?? "");
      // vtt/srt: tira timestamps e números de cue, sobra a fala
      if (/\.(vtt|srt)$/i.test(file.name)) {
        txt = txt
          .replace(/^WEBVTT.*$/gm, "")
          .replace(/^\d+$/gm, "")
          .replace(/\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\s*-->.*$/gm, "")
          .replace(/\n{2,}/g, "\n");
      }
      setDaily((cur) => (cur ? `${cur}\n\n` : "") + txt.trim());
      showToast(`📎 ${file.name} anexado — revisa e manda`);
    };
    reader.readAsText(file);
  }

  async function enviarDaily() {
    setDailyBusy(true);
    try {
      const form = new FormData();
      form.set("texto", `[DAILY ${new Date().toISOString().slice(0, 10)}] ${daily.trim().slice(0, 6000)}`);
      const res = await fetch("/api/inbox", { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDaily("");
      showToast("daily no inbox ✓ — o pauteiro extrai só o que pode ser público");
    } catch (err) {
      showToast(`daily: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDailyBusy(false);
    }
  }

  async function sincronizarDrive() {
    setDriveBusy(true);
    try {
      const r = await api<{ enabled: boolean; novos: number; nomes?: string[] }>("/api/drive/sync", { method: "POST" });
      showToast(r.novos > 0 ? `☁️ ${r.novos} transcript(s) novo(s) puxado(s) do Drive ✓` : "☁️ drive em dia — nada novo na pasta");
    } catch (err) {
      showToast(`drive: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDriveBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <div className="section-title">📌 fatos reais · banco permanente</div>
        <p className="fuel-hint">
          número, decisão, história SUA. post bom nasce daqui. diferente do inbox (que é do dia), fato fica até você remover.
        </p>
        {(fatos ?? []).map((f, i) => (
          <div key={f.id} className="fato-item">
            <span className="fato-txt">
              {f.fato}
              <span className="fato-fonte">{f.fonte}</span>
            </span>
            <button className="chip-x" title="remover" disabled={busy} onClick={() => void salvarFatos((fatos ?? []).filter((_, j) => j !== i), "fato removido")}>
              ✕
            </button>
          </div>
        ))}
        {fatos && fatos.length === 0 && <p className="empty">nenhum fato dinâmico ainda (os 6 fixos do banco seguem valendo)</p>}
        <div className="form-add">
          <div className="form-add-row">
            <input
              className="input"
              placeholder='fato real (ex: "paywall novo do SkinUp converteu 2x no A/B de julho")'
              value={novoFato}
              onChange={(e) => setNovoFato(e.target.value)}
            />
          </div>
          <div className="form-add-row">
            <input className="input" placeholder="fonte (opcional)" value={novaFonte} onChange={(e) => setNovaFonte(e.target.value)} />
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || !novoFato.trim()}
              onClick={() => {
                void salvarFatos([...(fatos ?? []), { id: `f${Date.now().toString(36)}`, fato: novoFato.trim(), fonte: novaFonte.trim() || "Victor (painel)" }], "fato adicionado ✓");
                setNovoFato("");
                setNovaFonte("");
              }}
            >
              adicionar
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-title">🎙 daily / call</div>
        <p className="fuel-hint">
          cola ou anexa o transcript da call. entra marcado como material interno: o pauteiro extrai só o publicável — nunca cliente, número não anunciado ou plano não lançado.
        </p>
        <textarea
          className="textarea"
          rows={5}
          placeholder="resumo ou transcript da daily de hoje..."
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
        />
        <div className="btn-row" style={{ marginTop: 10 }}>
          <label className="btn btn-sm file-btn">
            📎 anexar transcript
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.vtt,.srt,.md,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) anexarTranscript(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
          </label>
          <button className="btn btn-sm btn-primary" disabled={dailyBusy || daily.trim().length < 30} onClick={() => void enviarDaily()}>
            {dailyBusy ? "enviando..." : "mandar pro motor"}
          </button>
        </div>
        <div className="drive-row">
          {drive?.enabled ? (
            <>
              <span>☁️ google drive conectado{drive.lastSyncISO ? ` · último sync ${drive.lastSyncISO.slice(0, 16).replace("T", " ")}` : ""}</span>
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={driveBusy} onClick={() => void sincronizarDrive()}>
                {driveBusy ? "puxando..." : "sincronizar agora"}
              </button>
            </>
          ) : (
            <span>☁️ automação do drive: pronta no código — falta você criar a chave do Google (guia SETUP-DRIVE.md, ~10 min). aí a pasta das dailies alimenta o motor sozinha, todo dia às 7:57.</span>
          )}
        </div>
      </section>
    </>
  );
}
