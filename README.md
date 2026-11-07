# FOCUS — configuração do Supabase

Este guia explica como habilitar cadastro e login por e-mail/senha e acesso com Google, além de preparar uma tabela para os dados do FOCUS.

## Como a sincronização funciona

- Ao entrar com e-mail/senha ou Google, o FOCUS carrega o estado da tabela `public.user_data` da conta autenticada.
- Matérias, ciclos, disponibilidade, revisões e registros de afiliados são gravados no Supabase após cada alteração, além de permanecerem em `localStorage` como cópia local.
- Se a conta ainda não tiver uma linha no banco, os dados locais existentes neste navegador são enviados uma vez para a conta. Uma linha existente é sempre a fonte oficial, mesmo que esteja vazia (por exemplo, após apagar os dados), para não restaurar cópias antigas de outros dispositivos.
- “Continuar sem conta” continua usando somente o armazenamento local e não sincroniza entre dispositivos.
- Para habilitar a sincronização, configure as credenciais públicas do projeto e crie a tabela e as políticas RLS abaixo. Sem essa tabela/políticas, o login pode funcionar, mas a sincronização não.

## 1. Configurar o projeto Supabase

1. Crie ou abra um projeto em [supabase.com](https://supabase.com/).
2. No painel, abra **Project Settings → API** e copie a **Project URL** e a chave pública **anon/publishable**.
3. Em `script.js`, atualize `SUPABASE_URL` e `SUPABASE_ANON_KEY` com esses valores.

A chave `anon`/`publishable` é usada no navegador e não é um segredo. **Nunca coloque a chave `service_role` ou qualquer segredo administrativo no JavaScript, HTML ou repositório público.** A proteção dos dados deve ser feita com RLS, descrita abaixo.

## 2. Habilitar login com Google (OAuth)

### Criar as credenciais do Google

1. No [Google Cloud Console](https://console.cloud.google.com/), selecione ou crie um projeto e configure a tela de consentimento OAuth.
2. Crie uma credencial **OAuth Client ID** do tipo **Web application**.
3. Em **Authorized JavaScript origins**, adicione a origem onde o FOCUS será publicado, por exemplo `https://seu-dominio.com`. Adicione também a origem de desenvolvimento usada por você, se houver.
4. Em **Authorized redirect URIs**, adicione exatamente a URL de callback apresentada pelo Supabase. O formato normalmente é:

   ```text
   https://SEU_PROJECT_REF.supabase.co/auth/v1/callback
   ```

5. Copie o **Client ID** e o **Client Secret** gerados pelo Google.

### Conectar Google ao Supabase

1. No Supabase, abra **Authentication → Providers → Google** e habilite o provedor.
2. Cole o **Client ID** e o **Client Secret** do Google e salve.
3. Abra **Authentication → URL Configuration** e configure:
   - **Site URL**: endereço publicado do FOCUS;
   - **Redirect URLs**: inclua o endereço do FOCUS e os endereços locais usados para desenvolvimento, se necessário. Eles precisam corresponder ao endereço de retorno usado pelo aplicativo.
4. Publique/recarregue o app e teste **Continuar com Google**.

O segredo OAuth do Google fica **somente no painel do Supabase**. O botão usa `signInWithOAuth` e encaminha a pessoa ao Google; ela não precisa criar nem informar uma senha do FOCUS quando escolhe esse método. O Google pode pedir autenticação ou consentimento de acordo com a sessão e as configurações da conta.

## 3. Preparar uma tabela privada para os dados

Uma abordagem simples é guardar o estado inteiro do FOCUS em uma linha por usuário. No **SQL Editor** do Supabase, execute:

```sql
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "Usuário pode ler seus próprios dados"
on public.user_data for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Usuário pode inserir seus próprios dados"
on public.user_data for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Usuário pode atualizar seus próprios dados"
on public.user_data for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
```

Com RLS ativa, cada pessoa autenticada só pode consultar ou alterar a linha cujo `user_id` corresponde à sua sessão. Não desative RLS nem crie políticas que permitam acesso anônimo a todos os registros.

## 4. Sincronização de dados

A sincronização está ligada ao fluxo de autenticação em `script.js`: ao restaurar ou iniciar uma sessão, o app consulta `user_data` pelo `user_id`, normaliza o estado e atualiza as telas. Cada alteração é salva localmente e enviada ao banco com `upsert` após uma pequena pausa. A tela mostra o estado da sincronização.

No primeiro acesso a uma conta sem linha, os dados locais deste navegador são migrados para a conta. Se a linha da conta existir, mas estiver vazia enquanto este dispositivo tiver dados locais, o app pergunta se você deseja recuperar esses dados locais para a nuvem. Confirme apenas no dispositivo que contém os ciclos e dados que deseja preservar. Se a conta já tiver dados, a nuvem continua sendo a fonte oficial para evitar substituir informações mais recentes por uma cópia local antiga.

A sincronização é feita ao entrar e quando cada alteração é salva. Ao voltar para a aba do app, ele também busca atualizações mais recentes da conta. Não há atualização instantânea enquanto duas telas permanecem abertas e ativas ao mesmo tempo; volte à aba ou entre novamente para buscar os dados mais recentes.

## Segurança e publicação

- A chave pública `anon`/`publishable` pode estar no cliente **somente com RLS corretamente configurada**.
- Nunca exponha `service_role`, senha do banco, Client Secret do Google ou tokens privados no frontend.
- Configure as origens e URLs de redirecionamento para os domínios reais do app; evite liberar domínios desnecessários.
- Antes de usar dados reais, teste com duas contas diferentes e confirme que cada uma só consegue acessar os próprios dados.
