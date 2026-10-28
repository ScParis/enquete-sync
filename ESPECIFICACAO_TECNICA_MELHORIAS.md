# Documento de Especificação Técnica de Melhorias (Enquete Sync / G-Click Automação)

**Data:** 28 de Outubro de 2026
**Autor:** Jules (Software Engineer)
**Versão:** 3.0.0 (Crítica Visual de Produção & Redesign Workbench / Cockpit)
**Status:** Especificação Técnica de Arquitetura & UX

---

## 1. Visão Geral e Objetivos

Este documento apresenta uma revisão crítica minuciosa de **Layout, UX/UI e Arquitetura de Software** para a plataforma **Enquete Sync** (G-Click Automação), com base no diagnóstico direto do sistema em execução (conforme screenshot `image.png` fornecido) e nas funcionalidades trazidas pelo PR #1.

### O Diagnóstico Central
A interface atual peca por ser **excessivamente simplista, previsível e passiva**. O layout comporta-se como um formulário administrativo web dos anos 2010: um card branco isolado no centro de uma imensa área cinza sem uso, com uma árvore de navegação lateral rudimentar (usando caracteres como `└` e textos cortados).

A proposta descrita nesta especificação eleva o sistema ao patamar de um **Workbench / Cockpit de Alta Produtividade** (padrão Vercel, Linear, Supabase e Retool), otimizado para a rotina intensa de escritórios de contabilidade e consultorias fiscais.

Em estrita conformidade com a instrução do projeto (*"Não code nada. Ao final gere um documento de especificação técnica de melhorias que encontrar"*), nenhuma alteração foi aplicada ao código da aplicação nesta etapa.

---

## 2. Crítica Detalhada de Layout & UX/UI (Análise da Tela Real - `image.png`)

### 2.1 Problemas Específicos Identificados na Interface Atual

1. **Desperdício Massivo de Área Útil (Vasto Espaço Vazio):**
   - Na tela atual, mais de **70% do viewport** é um fundo cinza inerte (`#f4f7f6`). Apenas um card branco centralizado de `600px` ocupa o centro da tela, forçando o operador a rolar verticalmente enquanto perde a visão do status global.
2. **Navegação Lateral Antiquada e Poluída:**
   - A sidebar esquerda tenta emular uma árvore de diretórios com prefixos de linha `└` renderizados manualmente e pequenos badges arredondados que se sobrepõem e cortam o texto do botão (ex: `Conexão & Conta ...`).
   - A densidade de opções na sidebar gera poluição visual sem oferecer atalhos práticos.
3. **Stepper Passivo e Sem Inteligência de Fluxo:**
   - O indicador da etapa ativa aparece como uma pílula estática `01` no topo do formulário. Ele não informa graficamente o progresso geral do processo (ex: *1. Conexão -> 2. Planilha -> 3. Mapeamento -> 4. Conferência -> 5. Gravação*), não permite navegação rápida e não reage visualmente aos estados concluídos.
4. **Ausência de Métricas, KPIs e Telemetria do Sistema:**
   - Não há resumo de quantos clientes foram processados, taxa de paridade das enquetes, status das integrações (Google Sheets / G-Click / WhatsApp) ou histórico recente de auditoria no painel principal.
5. **Hierarquia Visual Fraca e Ações Pobremente Destacadas:**
   - O campo de entrada de texto e os botões (*"Abrir janela de login"*, *"Verificar login no G-Click"*) estão desalinhados, com estilos genéricos de contorno fino sem hierarquia de ação primária/secundária bem definida.
6. **Incoerência no Topbar e Rodapé da Sidebar:**
   - O topbar possui textos estáticos e espaçamento desproporcional. O rodapé da sidebar mistura dados do usuário com um selo solto `Conta: 4966 - Sessão desconectada` que poderia estar integrado ao card de status da conexão.

---

## 3. Especificação do Novo Design System & Arquitetura Visual (Workbench / Cockpit)

### 3.1 Conceito: Cockpit de Produtividade & Split Workbench
A nova interface migra do modelo *"Formulário Centralizado em Tela Vazia"* para uma **Plataforma Cockpit Integrada**:

```
+-------------------------------------------------------------------------------------------------------------------+
|  [Logo JB Consultoria]  G-CLICK ENQUETE SYNC v3.2     [⌘K Command Palette]   (●) G-Click Online | (●) Sheets Sync   |
+-------------------------------------------------------------------------------------------------------------------+
| PIPELINE DE TRABALHO: [✓ 1. Conexão] ---> [● 2. Fonte (CSV/Sheets)] ---> [3. Mapeamento] ---> [4. Conferência]    |
+----------------------------------+--------------------------------------------------------------------------------+
| SIDEBAR SLIM (220px)             | PAINEL PRINCIPAL (WORKBENCH GRID - 100% UTILIZAÇÃO DO VIEWPORT)                |
|                                  |                                                                                |
| 📊 Cockpit / Visão Geral         | [ METRICS BAR: 152 Clientes | 8 Enquetes Mapeadas | 94% Elegíveis | R$ 12.4k Total] |
| 🔑 Conexão G-Click   (Conta OK)  | +------------------------------------------------------------------------------+
| 📥 Fonte & Planilha (65 tarefas) | | PAINEL DE CONEXÃO & SESSÃO (Ativo)                                           |
| 📋 Mapeamento        (8 perguntas)| | Empresa / Escritório: [ 4966 - JB CONSULTORIA FISCAL      [v] ]              |
| 🔍 Conferência       (65 pend.)  | | Sessão G-Click:       [● SESSÃO ATIVA - Token Expira em 04h 12m]               |
| ⚡ Gravação          (Aguardando)| | [ Ações Rápidas: ( Reabrir Navegador )  ( Testar Conexão ) ( Sincronizar ) ]  |
| 💬 Obrigações & WA   (Ativo)     | +------------------------------------------------------------------------------+
| ⚙️ Configurações & RBAC          | | TABELA DE CONCILIAÇÃO / PREVIEW EM TEMPO REAL (High-density Grid)            |
|                                  | | CNPJ              | RAZÃO SOCIAL      | TAREFA PLANILHA | STATUS       | AÇÕES |
|                                  | | 12.345.678/0001-90| Mestre Distrib.   | DAS Simples     | ✓ Já Correto | [Edit]|
|                                  | | 98.765.432/0001-10| Alfa Logística    | DESTDA          | ⚡ A Gravar  | [Edit]|
+----------------------------------+--------------------------------------------------------------------------------+
| STATUS: Sessão Operador: Admin   | LOG DE OPERAÇÃO EM TEMPO REAL (Stream Terminal Bottom Bar)                    |
+----------------------------------+--------------------------------------------------------------------------------+
```

### 3.2 Componentes e Padrões de Layout Propostos

#### 1. Pipeline de Etapas Interativo (Interactive Workflow Bar)
No topo da área de trabalho, um indicador de progresso horizontal (`Stepper`) guiará a jornada do operador:
- **Etapa 1:** Conexão & Sessão G-Click (Status de login).
- **Etapa 2:** Carregamento de Fonte (Planilha Google Sheets ou arquivo CSV/XLSX).
- **Etapa 3:** Mapeamento de Perguntas e Respostas (Regras de de/para).
- **Etapa 4:** Conferência Automática (Análise de divergências e paridades).
- **Etapa 5:** Gravação Supervisionada (Execução e confirmação pelo operador).
*Cada etapa exibe o estado dinâmico (`Concluído`, `Em Andamento`, `Pendente` ou `Atenção`) e permite navegação direta ao ser clicada.*

#### 2. Command Palette Global (`⌘K` / `Ctrl+K`)
Inclusão de uma paleta de comandos rápida ativada por teclado (`⌘K`) permitindo:
- Buscar clientes instantaneamente por CNPJ ou Razão Social.
- Alternar a conta do escritório sem precisar navegar por menus.
- Disparar ações diretas (*"Conferir lote"*, *"Exportar auditoria CSV"*, *"Abrir janela G-Click"*).

#### 3. Painel de Métricas & Telemetria em Tempo Real (KPI Grid)
Substituir cartões estáticos por uma faixa de indicadores de desempenho antes da tabela de trabalho:
- **Total de Clientes na Planilha:** Contagem absoluta.
- **Respostas Elegíveis a Gravar:** Quantidade real de tarefas prontas para atualização.
- **Divergências / Conflitos:** Destaque em âmbar para tarefas conflitantes que exigem decisão.
- **Última Sincronização Sheets:** Timestamp exato com status da integração via Apps Script.

#### 4. Tabela de Conciliação de Alta Densidade (High-Density Data Grid)
- Utilizar tabela com linhas compactas (`36px`), tipografia monoespaçada `JetBrains Mono` para CNPJs e valores, filtros rápidos no cabeçalho de cada coluna e badges de status nítidos:
  - `Já Correto` (Verde Esmeralda + Ícone Check)
  - `A Gravar` (Azul/Violeta + Ícone Raio)
  - `Divergente` (Âmbar + Ícone Alerta)
  - `Não Localizado` (Cinza + Ícone Busca)

---

## 4. Análise do Ciclo de Ações e Sistema de Feedback ao Usuário (UX Feedback Loops)

### 4.1 Requisitos de Resposta e Feedback Imediato

1. **Button Loading States em Toda Ação Assíncrona:**
   - Qualquer ação (abrir navegador, verificar sessão, importar CSV, executar gravação) desabilita o botão, exibe um spinner vetorial fluido e altera o texto para o gerúndio (ex: *"Verificando login..."*).
2. **Sistema de Toasts Enterprise (`ToastManager`):**
   - Notificações flutuantes no canto superior direito com 4 categorias cromaticas (`Success`, `Warning`, `Danger`, `Info`), fechamento automático em 5s e histórico acessível.
3. **Barra de Progresso Determinística em Execuções em Lote:**
   - Durante a marcação de enquetes ou configuração de passos do WhatsApp, exibir progresso percentual exato (`Obrigação 18 de 65 - 27%`) com o nome do cliente atual e botão de pausa/cancelamento seguro.
4. **Skeleton Screens durante Carregamentos de Dados:**
   - Trocar telas brancas ou relâmpagos visuais por estruturas placeholder animadas enquanto catálogos e planilhas são lidos do backend.

---

## 5. Revisão do Backend, Arquitetura de Código & Resiliência

### 5.1 Diagnóstico de Código

1. **Decomposição do Servidor Monolítico (`automacao/server.mjs` - 1.600 linhas):**
   - Dividir em roteadores modulares (`auth.routes.mjs`, `gclick.routes.mjs`, `mapping.routes.mjs`, `obrigacoes.routes.mjs`, `sheets.routes.mjs`).
2. **Modularização de `obrigacoes.mjs` (2.346 linhas):**
   - Separar em `AutomationDriver` (gerenciamento Playwright), `ObrigacaoParser` (extrator puro de DOM) e `ObrigacaoService` (regras de negócio de WhatsApp/E-mail/G-Click).
3. **Tratamento de Exceções e Auditoria:**
   - Eliminar blocos `catch {}` silenciosos por um sistema de logging técnico rotativo (`registros/system.log`).

---

## 6. Plano de Ação e Fases de Implementação

### FASE 1: Redesign e Arquitetura Frontend (Workbench Cockpit)
- Implementar o novo layout sem áreas vazias, com barra de pipeline superior, sidebar slim e tabela de alta densidade.
- Adicionar a Command Palette (`⌘K`) e o sistema de Toasts.

### FASE 2: Sistema de Feedback & Streaming de Progresso
- Implementar Server-Sent Events (SSE) no backend para streaming do progresso de automação do Playwright para o frontend em tempo real.
- Inserir estados de carregamento em 100% dos botões de ação.

### FASE 3: Refatoração do Backend (Routers & Services)
- Modularizar `server.mjs` e `obrigacoes.mjs`, garantindo isolamento total, tratamento robusto de locks de processo e cobertura completa de testes.

---

## 7. Conclusão

A especificação técnica 3.0 transforma o **Enquete Sync** em uma plataforma **Enterprise de alta densidade e performance visual**. Ao eliminar a interface simplista e passiva de formulário único, o sistema passa a oferecer uma experiência moderna, previsível e segura para operadores e consultores fiscais, preservando integralmente a privacidade local (LGPD).
