# Documento de Especificação Técnica de Melhorias (Enquete Sync / G-Click Automação)

**Data:** 28 de Outubro de 2026
**Autor:** Jules (Software Engineer)
**Versão:** 1.2.0 (Pós-Merge PR #1: Automação de Obrigações & WhatsApp)
**Status:** Proposta / Análise de Arquitetura, UX & Feedback Loops

---

## 1. Visão Geral e Objetivos

Este documento apresenta um diagnóstico aprofundado e uma especificação técnica detalhada de melhorias para a plataforma **Enquete Sync** (G-Click Automação), atualizado após a consolidação das recentes modificações integradas via PR #1 (`feat/automacao-obrigacoes-whatsapp`).

O estudo abrange:
1. **Análise de Layout, UX/UI e Design System** (comparando a interface atual com o conceito visual de vanguarda dos projetos HoraSync e Nexora DevKit).
2. **Análise do Ciclo de Ações e Sistema de Feedback ao Usuário** (diagnóstico de respostas assíncronas, modais de WhatsApp/E-mail, barra de progresso e notificações).
3. **Revisão de Backend, Funções e Qualidade de Código** (arquitetura do servidor HTTP, módulo de automação de obrigações com 2.300+ linhas, concorrência, resiliência e aderência aos princípios SOLID/SoC do `AGENTS.md`).

Em conformidade com as diretrizes do projeto (*"Não code nada. Ao final gere um documento de especificação técnica de melhorias que encontrar"*), nenhuma alteração de código foi aplicada à base nesta etapa.

---

## 2. Análise de Layout & Design (Frontend & UX)

### 2.1 Diagnóstico do Estado Atual (`automacao/ui/`)
- **Estilo Visual Tradicional & Alta Densidade:** O layout atual utiliza um tema escuro/claro administrativo (`--gclick-dark: #0d282e`, `--bg-app: #f4f7f6`).
- **Navegação Aninhada de Múltiplos Níveis:**
  - A barra lateral apresenta uma estrutura em árvore profunda (`nav-tree-branch`, `nav-nested-branch`), o que fragmenta a usabilidade ao alternar entre os módulos de *Conexão*, *Fonte*, *Enquete*, *Obrigações* e *Canais (WhatsApp/E-mail)*.
- **Micro-interações e Componentes Pós-Merge:**
  - Com a inclusão das funcionalidades de WhatsApp e E-mail, novos formulários e modais foram inseridos. No entanto, faltam componentes unificados de Design System (cards translucidos, cantos arredondados padronizados, tipografia monoespaçada consistente para IDs e hashes).

### 2.2 Proposta de Redesign (Inspirada nos Design Systems HoraSync / Nexora DevKit)
- **Tema Obsidian Dark & Glassmorphism Cirúrgico:**
  - Superfície profunda (`#0B0F17` base, `#141A27` cards) com bordas translúcidas de 1px (`rgba(255, 255, 255, 0.08)`), acentos em Violeta Elétrico (`#7C3AED` / `#4F46E5`) e Esmeralda Métrico (`#10B981`).
- **Navegação em Cockpit Híbrido (Linear Style):**
  - Condensar a sidebar para uma largura fixa de `220px` / `240px` com ícones vetoriais lineares, selos de contagem de tarefas e categorização por módulos planos.
  - Substituir subníveis aninhados por tabs de segmento horizontais (`Segmented Tabs`) no topo dos painéis funcionais.
- **Tipografia Funcional Dupla:**
  - **Plus Jakarta Sans / Inter:** Para títulos, rótulos de navegação e diálogos.
  - **JetBrains Mono:** Obrigatoriamente para exibição de CNPJs, códigos de obrigações, variáveis de mensagens WhatsApp (`{{1}}`, `{{2}}`) e logs de auditoria.

---

## 3. Análise do Ciclo de Ações e Sistema de Feedback ao Usuário (UX Feedback Loops)

### 3.1 Diagnóstico de Problemas de Feedback Identificados
Com a inclusão das automações avançadas de reordenação e criação de passos de WhatsApp e E-mail no G-Click, **o ciclo de ações e feedback tornou-se um fator ainda mais crítico para a usabilidade e segurança da operação**:

1. **Gargalo nas Automações em Lote (WhatsApp e E-mail Batch):**
   - Ao disparar a configuração em lote de dezenas de obrigações, o operador não possui uma barra de progresso determinística com indicador percentual real-time (`Obrigação 12 de 85 - 14%`).
2. **Ausência de Feedback de Carga em Botões (Missing Button Loading States):**
   - Botões como *"Abrir navegador"*, *"Configurar WhatsApp"* e *"Marcar respostas"* não exibem spinners internos ou texto no gerúndio durante a execução, permitindo re-cliques indesejados.
3. **Falta de Notificações Ativas Não-Intrusivas (Toast System):**
   - O sistema ainda utiliza diálogos bloqueantes ou notificações estáticas em rodapé que passam despercebidas durante a operação.
4. **Falta de Skeletons durante a Leitura de Catálogos de Obrigações:**
   - Ao trocar a conta do escritório ou recarregar a lista de obrigações do G-Click, as tabelas piscam e ficam vazias temporariamente sem uma estrutura placeholder (*Skeleton Screen*).

### 3.2 Especificação dos Padrões de Feedback Obrigatórios

- **1. Toast Notifications Centralizadas & Acessíveis:**
  - Toast Manager no canto superior direito com 4 variações (`Success`, `Warning`, `Danger`, `Info`) e botão de ação rápida (ex: *"Ver Log"*, *"Desfazer"*).
- **2. Micro-feedback em Botões Interativos:**
  - Transição automática de botões para estado `disabled` com spinner vetorial e rótulo dinâmico (ex: *"Acessando G-Click..."*, *"Gravando respostas..."*).
- **3. Barra de Progresso Real-Time & Banner Operador Soberano:**
  - Para automações em lote (Enquetes, WhatsApp, E-mail), exibir widget com:
    - Progresso percentual e contagem absoluta.
    - Identificação do cliente/obrigação atual em processamento.
    - Botão de Interrupção Segura (*"Pausar Automação"*).

---

## 4. Revisão de Backend, Funções e Qualidade de Código

### 4.1 Diagnóstico de Arquitetura e Código (`automacao/server.mjs` & `automacao/lib/`)

#### A. Arquitetura Monolítica do Servidor (`server.mjs` - 1.600 linhas)
- **Problema:** Concentra roteamento HTTP, autenticação/RBAC, manipulação de arquivos local, orquestração Playwright e chamadas às APIs do Google Sheets.
- **Impacto:** Viola o Princípio da Responsabilidade Única (SRP) e dificulta a manutenção e escrita de testes unitários isolados.

#### B. Arquivo Extenso e Alta Complexidade em `obrigacoes.mjs` (2.346 linhas)
- **Problema:** A consolidação da automação de WhatsApp e E-mail expandiu o arquivo `obrigacoes.mjs` para mais de 2.300 linhas, agrupando scraping de DOM, manipulação de seletores instáveis do G-Click, parsing de tabelas e retentativas.
- **Impacto:** Acoplamento elevado entre a automação do navegador e a regra de negócio de conciliação.

#### C. Tratamento de Exceções e Resiliência
- **Problema:** Presença de blocos `try { ... } catch {}` genéricos e `page.close().catch(() => {})` sem registro em log estruturado.
- **Impacto:** Falhas de conectividade ou alterações na estrutura do G-Click podem ocorrer sem rastro claro de auditoria técnica.

---

## 5. Plano de Ação e Especificação Técnica de Melhorias

### FASE 1: Reestruturação da Arquitetura Backend (Routers & Services)

1. **Decomposição em Módulos de Rota (`automacao/src/routes/`):**
   - `auth.routes.mjs`: Autenticação e RBAC.
   - `gclick.routes.mjs`: Automação G-Click e enquetes.
   - `obrigacoes.routes.mjs`: Rotas dedicadas a obrigações, WhatsApp e E-mail.
   - `sheets.routes.mjs`: Sincronização Google Sheets.
2. **Camada de Serviços (Service Pattern):**
   - Isolar a lógica de navegador em `AutomationDriver` e regras de domínio em `ObrigacaoService`.

### FASE 2: Sistema de Feedback e Resposta ao Usuário (UX/UI)

1. **Implementação de Toasts & Micro-interações:**
   - Criar `UI/ToastManager.js` e utilitários de estado para botões (`.btn-loading`).
2. **Indicador de Progresso de Automação via Server-Sent Events (SSE):**
   - Emitir eventos de progresso do Playwright para atualização em tempo real no dashboard.

### FASE 3: Modernização Visual (UI Redesign)

1. **Design System Obsidian Dark:**
   - Refatorar `style.css` com a nova paleta de cores e variáveis CSS.
2. **Componentização Frontend (`app.js`):**
   - Mapear e modularizar o frontend em componentes ES6 (`UI/Sidebar.js`, `UI/Toast.js`, `UI/ObrigacoesPanel.js`).

---

## 6. Resumo e Conclusão

A especificação proposta eleva o **Enquete Sync** a um novo patamar de estabilidade, desempenho e experiência do usuário, cobrindo integralmente as funcionalidades integradas no PR #1 (WhatsApp/E-mail), garantindo total privacidade (LGPD) e sem dívida técnica.
