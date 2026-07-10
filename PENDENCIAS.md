# Pendências do Motor X — atualizado 2026-07-10

## ✅ RESOLVIDO — Victor fez upgrade pro Vercel Pro (10/jul)

Os 4 blob stores voltaram a "Active", confirmado com o mesmo trigger que dava 500 (agora 202 normal) e um run de teste ponta a ponta. Além disso apliquei blindagem técnica pra não estourar de novo: `getJSON` deixou de usar `list()` (Advanced Operation) em toda leitura — agora lê por URL determinística do Blob (fetch HTTP comum, sem custo de cota); o histórico de 7 dias no gather virou 1 `list()` só em vez de 7. Commit `b57b81c`.

## (histórico) O bloqueador de hoje cedo, mantido pra registro

**O que aconteceu:** o Vercel Blob (onde vive TODO o estado do motor: runs, posts, config, dicionário, prompts, lições) estourou a cota grátis de **"Advanced Operations"** do plano Hobby: **2.051 / 2.000** no ciclo atual. A Vercel suspendeu o store inteiro — toda leitura/escrita falha com `Vercel Blob: This store has been suspended`. Reset automático só em **09/08/2026** (quase 2 meses).

**Por que sumiu o post e depois deu 500 (o que você viu hoje):** o 1º "Gerar agora" rodou até bater o teto no meio do caminho (por isso sumiu — o run nunca terminou de salvar o resultado final). O 2º clique já achou o store suspenso → 500 imediato. Reproduzi o erro ao vivo e confirmei o log exato:
```
Error: Vercel Blob: This store has been suspended.
```

**Escopo real (confirmado no painel Vercel):** a suspensão é **por TIME inteiro** (Opus Hub), não só do motor-x — os 4 blob stores do time (incluindo os do saga-web) estão todos suspensos juntos. `x-autopilot-blob` (o do motor-x) sozinho é 93% do consumo.

**Causa — sendo direto:** "Advanced Operations" no Vercel Blob = `list()` e `del()`. O código faz `list()` demais (7 chamadas só pra montar o histórico de 7 dias, a cada run; +2 a cada vez que o dashboard carrega uma data). Mas o grosso do estouro desta semana **fui eu**: rodei dezenas de scripts de teste/debug/resgate local contra o Blob de PRODUÇÃO nos últimos dias (mesma cota, mesmo teto). Registro isso sem rodeio porque é fato meu, não seu.

### As opções (decisão sua, é dinheiro):

1. **Upgrade pro Vercel Pro** ($20/mês, inclui $20 de crédito de uso) — destrava na hora, some o teto de 2k. Resolve motor-x E o bloqueio do saga-web-assets de brinde. Link: Vercel → Opus Hub → Settings → Billing → Upgrade.
2. **Esperar até 09/08** — sistema fica fora do ar quase 2 meses. Não recomendo.
3. **Migrar o storage do motor-x pra outro lugar** (ex: Cloudflare R2, que você já tem configurado no ecossistema) — sem esse teto agressivo, mas é retrabalho de engenharia (não é botão, é 1-2 sessões). Faço se você preferir essa rota a pagar Vercel.

**Minha recomendação:** opção 1 agora (mais rápido, resolve hoje, $20/mês é o preço de um café ao dia) — e a opção 3 (migrar pra R2) como projeto de fundo depois, pra nunca mais depender desse teto de 2k. Me diz qual caminho e eu executo.

**O que eu NÃO fiz sozinho:** não cliquei em "Upgrade to Pro" — é ação de billing, só você decide/executa isso.

---

## Mitigação técnica (posso fazer assim que destravar, sem custo)

Reduzir o consumo de Advanced Operations pra não estourar de novo, seja qual for a decisão acima:
- Trocar as 7 chamadas de `list()` do histórico (uma por dia) por 1 chamada só, com filtro no código.
- Cachear a leitura de posts/runs no dashboard por alguns segundos em vez de `list()` a cada troca de tela/data.
- Eu já não vou mais rodar scripts de debug direto contra o Blob de produção pra testes rotineiros — uso mock/local daqui pra frente.

---

## ✅ RESOLVIDO — watchdog virou rede de segurança de verdade (10/jul, commit `116ea95`)

**O gatilho:** o run que travou hoje (timeout de 80s no editor) revelou que a única forma de recuperação era eu intervir manualmente. Victor perguntou direto: "tem risco de acontecer timeout e eu ficar sem post?" — resposta: tinha, sim.

**3 falhas encontradas e corrigidas:**
1. Editor sem `timeoutMs` próprio (caía no default de 80s, curto) → agora 110s.
2. Watchdog só rodava 1x/dia às 13h (limite do Hobby) → agora a cada 20min, das 8h às 20h BRT (o upgrade pro Pro desbloqueou isso).
3. Achado testando ao vivo: existe um 3º tipo de falha — run trava SEM registrar erro (função morre antes de salvar). Ficava invisível pro watchdog. Agora ele também detecta "parado há +18min sem progresso", não só erro explícito.

**Testado sob fogo, não só no papel:** disparei o watchdog manualmente, ele achou e tentou reviver um run travado de verdade; a trava de segurança (`mode=review`) impediu publicação indevida antes de eu confirmar e arquivar o run de teste. Ciclo completo validado.

---

## Outras pendências conhecidas (sem urgência, registradas pra retomar)

- **Google Drive (dailies → inbox automático):** código pronto (`src/lib/drive.ts`, rota `/api/drive/sync`, guia `SETUP-DRIVE.md`), mas **você ainda não criou a chave de service account no Google Cloud** — sem isso fica `enabled: false`, no-op silencioso, não quebra nada. ~10 min quando quiser.
- **Checkpoint de conteúdo (combinado 04/jul):** dia 11/jul checkpoint leve, dia 18/jul veredito de verdade sobre o que manter/cortar.
- **Custo do modelo (Sonnet 5 no ghostwriter+crítico):** rodando desde 06/jul, medir a média real de alguns dias limpos antes de decidir o dial final (Sonnet vs Haiku vs kimi).
- **Rotação de chaves** coladas em conversas antigas (Zernio, OpenRouter, Telegram, twitterapi) — ainda pendente, baixa urgência mas não esquecer.
- **Projeto zumbi `x-autopilot`** na Vercel (o antigo, pré-migração pra `motor-x`) — cron duplicado inofensivo, mas vale deletar um dia (desvincular o blob store antes de apagar).
