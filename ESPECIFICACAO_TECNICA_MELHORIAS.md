# Documento de Especificação Técnica de Melhorias (Enquete Sync / G-Click Automação)

**Data:** 28 de Outubro de 2026
**Autor:** Jules (Software Engineer)
**Versão:** 3.1.0 (Especificação Completa: Redesign Cockpit, Feedback Loops & Mecanismos de Cancelamento)
**Status:** Especificação Técnica de Arquitetura & UX

---

## 1. Visão Geral e Objetivos

Este documento apresenta uma especificação técnica abrangente de **Layout, UX/UI, Mecanismos de Cancelabilidade e Arquitetura de Código** para a plataforma **Enquete Sync** (G-Click Automação), incorporando o diagnóstico do sistema real (`image.png`), os novos módulos do PR #1 (WhatsApp/E-mail) e a observação fundamental sobre a **ausência de ações de cancelamento nas operações**.

### Os Três Pilares da Reformulação
1. **Redesign para Cockpit Workbench Enterprise:** Eliminação do layout simplista/passivo (área cinza vazia com formulário central) em favor de uma plataforma de alta densidade informacional, com pipeline de etapas interativo, Command Palette (`⌘K`) e visão unificada de métricas.
2. **Ciclo de Feedback & Mecanismos de Cancelamento (Abort & Cancellation Mechanics):** Garantia de que **toda ação iniciada pelo usuário possa ser interrompida com segurança e sem travamento de recursos**, no frontend e no backend.
3. **Desacoplamento e Resiliência no Backend:** Reorganização do servidor monolítico em Routers/Services e eliminação de exceções silenciosas.

Em estrita conformidade com a diretriz do projeto (*"Não code nada. Ao final gere um documento de especificação técnica de melhorias que encontrar"*), nenhuma alteração foi aplicada ao código da aplicação nesta etapa.

---

## 2. Crítica Detalhada de Layout & UX/UI (Análise da Tela Real - `image.png`)

### 2.1 Problemas Identificados no Layout Atual
1. **Vasto Espaço Desperdiçado (70%+ do Viewport Vazio):**
   - O card branco centralizado de `600px` ocupa o centro da tela enquanto imensas áreas cinzas permanecem sem utilidade, forçando rolagens verticais desnecessárias.
2. **Navegação Lateral Antiquada e Poluída:**
   - Árvore de navegação rudimentar com caracteres `└` e badges que se sobrepõem e cortam rótulos de botões.
3. **Stepper Passivo e Sem Inteligência de Fluxo:**
   - Apresentação de etapas como pílulas estáticas (`01`) sem mostrar a jornada global nem permitir navegação direta.
4. **Ausência de Métricas e Telemetria em Tempo Real:**
   - Falta de totalizadores de clientes, taxa de paridade de enquetes e status das integrações (G-Click, Google Sheets, WhatsApp).

### 2.2 Proposta de Redesign (Cockpit Workbench)
- **Grid de Alta Densidade (Utilização Total do Viewport):**
  - **Sidebar Slim (`220px`):** Navegação plana por módulos com ícones lineares e selos de estado.
  - **Pipeline Bar:** Stepper horizontal interativo mostrando o progresso (*Conexão -> Fonte -> Mapeamento -> Conferência -> Gravação*).
  - **Command Palette (`⌘K`):** Busca instantânea por CNPJ, cliente ou ação do sistema.
  - **KPI Grid:** Cartões de métricas de clientes, tarefas pendentes e paridade.
  - **Data Grid Compacto (`36px` height):** Tabela de conciliação com tipografia monoespaçada `JetBrains Mono` para CNPJs e códigos.

---

## 3. Mecanismos de Cancelamento, Interrupção Segura e Feedback Loops

### 3.1 O Problema Crítico: Operações Sem Opção de Cancelamento
Atualmente, quando o operador inicia uma ação demorada ou assíncrona, **o sistema não oferece nenhuma forma de cancelar ou interromper o processo**:

1. **Abertura/Login de Navegador no Playwright (`openBrowser`):**
   - Se o navegador demorar a abrir ou travar na autenticação, não há botão para cancelar a operação. O operador é forçado a fechar o aplicativo ou aguardar um timeout longo.
2. **Varredura e Raspagem de Catálogo (`readQuestionCatalog` / `inspectObrigacoesPage`):**
   - Durante o scraping de centenas de obrigações ou perguntas do G-Click, a interface fica travada sem botão de abortar.
3. **Conferência e Marcação de Enquetes em Lote:**
   - Se o operador perceber um erro de mapeamento durante a execução em lote, ele não tem como interromper a gravação de forma limpa sem desligar o servidor local.
4. **Configuração em Lote de Canais (WhatsApp / E-mail):**
   - A configuração de múltiplos passos de WhatsApp é iniciada de forma irreversível até o fim do loop.

### 3.2 Especificação Técnica da Arquitetura de Cancelamento (Frontend & Backend)

Para garantir controle total e segurança ao operador, o sistema deve implementar os seguintes mecanismos:

#### A. Mecanismo de Cancelamento no Backend (Node.js & Playwright)
- **1. Integração com `AbortController` e `AbortSignal`:**
  - Todas as rotas e funções assíncronas do backend (`server.mjs` e `lib/`) devem aceitar um parâmetro `signal` derivado de um `AbortController`.
  - Ao receber uma requisição HTTP de cancelamento (`POST /api/cancel`), o backend aciona `abortController.abort()`.
- **2. Interrupção Graciosa das Rotinas do Playwright:**
  - Nas rotinas de loop de lote (`applyQuestionWithOperator`, `configureBatchWhatsappActivities`), cada iteração deve verificar `signal.aborted`.
  - Se abortado, o robô encerra o loop imediatamente, executa a limpeza de contexto do navegador (`page.close().catch(() => {})`) e registra o ponto exato de parada no log de auditoria.
- **3. Liberação Imediata de Locks:**
  - A requisição de cancelamento força a liberação imediata dos locks de sessão (`loginLock` e `.login.lock`), permitindo novas tentativas sem necessidade de reiniciar o servidor.

#### B. Mecanismo de Cancelamento na Interface do Usuário (Frontend UX)
- **1. Botão "Cancelar / Interromper" visível em Toda Operação Assíncrona:**
  - Em modais e barras de progresso, o botão de ação principal é acompanhado por um botão secundário de destaque *"Cancelar Operação"*.
- **2. Atalho Global de Teclado `Esc`:**
  - Pressionar a tecla `Esc` durante qualquer carregamento ou processo em lote aciona uma caixa de diálogo rápida de confirmação: *"Deseja interromper a automação atual?"*.
- **3. Toast Manager & Button Loading States:**
  - Transição de botões para estado `disabled` com spinner e rótulo dinâmico, acompanhados de toasts de notificação de progresso e cancelamento confirmado.

---

## 4. Revisão de Backend, Arquitetura de Código & Resiliência

### 4.1 Diagnóstico de Código Backend
1. **Decomposição do Servidor Monolítico (`server.mjs` - 1.600 linhas):**
   - Reorganização em roteadores modulares (`auth.routes.mjs`, `gclick.routes.mjs`, `mapping.routes.mjs`, `obrigacoes.routes.mjs`, `sheets.routes.mjs`).
2. **Modularização de `obrigacoes.mjs` (2.346 linhas):**
   - Divisão das responsabilidades em `AutomationDriver` (Playwright), `ObrigacaoParser` (scraping DOM) e `ObrigacaoService` (regras de negócio).
3. **Eliminação de Exceções Silenciosas:**
   - Substituição de capturas genéricas por logging estruturado em `registros/system.log`.

---

## 5. Plano de Ação e Fases de Implementação

### FASE 1: Arquitetura de Cancelabilidade & Abort Signals (Backend & Frontend)
- Adicionar suporte a `AbortController` nas rotas do servidor e funções do Playwright.
- Criar a rota `POST /api/cancel` e implementar botões de cancelamento e suporte a atalho `Esc` na interface.

### FASE 2: Redesign Enterprise (Workbench Cockpit)
- Implementar o layout sem áreas vazias, com barra de pipeline superior, sidebar slim, Command Palette (`⌘K`) e tabela de conciliação de alta densidade.

### FASE 3: Refatoração do Backend (Routers & Services)
- Decompor `server.mjs` e `obrigacoes.mjs` em módulos orientados a serviços, garantindo resiliência e cobertura de testes.

---

## 6. Resumo e Conclusão

A inclusão dos **mecanismos de cancelamento e interrupção segura** soluciona uma lacuna crítica de segurança operacional no **Enquete Sync**. Aliados ao novo **Cockpit Workbench Enterprise**, o sistema oferece ao operador contábil total controle, previsibilidade e alto desempenho, mantendo o rigor da privacidade local (LGPD).
