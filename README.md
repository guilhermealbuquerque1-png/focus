# FOCUS — configuração do Supabase

Este guia explica como habilitar cadastro e login por e-mail/senha e acesso com Google, além de preparar uma tabela para os dados do FOCUS.

## Como está integrado hoje

- A tela inicial já chama a autenticação do Supabase para entrar/criar conta e iniciar OAuth com Google.
- **Entrar com Google não exige uma senha do FOCUS**: a pessoa autoriza a própria conta Google e retorna autenticada ao aplicativo.
- Os dados do organizador (matérias, ciclos, disponibilidade, revisões e afiliados) **ainda são salvos apenas no `localStorage` do navegador**. Fazer login não os sincroniza com o banco; a etapa de leitura e gravação no banco ainda precisa ser implementada.
- “Continuar sem conta” acessa o organizador sem autenticação e também usa armazenamento local.

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

## 4. Conectar o estado do FOCUS ao banco

A instância do cliente Supabase já é criada em `script.js` como `supabaseClient`. Depois do login, a aplicação precisa carregar os dados do usuário e substituir `loadState()`/`saveState()` por operações *****íncronas na tabela `user_data`.

Exemplo básico de leitura após autenticação:

```js
const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
if (userError) throw userError;

const { data, error } = await supabaseClient
  .from('user_data')
  .select('data')
  .eq('user_id', user.id)
  .maybeSingle();

if (error) throw error;
// Se data existir, validar/normalizar data.data antes de usar como estado do FOCUS.
```

Exemplo básico para salvar o estado atual (`state`):

```js
const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
if (userError) throw userError;

const { error } = await supabaseClient
  .from('user_data')
  .upsert({
    user_id: user.id,
    data: state,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });

if (error) throw error;
```

Esses exemplos são uma referência; **não estão conectados automaticamente ao salvamento atual**. Para completar a sincronização, a implementação deve:

1. Aguardar a sessão Supabase ser restaurada e só então buscar os dados do usuário;
2. Normalizar os dados recebidos com `normalizeState()` e atualizar as telas;
3. Persistir alterações com `upsert` para sessões autenticadas, mantendo `localStorage` como alternativa para acesso local/offline, se desejado;
4. Definir como migrar os dados locais existentes e como resolver alterações feitas em mais de um dispositivo;
5. Tratar erros e estados de carregamento sem sobrescrever dados do banco com um estado vazio.

## Segurança e publicação

- A chave pública `anon`/`publishable` pode estar no cliente **somente com RLS corretamente configurada**.
- Nunca exponha `service_role`, senha do banco, Client Secret do Google ou tokens privados no frontend.
- Configure as origens e URLs de redirecionamento para os domínios reais do app; evite liberar domínios desnecessários.
- Antes de usar dados reais, teste com duas contas diferentes e confirme que cada uma só consegue acessar os próprios dados.
