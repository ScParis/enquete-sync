# Documento de Especificação Técnica de Melhorias (Enquete Sync / G-Click Automação)

**Data:** 28 de Outubro de 2026
**Autor:** Jules (Software Engineer)
**Versão:** 1.1.0
**Status:** Proposta / Análise de Arquitetura, UX & Feedback Loops

---

## 1. Visão Geral e Objetivos

Este documento apresenta um diagnóstico aprofundado e uma especificação técnica detalhada de melhorias para a plataforma **Enquete Sync** (G-Click Automação). O estudo abrange:
1. **Análise de Layout, UX/UI e Design System** (comparando o estado atual com os conceitos visuais de vanguarda dos projetos HoraSync e Nexora DevKit).
2. **Ciclo de Ações e Sistema de Feedback ao Usuário (UX/UI Feedback Loops)** (diagnóstico de ausência de resposta imediata, estados de carregamento e notificações de ação).
3. **Revisão de Backend, Funções e Qualidade de Código** (arquitetura, concorrência, modularidade, resiliência e aderência aos princípios SOLID/SoC do `AGENTS.md`).

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

---

## 3. Análise do Ciclo de Ações e Sistema de Feedback ao Usuário (UX Feedback Loops)

### 3.1 Diagnóstico de Problemas Identificados
Sim, concordo totalmente: **faltam respostas e feedbacks claros e imediatos para diversas ações do usuário no sistema atual**. Atualmente, durante processos assíncronos ou demorados (como abertura do navegador, leitura de catálogos no G-Click, download de planilhas ou conciliação em lote), o usuário enfrenta os seguintes gargalos de usabilidade:

1. **Ausência de Feedback em Botões de Ação (Missing Loading States):**
   - Ao clicar em "Abrir navegador" ou "Marcar respostas", o botão permanece estático sem spinner de carregamento ou alteração do estado de texto (`state: disabled`), deixando o operador em dúvida se o clique foi registrado.
2. **Falta de Notificações Ativas e Não-Intrusivas (Toast System):**
   - Muitas respostas de erro ou sucesso dependem de `alert()` do navegador ou mensagens estáticas discretas na parte inferior da tela, sem pilha de notificações acessíveis (`Toasts`) com contexto e botão de ação rápida (Undo/Retry).
3. **Falta de Progresso Determinístico durante Automações em Lote:**
   - Durante a verificação de enquetes ou marcação de obrigações em múltiplos clientes, a interface não exibe uma barra de progresso em tempo real com contador (`Cliente 14 de 150 - 9.3%`), o que gera ansiedade e tentativas indevidas de re-clique.
4. **Falta de Skeletons em Tabelas e Listas de Carregamento:**
   - Ao trocar de conta ou importar uma planilha, a tabela de mapeamento simplesmente pisca ou fica vazia abruptamente sem uma estrutura visual temporária (*Skeleton Screen*), dando a impressão de travamento do sistema.

### 3.2 Especificação dos Padrões de Feedback Obrigatórios

Para resolver esses pontos, a interface deve implementar os seguintes padrões de interação:

- **1. Micro-feedback em Botões Interativos (Button Loading States):**
  - Todo botão acionado que dispara uma requisição assíncrona deve passar imediatamente para o estado `loading`: desabilitado, com spinner vetorial embutido e texto no gerúndio (ex: *"Abrindo navegador..."*, *"Sincronizando..."*).
- **2. Toast Notifications Centralizadas & Acessíveis:**
  - Implementar um gerenciador de Toasts no canto superior/inferior direito da tela com quatro variações cromaticas:
    - **Success (Verde Esmeralda):** Para confirmação de gravações e sincronizações com o Google Sheets.
    - **Warning (Âmbar/Laranja):** Para conflitos detectados em clientes e avisos de sessão prestes a expirar.
    - **Danger (Vermelho/Rosa):** Para erros de rede, falhas no Playwright ou exceções não tratadas.
    - **Info (Azul/Roxo):** Para atualizações de catálogo e status do robô.
- **3. Barra de Progresso Real-Time & Banner Operador Soberano:**
  - Para tarefas em lote, adicionar um widget visual no topo do dashboard contendo:
    - Barra de progresso percentual determinística.
    - Status do item atual (ex: *"Processando CNPJ: 12.345.678/0001-90"*).
    - Botão de Interrupção Segura (*"Pausar / Interromper Automação"*).
- **4. Skeleton Screens para Tabelas de Mapeamento:**
  - Substituir o estado vazio ou de transição por placeholders animados que mantêm a estrutura visual da tabela enquanto os dados são carregados do servidor local.

---

## 4. Revisão de Backend, Funções e Qualidade de Código

### 4.1 Diagnóstico de Arquitetura e Código (`automacao/server.mjs` & `automacao/lib/`)

#### A. Arquitetura Monolítica no Servidor HTTP (`server.mjs` - 1.600 linhas)
- **Problema:** O arquivo `server.mjs` concentra responsabilidades de servidor HTTP, roteamento de API (mais de 25 endpoints), gerenciamento de processo/locks, orquestração de Playwright, manipulação de arquivos JSON/CSV, autenticação e controle de sessão RBAC.
- **Impacto:** Viola o Princípio da Responsabilidade Única (SRP) do SOLID e dificulta a manutenção e testes unitários das rotas.

#### B. Complexidade Extrema e Monolitos em `obrigacoes.mjs` (2.346 linhas)
- **Problema:** O arquivo `obrigacoes.mjs` possui funções massivas (ex: `syncObrigacoesComCanais` e rotinas de automação DOM) com lógica deeply nested de automação do Playwright, scraping, manipulação de seletores CSS instáveis e retentativas.
- **Impacto:** Alto acoplamento entre a camada de navegação Playwright e a regra de negócio de qualificação de obrigações contábeis.

#### C. Tratamento de Exceções Silenciosas e Resiliência
- **Problema:** Múltiplas capturas de erro genéricas como `try { ... } catch {}` e `await page.close().catch(() => {})` estão espalhadas pelo código sem log estruturado de auditoria de falhas internas.
- **Impacto:** Ocorrências de exceções silenciosas mascaram falhas de conectividade ou mudanças no DOM do sistema G-Click, dificultando o diagnóstico em produção.

---

## 5. Plano de Ação e Especificação Técnica de Melhorias

### FASE 1: Reestruturação da Arquitetura do Backend (Refatoração & Modularização)

1. **Decomposição do Servidor HTTP (`server.mjs` -> Modular Routers):**
   - Criar diretório `automacao/src/routes/` separando as APIs por domínio (`auth.routes.mjs`, `gclick.routes.mjs`, `mapping.routes.mjs`, `sheets.routes.mjs`).
2. **Separação de Camadas (Service Pattern):**
   - Extrair a lógica do Playwright presente em `obrigacoes.mjs` para serviços isolados (`AutomationDriver`, `ObrigacaoParser`, `ObrigacaoSyncService`).

### FASE 2: Implementação do Sistema de Feedback e Resposta ao Usuário (UX/UI)

1. **Gerenciador de Toasts e UI Component Library:**
   - Criar módulo `UI/ToastManager.js` com auto-dismiss, animação CSS e suporte a botões de ação rápida.
2. **Estados de Carga em Botões e Formulários:**
   - Adicionar manipuladores nos eventos de submissão do `app.js` para alternar classe `.btn-loading` e atributo `disabled` automaticamente em todas as requisições HTTP.
3. **Indicador Determinístico de Progresso de Automação:**
   - Implementar Server-Sent Events (SSE) ou polling de status no backend para enviar o percentual e o item atual em execução no Playwright diretamente para o dashboard.

### FASE 3: Modernização da Interface do Usuário (UI/UX Redesign)

1. **Adopção do Design Tokens & CSS Variables:**
   - Refatorar `automacao/ui/style.css` para utilizar a paleta escura profissional do HoraSync/Nexora DevKit.
2. **Reestruturação dos Componentes Frontend (`app.js`):**
   - Dividir o código do frontend (atualmente em `app.js`) em componentes ES6 orientados a eventos (`UI/Sidebar.js`, `UI/MappingTable.js`, `UI/Feedback.js`).

---

## 6. Resumo e Conclusão

A execução do plano proposto transformará o **Enquete Sync** em uma plataforma resiliente, com **excelência em feedback e usabilidade para o operador**, além de uma arquitetura altamente modular e alinhada com os mais modernos padrões de suítes de produtividade. A refatoração preservará 100% dos requisitos de privacidade local (LGPD / Privacy by Design) enquanto elimina débitos técnicos de concorrência e acoplamento.
