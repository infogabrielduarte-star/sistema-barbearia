# Colocar o sistema no ar — Hostinger + Supabase

O sistema começa **zerado**: sem atendimentos, clientes ou vendas de teste. Já vêm cadastrados os serviços e preços, os 3 profissionais, o horário (terça a sábado, 9h–19h, almoço 12h–13h) e as % da barbearia (valores de exemplo: Rafael 30%, Bruno 40%, Lucas 50%).

## 1. Banco de dados (Supabase) — uns 10 minutos
1. Entre em supabase.com → **New project**. Nome: `barbearia`. Região: **South America (São Paulo)**. Crie uma senha forte para o banco e **guarde**.
2. Quando o projeto estiver pronto: menu **SQL Editor** → **New query**.
3. Abra o arquivo `db/instalar-supabase.sql` (no VS Code), copie **tudo**, cole no SQL Editor e clique **Run**. Deve terminar com "Success".
4. Botão **Connect** (topo) → aba **Session pooler** → copie a *connection string* (começa com `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-...pooler.supabase.com:5432/postgres`). Troque `[YOUR-PASSWORD]` pela senha do passo 1.
   - Use o **Session pooler**, não a "Direct connection": a direta só funciona em IPv6 e a Hostinger usa IPv4.

## 2. Site e sistema (Hostinger) — plano Business ou Cloud
1. hPanel → **Sites** → **Adicionar site** → **Node.js Apps** (Aplicativo Node.js).
2. Escolha **Enviar arquivos** e mande o o zip do projeto (sem `node_modules`, `preview`, `tests` e `docs`).
3. Configurações de build:
   - Versão do Node: **24.x** (ou 22.x, desde que seja 22.18 ou mais nova)
   - Comando de instalação: `npm install` (padrão) · Comando de início: `npm start`
   - Diretório/arquivo de entrada: raiz do projeto (o `package.json` está nela)
4. **Variáveis de ambiente** (Environment variables):
   | Nome | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do Supabase (passo 1.4) |
   | `NODE_ENV` | `production` |
   | `CODIGO_PRIMEIRO_ACESSO` | invente um código com 12+ caracteres (ex.: `inicio-` + números) |
5. **Implantar** (Deploy). Ao terminar, a Hostinger mostra um endereço temporário. Abra: o site deve aparecer com os horários livres funcionando.

## 3. Primeiro acesso do Rafael
1. Abra `https://ENDERECO-DO-SITE/primeiro-acesso.html`.
2. Informe o `CODIGO_PRIMEIRO_ACESSO`, o usuário (`dono`) e a senha dele (mínimo 12 caracteres, de preferência ele mesmo digita).
3. Pronto: a página se desliga sozinha. (Pode apagar a variável `CODIGO_PRIMEIRO_ACESSO` depois.)
4. Rafael entra em **Área dos barbeiros**, vai em **Equipe e acessos** e cria o login do Bruno (`bruno`) e do Lucas (`lucas`).

## 4. Domínio suabarbearia.com.br
1. Registre em **registro.br** (≈ R$ 40/ano).
2. No hPanel, no site Node.js → **Domínios** → conectar `suabarbearia.com.br`. A Hostinger mostra os registros DNS (ou servidores DNS) para colocar no Registro.br.
3. No Registro.br → seu domínio → **DNS** → altere para os servidores da Hostinger (ou crie os registros indicados). Pode levar algumas horas.
4. O HTTPS (cadeado) é ativado pela Hostinger no domínio.

## Depois de publicado
- Teste: agende pelo site, veja aparecer na agenda do profissional, conclua o atendimento e confira o Financeiro.
- Backup: o Supabase faz backup diário no plano pago; no gratuito, exporte de vez em quando (Database → Backups).
- Atualizações futuras: envie o novo zip pela Hostinger. Se houver migração nova, ela vem num arquivo `.sql` para rodar no SQL Editor.
