# Setup Google Drive (dailies no inbox do motor)

Objetivo: os transcripts/resumos das dailies que caem na sua pasta do Drive entram sozinhos no inbox do dia como material `[DAILY]`. Leva uns 10 minutos, uma vez só.

## 1. Criar o projeto no Google Cloud

1. Abre [console.cloud.google.com](https://console.cloud.google.com) logado na sua conta Google.
2. Topo da tela, clica no seletor de projeto e depois em **Novo projeto**. Nome: `motor-x` (ou qualquer um). Cria.

## 2. Ativar a Drive API

1. Com o projeto selecionado, vai em **APIs e serviços > Biblioteca**.
2. Busca por **Google Drive API** e clica em **Ativar**.

## 3. Criar a service account

1. **APIs e serviços > Credenciais > Criar credenciais > Conta de serviço**.
2. Nome: `motor-x-drive`. Clica em **Criar e continuar**.
3. Na etapa de permissões (role), **não escolhe nada**, só clica em **Continuar** e depois **Concluir**. A conta só vai ler uma pasta compartilhada, não precisa de role no projeto.

## 4. Gerar a chave JSON

1. Na lista de contas de serviço, clica na que acabou de criar.
2. Aba **Chaves > Adicionar chave > Criar nova chave > JSON > Criar**.
3. Baixa o arquivo `.json`. Guarda bem: é a senha da conta.

## 5. Compartilhar a pasta do Drive

1. Abre o arquivo JSON e copia o valor de `client_email` (algo como `motor-x-drive@motor-x.iam.gserviceaccount.com`).
2. No Drive, na pasta onde caem os transcripts das dailies: botão direito > **Compartilhar** > cola esse email > permissão **Leitor** > Enviar (pode desmarcar "notificar").
3. Copia o ID da pasta: abre a pasta no navegador e pega o trecho final da URL, depois de `/folders/`. Exemplo: em `drive.google.com/drive/folders/1AbC...XyZ`, o ID é `1AbC...XyZ`.

## 6. Colar os 3 envs na Vercel

No projeto da Vercel: **Settings > Environment Variables**, adiciona:

| Nome | Valor |
|---|---|
| `GDRIVE_SA_EMAIL` | o `client_email` do JSON |
| `GDRIVE_SA_PRIVATE_KEY` | o `private_key` do JSON, INTEIRO |
| `GDRIVE_FOLDER_ID` | o ID da pasta (passo 5.3) |

**Detalhe importante da private key:** copia o valor de `private_key` exatamente como está no JSON, com os `\n` no meio do texto e com o `-----BEGIN PRIVATE KEY-----` e `-----END PRIVATE KEY-----` inclusos. Cola tudo numa linha só, do jeito que está no arquivo. O código normaliza os `\n` sozinho.

Depois de salvar, faz um **Redeploy** pra as envs valerem.

## 7. Testar

O sync roda sozinho no gather de todo run. Pra testar na hora, joga um arquivo de teste na pasta e roda um run manual pelo dashboard, ou chama `POST /api/drive/sync` logado. A resposta mostra `novos` e os nomes dos arquivos que entraram no inbox.

O que entra: Google Docs, `.txt`, `.vtt`, `.srt` e `.md` de até 300KB. Cada arquivo entra UMA vez (o motor guarda os IDs já processados). Outros tipos (imagem, planilha) são ignorados.
