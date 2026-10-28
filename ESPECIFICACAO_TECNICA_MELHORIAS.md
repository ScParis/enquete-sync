# Documento de Especificação Técnica de Melhorias (Enquete Sync / G-Click Automação)

**Data:** 28 de Outubro de 2026
**Autor:** Jules (Software Engineer)
**Versão:** 2.0.0 (Design System Enterprise Maduro & Arquitetura de Produção)
**Status:** Proposta Técnica / Análise de Arquitetura, UX & Feedback Loops

---

## 1. Visão Geral e Objetivos

Este documento apresenta um diagnóstico aprofundado e uma especificação técnica detalhada de melhorias para a plataforma **Enquete Sync** (G-Click Automação), alinhando a interface e a arquitetura aos padrões de sistemas **Enterprise Maduros e Profissionais** (inspiração em suítes corporativas de alta densidade como Stripe Dashboard, Vercel Enterprise e Tailwind UI Pro).

O estudo abrange:
1. **Design System & UX Enterprise Maduro** (foco em máxima clareza, ergonomia de trabalho, densidade de dados e eliminação de elementos puramente decorativos ou alternância trivial de temas).
2. **Ciclo de Ações e Sistema de Feedback ao Usuário (UX Feedback Loops)** (respostas assíncronas determinísticas, estados de carregamento corporativos e acompanhamento de rotinas em lote).
3. **Revisão de Backend, Funções e Qualidade de Código** (arquitetura modular, separação em Routers/Services, concorrência, resiliência e aderência aos princípios SOLID/SoC do `AGENTS.md`).

Em conformidade com a instrução do projeto (*"Não code nada. Ao final gere um documento de especificação técnica de melhorias que encontrar"*), nenhuma alteração de código foi aplicada à base de código nesta etapa.

---

## 2. Análise de Layout & Design System Enterprise Maduro

### 2.1 Diagnóstico do Estado Atual (`automacao/ui/`)
- **Visual Administrativo Legado & Ruído de Navegação:**
  - O layout atual utiliza um esquema de cores heterogêneo (`--gclick-dark: #0d282e`, `--bg-app: #f4f7f6`) e uma navegação lateral profunda com múltiplos subníveis em árvore (`nav-tree-branch`, `nav-nested-branch`).
  - Essa estrutura em árvore dificulta a alternância rápida entre operações e polui a área de trabalho do operador contábil.
- **Subaproveitamento da Densidade Informacional:**
  - Formulários verticais muito espaçados e cards com grandes margens internas reduzem o número de clientes/obrigações visíveis por tela, exigindo rolagem constante durante conferências em lote.
- **Falta de Padronização Tipográfica Tabular:**
  - A exibição de dados numéricos (CNPJs, códigos de obrigações, valores monetários, horários e totalizadores) não utiliza fontes monoespaçadas tabulares dedicadas, o que gera desalinhamentos na leitura e *layout shift*.

### 2.2 Proposta de Design System Enterprise (Sóbrio, Maduro & Funcional)

Em vez de focar em customizações por "temas" ou apelos estéticos decorativos, a nova proposta adota uma linguagem visual **Enterprise madura, sóbria e focada em produtividade operacional**:

- **1. Arquitetura da Informação em Cockpit Plano (Flat Navigation):**
  - Substituir a árvore de navegação aninhada por uma **Sidebar Slim Fixa (`220px`)** estruturada por módulos funcionais claros:
    - *Visão Geral / Cockpit*
    - *Automação de Enquetes*
    - *Gestão de Obrigações (Canais WhatsApp & E-mail)*
    - *Conciliação & Auditoria*
    - *Configurações & Contas*
  - Utilizar **Tabs de Segmento Horizontais (`Segmented Controls`)** dentro dos painéis para alternar visualizações secundárias.
- **2. Paleta de Cores Enterprise Sóbria (Slate / Zinc Neutral Palette):**
  - Fundo fosco neutro e limpo (`Slate 900` `#0F172A` para modo escuro profissional ou `Slate 50` `#F8FAFC` para modo claro corporativo).
  - Cores funcionais estritas e de alto contraste (WCAG AAA):
    - **Azul Corporativo / Indigo (`#3B82F6` / `#4F46E5`):** Ações primárias e seleção ativa.
    - **Verde Esmeralda (`#10B981`):** Indicador de conciliação concluída, paridade confirmada e nuvem ativa.
    - **Âmbar / Amarelo (`#F59E0B`):** Conflitos cadastrais, divergências e ações que exigem revisão do operador soberano.
    - **Vermelho Neutro (`#EF4444`):** Erros de validação e falhas de conexão.
- **3. Tipografia Tabular Funcional:**
  - **Inter / Plus Jakarta Sans:** Para títulos, rótulos de navegação e diálogos de confirmação.
  - **JetBrains Mono / SF Mono:** Obrigatoriamente acionada na camada de dados (CNPJs, códigos de obrigações, progresso em lote e timestamps).
- **4. Componentes de Alta Densidade (Data-Dense Tables & Compact Cards):**
  - Tabelas de conciliação compactas com altura de linha reduzida (`36px` - `40px`), ordenação rápida por coluna, seleção múltipla e ações de linha acessíveis por teclado.

---

## 3. Análise do Ciclo de Ações e Sistema de Feedback ao Usuário (UX Feedback Loops)

### 3.1 Diagnóstico de Resposta e Feedback ao Operador
Durante tarefas críticas e assíncronas (abertura de navegador, raspagem de dados no G-Click, envio de mensagens WhatsApp e gravação em lote), **a falta de feedback imediato e claro é um dos principais fatores de insegurança do usuário**:

1. **Ausência de Feedback em Botões (Missing Button Loading States):**
   - Ao acionar "Abrir navegador", "Configurar WhatsApp" ou "Marcar respostas", o botão permanece estático sem spinner visual de carregamento ou transição para estado desabilitado (`disabled`).
2. **Falta de Indicador de Progresso Determinístico em Lote:**
   - Nas rotinas de gravação/conferência de dezenas de clientes, a interface não fornece uma barra de progresso determinística com indicador percentual real-time (`Cliente 14 de 150 - 9.3%`) e botão de pausa segura.
3. **Dependência de Diálogos Estáticos ou Mensagens Discretas:**
   - Erros ou alertas dependem de popups bloqueantes (`alert()`) ou textos discretos de rodapé. Falta um **Sistema de Toasts Corporativo** com níveis de severidade (`Success`, `Warning`, `Error`, `Info`).
4. **Ausência de Skeleton Screens:**
   - Durante a leitura de catálogos e planilhas, as tabelas somem ou ficam em branco abruptamente, sem estados visuais temporários de estrutura (*Skeleton Loading*).

### 3.2 Especificação Padrão do Sistema de Feedback

- **Toasts Notificações Enterprise (Toast Manager):**
  - Posicionamento discreto no canto superior direito com auto-dismiss (5s), barra de progresso interna e ação rápida de histórico/log.
- **Estados de Carga em Botões (`.btn-loading`):**
  - Todo botão acionado desabilita automaticamente e exibe spinner vetorial embutido com rótulo no gerúndio (ex: *"Acessando G-Click..."*, *"Conferindo lote..."*).
- **Barra de Progresso Real-Time via Server-Sent Events (SSE):**
  - Painel de acompanhamento de automação em lote com porcentagem exata, CNPJ/Obrigação sob processamento e controle do operador soberano.

---

## 4. Revisão de Backend, Funções e Qualidade de Código

### 4.1 Diagnóstico da Arquitetura do Backend (`automacao/server.mjs` & `automacao/lib/`)

#### A. Servidor HTTP Monolítico (`server.mjs` - 1.600 linhas)
- **Problema:** Concentra rotas HTTP, autenticação RBAC, manipulação de arquivos de configuração, concorrência e chamadas diretas às bibliotecas de automação.
- **Impacto:** Violação do Princípio da Responsabilidade Única (SRP), dificultando manutenção e testes de isolamento.

#### B. Módulo de Obrigações Massivo (`obrigacoes.mjs` - 2.346 linhas)
- **Problema:** O arquivo `obrigacoes.mjs` agrupa scraping de DOM do G-Click, Playwright, automação de WhatsApp/E-mail, manipulação de modal e regras de paridade.
- **Impacto:** Forte acoplamento da lógica de navegação da página com a regra de negócio do domínio contábil.

#### C. Tratamento de Exceções Silenciosas
- **Problema:** Uso recorrente de capturas silenciosas como `try { ... } catch {}` e `page.close().catch(() => {})`.
- **Impacto:** Ocorrência de exceções ocultas em falhas de rede ou mudanças de DOM sem log estruturado de auditoria técnica.

---

## 5. Plano de Ação e Especificação Técnica de Melhorias

### FASE 1: Reestruturação Arquitetural Backend (Modular Routers & Services)

1. **Separação das Rotas HTTP (`automacao/src/routes/`):**
   - `auth.routes.mjs`: Autenticação e gestão de permissões.
   - `gclick.routes.mjs`: Integração e enquetes do G-Click.
   - `obrigacoes.routes.mjs`: Gestão de obrigações, WhatsApp e E-mail.
   - `sheets.routes.mjs`: Sincronização Google Sheets.
2. **Separação da Camada de Automação (Service Pattern):**
   - Extrair Playwright para `AutomationDriver.mjs` e parsers puros de DOM para `ObrigacaoParser.mjs`.

### FASE 2: Sistema de Feedback e Resposta ao Operador (UX/UI)

1. **Implementação do Toast Manager & Button Loading States:**
   - Módulo unificado para toasts de notificação e utilitários de estado em botões.
2. **Streaming de Progresso Real-Time:**
   - Emissão de Server-Sent Events (SSE) do backend durante execuções em lote.

### FASE 3: Redesign Enterprise Maduro (UI Componentization)

1. **Design System Enterprise Neutro:**
   - Refatoração do `style.css` para a paleta de cores corporativa neutra (`Slate/Zinc`) de alta densidade.
2. **Componentização ES6 do Frontend (`app.js`):**
   - Modularizar a interface em componentes desacoplados (`UI/Sidebar.js`, `UI/Toast.js`, `UI/DataTable.js`).

---

## 6. Resumo e Conclusão

A especificação técnica garante que o **Enquete Sync** evolua para um software **Enterprise maduro, sóbrio e eficiente**, combinando alta densidade de dados com feedback claro para o operador, arquitetura modular resiliente e rigoroso cumprimento da privacidade local (LGPD).
