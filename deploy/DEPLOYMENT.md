# Guia de Publicação e Deploy em Produção — G-Click Enquete Sync

Este guia detalha o processo de publicação, configuração de ambiente e operação em produção da aplicação **G-Click Enquete Sync**.

---

## 1. Arquitetura em Produção

```
[ Usuário / Navegador ]
          │ (HTTPS - Porta 443)
          ▼
[ Reverse Proxy: Caddy ou Nginx ] (Certificado SSL Automático Let's Encrypt)
          │ (HTTP interno - Porta 8766)
          ▼
[ Container Docker ou PM2 Node 22 ]
    ├── Servidor HTTP (automacao/server.mjs)
    ├── Autenticação RBAC + Overrides (SQLite auth.db)
    ├── Interface Web Segura (Login Obrigatório)
    └── Motor Playwright (Interação com G-Click e Navegador)
```

---

## 2. Requisitos do Servidor

- **Sistema Operacional:** Linux Ubuntu 22.04 LTS ou superior (ou Debian 12).
- **Recursos Recomendados:**
  - Mínimo: 2 vCPUs, 2 GB RAM, 20 GB SSD.
  - Recomendado: 4 vCPUs, 4 GB RAM (para suportar o Chromium do Playwright de forma fluida).
- **Softwares Necessários:**
  - Docker + Docker Compose **OU** Node.js 22 + Chromium.
  - Caddy ou Nginx para terminação TLS (HTTPS).

---

## 3. Opção A: Publicação com Docker & Docker Compose (Recomendada)

### Passo 1: Clonar o Repositório e Configurar Variáveis
```bash
git clone <url-do-repositorio> gclick-sync
cd gclick-sync
cp .env.example .env
nano .env  # Defina a senha do admin e portas desejadas
```

### Passo 2: Construir e Subir os Contêineres
```bash
docker compose up -d --build
```

O comando irá:
1. Construir a imagem baseada em `mcr.microsoft.com/playwright:v1.48.0-noble` com Node 22 e Chromium.
2. Instalar as dependências de produção.
3. Criar os volumes persistentes (`gclick_data`, `gclick_catalogos`, `gclick_registros`, `gclick_runs`).
4. Iniciar o serviço ouvindo na porta `127.0.0.1:8766`.

### Passo 3: Configurar HTTPS com Caddy
Instale o Caddy no servidor hospedeiro:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Copie a configuração de `deploy/Caddyfile` para `/etc/caddy/Caddyfile`:
```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile # Altere seu-dominio.com.br pelo seu domínio real
sudo systemctl reload caddy
```

---

## 4. Opção B: Publicação Direta com PM2 (Bare Metal ou VPS)

Caso prefira rodar diretamente no servidor sem Docker:

### Passo 1: Instalar Node 22 e Dependências do Sistema
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### Passo 2: Instalar Dependências e Navegadores Playwright
```bash
cd automacao
npm ci --omit=dev
npx playwright install --with-deps chromium
```

### Passo 3: Iniciar com PM2
```bash
pm2 start server.mjs --name "gclick-enquete-sync" --time
pm2 save
pm2 startup
```

---

## 5. Primeiro Acesso e Configuração de Segurança

1. Acesse `https://seu-dominio.com.br/`.
2. A tela de login solicitará credenciais.
3. Utilize as credenciais iniciais:
   - **E-mail:** `admin@gclick.local`
   - **Senha:** `Admin@123456`
4. Acesse o menu **Módulo de Administração & Acessos** -> **Usuários & Permissões**:
   - Crie novos usuários para sua equipe com seus respectivos papéis (`admin`, `operador` ou `auditor`).
   - Configure contas liberadas por usuário (ex: `2420`, `6581` ou `*` para todas).
   - Defina exceções individuais no botão **Overrides** quando necessário.
   - Altere a senha do usuário `admin@gclick.local` ou crie outro superadministrador e desative o usuário padrão.

---

## 6. Rotinas de Manutenção e Backup

- **Banco de Dados SQLite (`auth.db`):** Contém usuários, cargos, permissões e sessões.
  - Localização: `/app/automacao/data/auth.db` (no Docker) ou `automacao/auth.db` (PM2).
  - Backup: Copiar o arquivo `auth.db` com `sqlite3 auth.db ".backup backup-$(date +%F).db"`.
- **Sessão do Navegador (G-Click):**
  - Mantida no diretório configurado em `GCLICK_PROFILE_DIR`.
  - Quando a sessão expirar, o operador deve utilizar o painel "Conexão & Conta G-Click" para efetuar nova autenticação.
