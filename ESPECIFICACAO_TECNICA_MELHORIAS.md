# Documento de Especificação Técnica de Melhorias (Enquete Sync / G-Click Automação)

**Data:** 28 de Outubro de 2026
**Autor:** Jules (Software Engineer)
**Versão:** 1.0.0
**Status:** Proposta / Análise de Arquitetura & UX

---

## 1. Visão Geral e Objetivos

Este documento apresenta um diagnóstico aprofundado e uma especificação técnica detalhada de melhorias para a plataforma **Enquete Sync** (G-Click Automação). O estudo abrange:
1. **Análise de Layout, UX/UI e Design System** (comparando o estado atual com os conceitos visuais de vanguarda dos projetos HoraSync e Nexora DevKit).
2. **Revisão de Backend, Funções e Qualidade de Código** (arquitetura, concorrência, modularidade, resiliência e aderência aos princípios SOLID/SoC do `AGENTS.md`).

Em conformidade com a solicitação do usuário (*"Não code nada. Ao final gere um documento de especificação técnica de melhorias que encontrar"*), nenhuma alteração de código foi aplicada à base de código nesta etapa.

---

## 2. Análise de Layout & Design (Frontend & UX)

### 2.1 Diagnóstico do Estado Atual (`automacao/ui/`)
- **Estilo Visual Tradicional:** O layout atual utiliza um tema claro/escuro básico (`--bg-app: #f4f7f6`, `--gclick-dark: #0d282e`) inspirado em sistemas administrativos corporativos legados.
- **Hierarquia e Densidade Informacional:**
  - A interface apresenta uma barra lateral profunda com múltiplos subníveis de árvore (`nav-tree-branch`, `nav-nested-branch`), o que gera ruído cognitivo e sobrecarrega a navegação do operador.
  - Seções com cartões grandes e formulários verticais sequenciais reduzem a eficiência na visualização simultânea de conciliação de clientes e relatórios.
- **Micro-interações e Componentes:**
  - A visualização de tabelas e listas de tarefas utiliza bordas sólidas e cantos pouco refinados (`6px` a `10px`).
  - Faltam indicadores de status em tempo real com micro-animações (ex: pulsing dots para status da nuvem/sincronização) e tipografia monoespaçada tabular dedicada para dados numéricos/CNPJ/horários.

### 2.2 Proposta de Redesign (Inspirada no Design System HoraSync / Nexora)
- **Tema Obsidian Dark & Glassmorphism Cirúrgico:**
  - Adotar paleta de superfície profunda (`#0B0F17` base, `#141A27` cards) com bordas translúcidas de 1px (`rgba(255, 255, 255, 0.08)`) e destaques em Violeta Elétrico (`#7C3AED` / `#4F46E5`) e Esmeralda Métrico (`#10B981`).
- **Navegação em Cockpit Híbrido (Linear Style):**
  - Condensar a sidebar para uma largura fixa de `220px` / `240px` com ícones vetoriais limpos, selos de contagem compactos e categorização por módulos planos.
  - Eliminar a árvore de subníveis aninhados na navegação principal, migrando opções secundárias para tabs de segmento em topo de painel (`Segmented Tabs`).
- **Tipografia Funcional Dupla:**
  - **Plus Jakarta Sans / Inter:** Para títulos, rótulos de navegação, ações e modais.
  - **JetBrains Mono:** Obrigatoriamente para exibição de CNPJs, códigos de tarefas, indicadores percentuais, contadores de lotes e timestamps de sincronização (prevenindo *layout shift*).
- **KPI Cards & Feed de Atividades Recentes:**
  - Substituir containers vazios (*empty states*) por cartões de métricas compactos e sparklines visuais de status (ex: % de clientes concilidados, taxa de convergência da enquete, pendências por categoria).

---

## 3. Revisão de Backend, Funções e Qualidade de Código

### 3.1 Diagnóstico de Arquitetura e Código (`automacao/server.mjs` & `automacao/lib/`)

#### A. Arquitetura Monolítica no Servidor HTTP (`server.mjs` - 1.600 linhas)
- **Problema:** O arquivo `server.mjs` concentra responsabilidades de servidor HTTP, roteamento de API (mais de 25 endpoints), gerenciamento de processo/locks, orquestração de Playwright, manipulação de arquivos JSON/CSV, autenticação e controle de sessão RBAC.
- **Impacto:** Viola o Princípio da Responsabilidade Única (SRP) do SOLID e dificulta a manutenção e testes unitários das rotas.

#### B. Complexidade Extrema e Monolitos em `obrigacoes.mjs` (2.346 linhas)
- **Problema:** O arquivo `obrigacoes.mjs` possui funções massivas (ex: `syncObrigacoesComCanais` e rotinas de automação DOM) com lógica deeply nested de automação do Playwright, scraping, manipulação de seletores CSS instáveis e retentativas.
- **Impacto:** Alto acoplamento entre a camada de navegação Playwright e a regra de negócio de qualificação de obrigações contábeis.

#### C. Tratamento de Exceções Silenciosas e Resiliência
- **Problema:** Múltiplas capturas de erro genéricas como `try { ... } catch {}` e `await page.close().catch(() => {})` estão espalhadas pelo código sem log estruturado de auditoria de falhas internas.
- **Impacto:** Ocorrências de exceções silenciosas mascaram falhas de conectividade ou mudanças no DOM do sistema G-Click, dificultando o diagnóstico em produção.

#### D. Concorrência e Gerenciamento de Locks
- **Problema:** O controle de navegação em headless/headed utiliza variáveis globais como `loginLock` e locks baseados em arquivo simples (`.login.lock`). Em caso de encerramento abrupto do processo Node.js, os arquivos de lock podem permanecer no disco.
- **Impacto:** Bloqueio do sistema exigindo remoção manual de arquivos de lock.

---

## 4. Plano de Ação e Especificação Técnica de Melhorias

### FASE 1: Reestruturação da Arquitetura do Backend (Refatoração & Modularização)

1. **Decomposição do Servidor HTTP (`server.mjs` -> Modular Routers):**
   - Criar diretório `automacao/src/routes/` separando as APIs por domínio:
     - `auth.routes.mjs`: Autenticação, sessão e RBAC (`/api/login`, `/api/me`, `/api/users`).
     - `gclick.routes.mjs`: Ações de automação G-Click (`/api/browser/open`, `/api/gclick/companies`, `/api/apply`).
     - `mapping.routes.mjs`: Perfil de mapeamento e regras (`/api/mapping/*`, `/api/profiles/*`).
     - `sheets.routes.mjs`: Leitura e sincronização com Google Sheets (`/api/google-sheets/*`, `/api/writer/*`).
2. **Separação de Camadas (Service Pattern):**
   - Extrair a lógica do Playwright presente em `obrigacoes.mjs` para serviços isolados:
     - `AutomationDriver`: Gerenciador do ciclo de vida da página e contexto do Playwright.
     - `ObrigacaoParser`: Extrator puro de estruturas HTML/DOM (sem dependência direta da instância do navegador).
     - `ObrigacaoSyncService`: Orquestrador de fluxo de negócios.

### FASE 2: Melhorias de Resiliência, Concorrência e Tratamento de Erros

1. **Gestor de Lock Inteligente (Process-aware Lock):**
   - Implementar validação de PID no arquivo de lock com auto-recovery caso o processo anterior tenha morrido (`ESRCH`).
2. **Sistema de Log Estruturado de Erros:**
   - Substituir `catch {}` genéricos por um logger unificado que registre stack traces em arquivo rotativo (`registros/error.log`) com nível de severidade (`WARN`, `ERROR`, `FATAL`).
3. **Isolamento de Testes e Mocks de Dependências:**
   - Corrigir falhas de execução do `npm test` criando mocks para chamadas de sistema de arquivos e garantindo que dependências opcionais como Playwright sejam graciosamente tratadas em testes unitários.

### FASE 3: Modernização da Interface do Usuário (UI/UX Redesign)

1. **Adopção do Design Tokens & CSS Variables:**
   - Refatorar `automacao/ui/style.css` para utilizar a paleta escura profissional do HoraSync/Nexora DevKit.
2. **Reestruturação dos Componentes Frontend (`app.js`):**
   - Dividir o código do frontend (atualmente um único arquivo de 2.900 linhas em `app.js`) em componentes ES6 orientados a eventos (`UI/Sidebar.js`, `UI/MappingTable.js`, `UI/AuditLogger.js`).
3. **Inclusão de Feedback em Tempo Real:**
   - Adicionar barra de progresso determinística durante a execução do robô e toasts flutuantes informativos com ações de undo/retry.

---

## 5. Resumo e Conclusão

A execução do plano proposto transformará o **Enquete Sync** em uma plataforma resiliente, altamente modular e visualmente alinhada com os mais modernos padrões de suítes de produtividade para engenharia e contabilidade. A refatoração preservará 100% dos requisitos de privacidade local (LGPD / Privacy by Design) enquanto elimina débitos técnicos de concorrência e acoplamento.
