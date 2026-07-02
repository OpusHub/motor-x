# Motor X Autônomo

Pipeline 100% automatizado de posts pro X do @victoryulo. Roda sozinho todo dia num cron da Vercel:
coleta contexto → gera pautas → escreve na voz do Victor → passa pelo crítico → agenda → publica via Zernio → avisa no Telegram.
Next.js na Vercel + API Anthropic (claude-opus-4-8) + Zernio (publicação) + Vercel Blob (estado).

```
cron diário 05:57 BRT (/api/cron/daily)
        │
        ▼
   ┌─────────┐   inbox (Telegram @inbox + dashboard)
   │ gather  │◄─ trends do nicho (twitterapi.io)
   └────┬────┘   banco de fatos + histórico 7 dias + âncoras de voz
        ▼
   ┌──────────┐
   │ pauteiro │  decide o que vale postar hoje (pautas com slot-de-fato)
   └────┬─────┘
        ▼
   ┌─────────────┐
   │ ghostwriter │  1 chamada por pauta, em paralelo, voz do voice-model
   └────┬────────┘
        ▼
   ┌─────────┐
   │ crítico │  rubrica + gate cego (nota >= 75) + checagem de lote
   └────┬────┘   (mata slop, staccato, fato inventado)
        ▼
   ┌──────────────┐
   │ editor-chefe │  seleção final + ordem do dia
   └────┬─────────┘
        ▼
  agendamento determinístico (janelas 11–14h / 17–20h BRT)
        ▼
  Zernio publica no X ──► Telegram avisa o Victor
```

## Princípios inegociáveis

- **A voz do voice-model é a régua.** O ghostwriter escreve com âncoras reais dos tweets recentes do Victor; o crítico reprova o que não passa no teste cego.
- **Slot-de-fato real obrigatório.** Toda pauta ancora num fato do banco (`facts.json` + banco estático). O sistema **nunca inventa número**. Sem fato, a pauta morre.
- **O crítico mata slop antes de publicar.** Gate cego com nota mínima 75 + checagem de lote (repetição, staccato, voz-de-IA).
- **Quota é teto, não meta.** Dia fraco publica menos. Zero post é resultado válido.
- **Kill switch no dashboard.** Pausa tudo com um toggle; nenhum post sai.

## Setup do zero

```bash
bun install
vercel link
vercel blob store add x-content   # cria o Blob store (estado do pipeline)
vercel env pull                   # puxa BLOB_READ_WRITE_TOKEN
```

Configure as env vars na Vercel (ou `.env.local` pra dev):

| Var | O que é | Onde conseguir |
|---|---|---|
| `ANTHROPIC_API_KEY` | Gera pautas/drafts/críticas | console.anthropic.com |
| `ZERNIO_API_KEY` | Publica no X | painel do Zernio |
| `ZERNIO_PROFILE_ID` | Perfil @victoryulo no Zernio | painel do Zernio (já tem default no `.env.example`) |
| `BLOB_READ_WRITE_TOKEN` | Estado no Vercel Blob | auto via `vercel env pull` |
| `TELEGRAM_BOT_TOKEN` | Bot de notificação | @BotFather |
| `TELEGRAM_CHAT_ID` | Chat do Victor | já no `.env.example` |
| `TELEGRAM_INBOX_BOT_TOKEN` | Bot do inbox de ideias | @BotFather |
| `TWITTERAPI_IO_KEY` | Trends + âncoras de voz ao vivo | twitterapi.io |
| `DASHBOARD_PASSWORD` | Login do dashboard | você escolhe |
| `CRON_SECRET` | Protege o endpoint do cron | você escolhe (e configura na Vercel) |
| `MODEL_ID` | Opcional, default `claude-opus-4-8` | — |

Depois:

```bash
vercel deploy --prod
```

E conecte a conta X via dashboard (`/api/connect/x` pelo botão na UI).

## Operação diária

- **Sozinho:** cron 05:57 BRT dispara o run completo; posts saem agendados nas janelas 11–14h e 17–20h BRT; cada publicação chega como notificação no Telegram.
- **Acompanhar pelo celular:** dashboard (status do run, posts do dia, log) + Telegram (avisos e resumo).
- **Editar/matar post:** no dashboard, cada post agendado tem editar/deletar (`PATCH`/`DELETE /api/posts/[id]`) antes da janela de publicação.
- **Jogar ideia no inbox:** manda mensagem/áudio pro bot de inbox no Telegram, ou digita no campo de inbox do dashboard — entra no gather do dia seguinte (ou do run manual).
- **Pausar:** kill switch no dashboard (config). Nada publica até religar.

## Teste local

```bash
bun run scripts/e2e.ts
```

Roda o pipeline inteiro em **modo review**: gera tudo até rascunhos, não agenda nem publica nada.

## Arquitetura

- **Máquina de estados retomável.** O run é uma sequência de estágios (`gather → pauteiro → ghostwriter → critico → editor → schedule`) persistida no Vercel Blob (`runs/{id}.json`). Cada request responde cedo e encadeia o próximo estágio via `waitUntil` + chamada a `/api/run/continue` — nenhum estágio estoura o timeout da função, e qualquer run pode ser retomado de onde parou.
- **Estado 100% no Vercel Blob:** runs, posts (`posts/{date}/{pautaId}.json`), config, inbox, banco de fatos dinâmico. Sem banco de dados.
- **Custos estimados:** ~5-7 posts/dia com claude-opus-4-8 = poucos dólares/dia de API; publicação via Zernio ~$0.015/tweet na X API. Ordem de grandeza: < $100/mês.
- **LinkedIn = fase 2.** Já existe toggle no config; o pipeline foi desenhado multi-plataforma, mas só X está ligado.

## Solução de problemas

- **Run travado num estágio:** botão "retomar" no dashboard, ou manualmente `POST /api/run/continue` com o id do run. A máquina de estados retoma do estágio salvo.
- **Conta X desconectada:** o Zernio devolve erro na publicação e o Telegram avisa. Reconecte pelo dashboard (`/api/connect/x`) e reagende os posts pendentes.
- **Rotação de chaves:** as chaves de Zernio, Telegram e twitterapi.io foram expostas em chat em jul/2026 — **rotacione todas** (painel do Zernio, @BotFather, twitterapi.io) e atualize as env vars na Vercel (`vercel env`), depois redeploy.
