"use client";

import { useEffect, useState } from "react";

// Seção VOZ do dashboard: dicionário (banidas/preferidas, estilo negative
// keywords) + prompts dos agentes editáveis. O Victor otimiza a voz direto
// daqui, sem depender de sessão de código.

interface TermoBanido { termo: string; tipo: "palavra" | "frase" | "regex"; motivo: string; ativo: boolean }
interface TermoPreferido { termo: string; nota: string; ativo: boolean }
interface Dicionario { banidas: TermoBanido[]; preferidas: TermoPreferido[] }
interface PromptItem { key: string; titulo: string; conteudo: string; customizado: boolean }

const JSON_HEADERS = { "Content-Type": "application/json" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export function VozSection({ showToast }: { showToast: (msg: string) => void }) {
  const [dic, setDic] = useState<Dicionario | null>(null);
  const [dicBusy, setDicBusy] = useState(false);
  const [novoTermo, setNovoTermo] = useState("");
  const [novoTipo, setNovoTipo] = useState<TermoBanido["tipo"]>("frase");
  const [novoMotivo, setNovoMotivo] = useState("");
  const [novaPreferida, setNovaPreferida] = useState("");
  const [novaNota, setNovaNota] = useState("");

  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [promptKey, setPromptKey] = useState<string>("");
  const [promptText, setPromptText] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setDic(await api<Dicionario>("/api/dicionario"));
        const p = await api<{ prompts: PromptItem[] }>("/api/prompts");
        setPrompts(p.prompts);
        if (p.prompts[0]) {
          setPromptKey(p.prompts[0].key);
          setPromptText(p.prompts[0].conteudo);
        }
      } catch {
        // painel de voz é acessório; não derruba o dashboard
      }
    })();
  }, []);

  async function salvarDicionario(next: Dicionario) {
    setDicBusy(true);
    try {
      await api("/api/dicionario", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(next) });
      setDic(next);
      showToast("dicionário salvo ✓ (vale no próximo run)");
    } catch (err) {
      showToast(`dicionário: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDicBusy(false);
    }
  }

  function selecionarPrompt(key: string) {
    setPromptKey(key);
    const p = prompts.find((x) => x.key === key);
    setPromptText(p?.conteudo ?? "");
  }

  async function salvarPrompt() {
    setPromptBusy(true);
    try {
      await api("/api/prompts", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ key: promptKey, md: promptText }) });
      setPrompts((cur) => cur.map((p) => (p.key === promptKey ? { ...p, conteudo: promptText, customizado: true } : p)));
      showToast("prompt salvo ✓ (vale no próximo run)");
    } catch (err) {
      showToast(`prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPromptBusy(false);
    }
  }

  async function restaurarPrompt() {
    setPromptBusy(true);
    try {
      await api(`/api/prompts?key=${promptKey}`, { method: "DELETE" });
      const p = await api<{ prompts: PromptItem[] }>("/api/prompts");
      setPrompts(p.prompts);
      const atual = p.prompts.find((x) => x.key === promptKey);
      setPromptText(atual?.conteudo ?? "");
      showToast("prompt restaurado pro padrão ✓");
    } catch (err) {
      showToast(`prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPromptBusy(false);
    }
  }

  const atual = prompts.find((p) => p.key === promptKey);

  return (
    <section className="card">
      <details className="settings-details">
        <summary>
          voz &amp; prompts
          <span className="small muted" style={{ marginLeft: 8 }}>
            dicionário de palavras + prompts dos agentes, editáveis
          </span>
        </summary>

        {dic ? (
          <>
            <div className="setting-row setting-range">
              <span className="setting-label">
                palavras/frases BANIDAS
                <span className="small muted">o lint mata qualquer post que usar (tipo palavra = exata; frase = contém; regex = padrão)</span>
              </span>
              {dic.banidas.map((b, i) => (
                <div key={i} className="btn-row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
                  <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, opacity: b.ativo ? 1 : 0.45 }}>
                    <input
                      type="checkbox"
                      checked={b.ativo}
                      onChange={(e) => {
                        const next = { ...dic, banidas: dic.banidas.map((x, j) => (j === i ? { ...x, ativo: e.target.checked } : x)) };
                        void salvarDicionario(next);
                      }}
                    />
                    <code style={{ wordBreak: "break-all" }}>{b.termo}</code>
                    <span className="muted">({b.tipo}{b.motivo ? ` · ${b.motivo}` : ""})</span>
                  </label>
                  <button
                    className="btn btn-sm"
                    disabled={dicBusy}
                    onClick={() => void salvarDicionario({ ...dic, banidas: dic.banidas.filter((_, j) => j !== i) })}
                  >
                    remover
                  </button>
                </div>
              ))}
              <div className="btn-row" style={{ marginTop: 10 }}>
                <input className="input" style={{ flex: 2, minWidth: 120 }} placeholder="termo ou padrão" value={novoTermo} onChange={(e) => setNovoTermo(e.target.value)} />
                <select className="input" style={{ width: 100 }} value={novoTipo} onChange={(e) => setNovoTipo(e.target.value as TermoBanido["tipo"])}>
                  <option value="frase">frase</option>
                  <option value="palavra">palavra</option>
                  <option value="regex">regex</option>
                </select>
                <input className="input" style={{ flex: 2, minWidth: 120 }} placeholder="motivo (opcional)" value={novoMotivo} onChange={(e) => setNovoMotivo(e.target.value)} />
                <button
                  className="btn btn-sm"
                  disabled={dicBusy || !novoTermo.trim()}
                  onClick={() => {
                    void salvarDicionario({ ...dic, banidas: [...dic.banidas, { termo: novoTermo.trim(), tipo: novoTipo, motivo: novoMotivo.trim(), ativo: true }] });
                    setNovoTermo("");
                    setNovoMotivo("");
                  }}
                >
                  banir
                </button>
              </div>
            </div>

            <div className="setting-row setting-range">
              <span className="setting-label">
                vocabulário PREFERIDO
                <span className="small muted">palavras suas que o escritor deve usar (com a dose anotada)</span>
              </span>
              {dic.preferidas.map((p, i) => (
                <div key={i} className="btn-row" style={{ marginTop: 6, alignItems: "center", gap: 8 }}>
                  <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, opacity: p.ativo ? 1 : 0.45 }}>
                    <input
                      type="checkbox"
                      checked={p.ativo}
                      onChange={(e) => {
                        const next = { ...dic, preferidas: dic.preferidas.map((x, j) => (j === i ? { ...x, ativo: e.target.checked } : x)) };
                        void salvarDicionario(next);
                      }}
                    />
                    <code>{p.termo}</code>
                    <span className="muted">{p.nota}</span>
                  </label>
                  <button
                    className="btn btn-sm"
                    disabled={dicBusy}
                    onClick={() => void salvarDicionario({ ...dic, preferidas: dic.preferidas.filter((_, j) => j !== i) })}
                  >
                    remover
                  </button>
                </div>
              ))}
              <div className="btn-row" style={{ marginTop: 10 }}>
                <input className="input" style={{ flex: 1, minWidth: 100 }} placeholder='palavra (ex: "papo reto")' value={novaPreferida} onChange={(e) => setNovaPreferida(e.target.value)} />
                <input className="input" style={{ flex: 2, minWidth: 140 }} placeholder="dose (ex: no máx 1x por post)" value={novaNota} onChange={(e) => setNovaNota(e.target.value)} />
                <button
                  className="btn btn-sm"
                  disabled={dicBusy || !novaPreferida.trim()}
                  onClick={() => {
                    void salvarDicionario({ ...dic, preferidas: [...dic.preferidas, { termo: novaPreferida.trim(), nota: novaNota.trim(), ativo: true }] });
                    setNovaPreferida("");
                    setNovaNota("");
                  }}
                >
                  adicionar
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="empty">carregando dicionário...</p>
        )}

        <div className="setting-row setting-range">
          <span className="setting-label">
            prompts dos agentes
            <span className="small muted">edite e salve; &quot;restaurar&quot; volta pro padrão do código</span>
          </span>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <select className="input" style={{ flex: 1 }} value={promptKey} onChange={(e) => selecionarPrompt(e.target.value)}>
              {prompts.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.titulo}{p.customizado ? " (customizado)" : ""}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="input"
            style={{ marginTop: 8, width: "100%", minHeight: 260, fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
          />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => void salvarPrompt()} disabled={promptBusy || !promptKey || promptText.trim().length < 20}>
              {promptBusy ? "..." : "salvar prompt"}
            </button>
            {atual?.customizado && (
              <button className="btn btn-sm" onClick={() => void restaurarPrompt()} disabled={promptBusy}>
                restaurar padrão
              </button>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
