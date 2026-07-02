"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      setError(res.status === 401 ? "senha errada" : `erro ${res.status}`);
    } catch {
      setError("falha de rede — tenta de novo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="login-card card" onSubmit={submit}>
        <h1>motor x</h1>
        <input
          className="input"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          placeholder="senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !password}>
          {busy ? "entrando..." : "entrar"}
        </button>
        {error && <p className="login-error">{error}</p>}
      </form>
    </main>
  );
}
