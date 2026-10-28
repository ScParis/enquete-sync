# Documento de Especificação Técnica de Melhorias (Enquete Sync / G-Click Automação)

**Data:** 28 de Outubro de 2026
**Autor:** Jules (Software Engineer)
**Versão:** 3.2.0 (Padronização Rígida de Componentes, Design System & Ergonomia Visual)
**Status:** Especificação Técnica de Arquitetura & UX

---

## 1. Visão Geral e Objetivos

Este documento apresenta uma especificação técnica abrangente de **Padronização de Componentes, UX/UI, Cancelabilidade e Arquitetura de Código** para a plataforma **Enquete Sync** (G-Click Automação). O estudo foi elaborado com base no diagnóstico direto do sistema real (conforme demonstrado na tela `image.png`) e nos novos fluxos introduzidos pelo PR #1.

### O Diagnóstico de Inconsistência e Falta de Padrão
Além de o layout atual ser simplista e ter vastas áreas cinzas sem uso, **a interface sofre de uma evidente falta de padronização visual entre telas e componentes**:
- **Sidebar com Textos Truncados:** Rótulos da navegação lateral cortados de forma arbitrária (ex: `Conexão & Conta ...`, `Fonte (importa...`, `Sincronização co...`), gerando desorganização e insegurança visual.
- **Inconsistência Rígida em Botões:** Botões com formatos, tamanhos, paddings, border-radii e alturas completamente díspares (alguns redondos, outros quadrados, botões primários sem destaque claro, botões pequenos misturados com grandes sem critério).
- **Incoerência Visual entre Módulos:** Os painéis de *Obrigações*, *WhatsApp/E-mail* e *Enquete* utilizam componentes com margens, fontes e estilos de borda que não conversam entre si.

Em conformidade com a instrução do projeto (*"Não code nada. Ao final gere um documento de especificação técnica de melhorias que encontrar"*), nenhuma alteração de código foi aplicada à base de código nesta etapa.

---

## 2. Diagnóstico Técnico das Inconsistências Visuais (`image.png` & `style.css`)

### 2.1 Análise dos Principais Desvios de Padrão

1. **Textos Truncados na Sidebar (Sidebar Layout Breakdowns):**
   - A barra lateral tem largura fixa insuficiente (`240px`) e utiliza `text-overflow: ellipsis` de forma Agressiva, sem flexibilizar o espaço dos badges (`Conta OK`, `65 tarefas`, `Ativo`). Como resultado, nenhum nome de módulo é lido por inteiro.
2. **Caos e Anarquia na Geometria dos Botões (Button Size & Shape Diversity):**
   - O botão *"Abrir janela de login"* é um retângulo verde grande com raio de 6px; ao lado dele, o botão *"Verificar login no G-Click"* é transparente com borda fina verde clara. Em modais e tabelas, encontram-se botões arredondados, pílulas, ícones isolados sem padding e botões com tamanhos aleatórios.
3. **Ausência de um Sistema de Espaçamento Base (Grid / Spatial System):**
   - Margens e paddings variam arbitrariamente entre `10px`, `15px`, `24px` e `30px`, criando desalinhamentos verticais e horizontais visíveis a olho nu.
4. **Variabilidade Descontrolada de Fontes e Cores de Fundo:**
   - Mistura de pesos de fonte (`font-weight: 400`, `600`, `700`), variações aleatórias de cinza (`#f5f7f6`, `#e2e9e8`, `#dce7e5`) e contornos inconsistentes nos campos de entrada (`input`).

---

## 3. Especificação do Design System & Matriz de Componentes Padronizados (Standard Component Matrix)

Para eliminar a imprevisibilidade e harmonizar 100% das telas da plataforma, a especificação estabelece uma **Matriz Rígida de Componentes**:

### 3.1 Padronização Estrita da Navegação Lateral (Sidebar Alignment)
- **Flex-Layout com Ajuste Automático de Largura (`240px` - `260px`):**
  - O rótulo do texto do menu deve ter prioridade de largura (`flex: 1 min-width: 0`).
  - Em rótulos longos, o texto **nunca será truncado abruptamente**: se necessário, exibirá um tooltip informativo flutuante no evento de `hover`.
  - Badges de estado (`Conta OK`, `Ativo`) migram para o lado esquerdo como um **ponto indicador circular iluminado (`Status Dot`)** ou selo compacto alinhado à direita de forma uniforme.

### 3.2 Matriz de Tamanhos e Variantes de Botões (Button Component System)

A aplicação passará a utilizar estritamente **4 variantes e 3 escalas de botões**, proibindo qualquer estilização *ad-hoc*:

| Escala | Altura (Height) | Padding Horizontal | Font Size | Border Radius | Caso de Uso |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Small (sm)** | `32px` | `12px` | `12px` (`body-sm`) | `6px` | Ações de linha em tabelas, filtros rápidos e badges interativos |
| **Medium (md)** | `40px` (Padrão) | `16px` | `14px` (`body-md`) | `8px` | Formulários, ações de modais e botões primários de seção |
| **Large (lg)** | `48px` | `24px` | `15px` (`body-lg`) | `8px` | Call-to-action principal de onboarding e gatilhos de gravação em lote |

#### As 4 Variantes Semânticas
1. **Primary (`.btn-primary`):** Preenchimento azul corporativo/índigo sólido (`#3B82F6`), texto branco, sombra discreta. Usado apenas para a AÇÃO PRINCIPAL de cada tela.
2. **Secondary (`.btn-secondary`):** Fundo translúcido ou neutro (`Slate 800`/`Slate 100`), borda de 1px. Usado para ações secundárias paralelas.
3. **Ghost (`.btn-ghost`):** Sem fundo ou borda em repouso, apenas texto e fundo sutil ao passar o mouse. Usado para cancelamentos e ações utilitárias.
4. **Danger (`.btn-danger`):** Preenchimento vermelho sólido ou translúcido (`#EF4444`). Exclusivo para exclusões, interrupções e limpezas.

---

## 4. Sistema de Feedback Loops & Mecanismos de Cancelamento

### 4.1 Resposta e Cancelabilidade Garantidas
- **Button Loading States (`.btn-loading`):** Todo botão acionado entra em estado desabilitado com spinner e rótulo no gerúndio.
- **Toast Notifications Enterprise (`ToastManager`):** Notificações de sucesso, aviso, erro e informação no canto superior direito.
- **Mecanismos de Cancelamento com `AbortController`:**
  - Suporte ao parâmetro `signal` no backend (`server.mjs` e `lib/`).
  - Botão *"Cancelar Operação"* e atalho de teclado `Esc` para interromper execuções Playwright ou leituras de planilha com liberação imediata de recursos.

---

## 5. Revisão de Backend & Arquitetura

1. **Decomposição Modular do Servidor (`server.mjs` -> `src/routes/`):**
   - Divisão em roteadores desacoplados (`auth`, `gclick`, `obrigacoes`, `sheets`).
2. **Modularização de `obrigacoes.mjs` (2.346 linhas):**
   - Separação entre navegação Playwright (`AutomationDriver`), extração de DOM (`ObrigacaoParser`) e regras de domínio (`ObrigacaoService`).

---

## 6. Plano de Ação para Implementação

### FASE 1: Implantação do Design System & Matriz de Componentes
- Refatorar o `style.css` criando as classes universais de botões (`.btn-sm`, `.btn-md`, `.btn-lg`, `.btn-primary`, etc.).
- Corrigir a sidebar eliminando truncamentos e padronizando os badges.

### FASE 2: Mecanismos de Cancelamento & Feedback Loops
- Inserir `AbortController` nas rotas do servidor e suporte a atalho `Esc` na UI.

### FASE 3: Refatoração do Backend e Routers
- Desacoplar `server.mjs` e `obrigacoes.mjs` em serviços modulares.

---

## 7. Conclusão

A especificação v3.2.0 resolve definitivamente a imprevisibilidade e a falta de padrão visual do **Enquete Sync**. Ao estabelecer uma matriz rígida para botões, organizar a sidebar e garantir respostas/cancelamentos para o operador, o sistema adquire a robustez e a elegância esperadas de um **software Enterprise de alta performance**.
