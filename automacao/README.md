# Automação local da Enquete & ValidaPDF G-Click

Ferramenta do consultor que atende escritórios contábeis usuários do G-Click. Lê a planilha de clientes × obrigações/tarefas de um escritório e marca, na Enquete desse escritório, as respostas correspondentes, além de diagnosticar lotes de PDFs e criar/mapear modelos no **ValidaPDF** do G-Click.

Roda em Node.js e Google Chrome locais, sem API de IA e sem envio de dados a nuvens externas. 
- **Linux:** Sessão salva em `~/.local/share/gclick-enquete/browser-profile`
- **Windows:** Sessão salva em `C:\Users\<SeuUsuario>\.local\share\gclick-enquete\browser-profile`
A senha é digitada exclusivamente na tela de login oficial do G-Click.

---

## 💻 Compatibilidade e Requisitos

O sistema foi concebido com arquitetura multiplataforma, sendo **100% compatível com Windows e Linux**:

- **Node.js**: Versão 22 ou superior (utiliza o módulo nativo `node:sqlite` para o banco de dados local, dispensando ferramentas de compilação C++ como Visual Studio Build Tools ou Python).
- **Google Chrome**: Instalado (o Playwright localiza automaticamente tanto em `C:\Program Files\Google\Chrome\Application\chrome.exe` quanto no Linux `/usr/bin/google-chrome`).
- **Poppler (`pdftotext`)**: Necessário para o submódulo ValidaPDF:
  - **No Windows:**
    ```powershell
    winget install poppler
    ```
    *(ou via Chocolatey: `choco install poppler`)*
  - **No Linux (Debian/Ubuntu):**
    ```bash
    sudo apt update && sudo apt install -y poppler-utils
    ```

---

## 🚀 Como Iniciar

Na pasta `automacao`, execute:

```bash
# 1. Instalar dependências (Playwright e módulos)
npm install

# 2. Iniciar o servidor
npm start
```

Abra em seu navegador:
```
http://127.0.0.1:8766
```

O servidor escuta somente em `127.0.0.1` para total segurança local. Para encerrar, pressione `Ctrl+C` no terminal.

---

## 📖 Fluxos de Uso

### 1. Módulo ValidaPDF & Criação de Modelos
1. **Varredura e Diagnóstico**:
   - Informe o caminho de uma pasta local com arquivos PDF (ex: `C:\Documentos\PDFs` ou caminhos no Linux).
   - O sistema realiza varredura recursiva, extrai os dados via `pdftotext` e valida as regras de Obrigação, Cliente (CNPJ/CPF) e Competência.
2. **Novo Mapeamento**:
   - Carregue um PDF de exemplo de um modelo que deseja cadastrar.
   - O sistema autodetecta os 3 pilares estruturais (inclusive CPFs sem pontuação como no eSocial Doméstico).
   - O usuário pode selecionar qualquer trecho com o mouse para ajustar o recorte exato com feedback visual em cores oficiais do G-Click.
   - Clique em **Criar & Mapear no G-Click**: o robô acessa o G-Click, cria o modelo no departamento, grava os 3 pilares, habilita multi-linhas e realiza a conferência comparativa com acompanhamento passo a passo no depurador em tempo real.

### 2. Módulo Enquete Sync (Clientes × Obrigações)
1. **Conta:** Informe o `empId` do escritório no campo **Conta G-Click**.
2. **Login:** Clique em **Abrir janela de login** e entre no G-Click na janela do Chrome. Assim que o login é concluído, o robô captura o catálogo de perguntas e respostas. Mantenha a janela aberta.
3. **Planilha:** Cole o link da aba do Google Sheets ou envie arquivo local (`.csv`/`.xlsx`).
4. **Mapeamentos:** Associe cada tarefa distinta da planilha à pergunta e resposta correspondente na Enquete.
5. **Conferência:** O sistema classifica automaticamente cada cliente/tarefa (*Já correto*, *Pendente*, *Divergente*, *Bloqueado* ou *Não localizado*).
6. **Gravação:** Clique em **Marcar respostas no G-Click**. O operador revisa a lista e confirma a gravação com total segurança.

---

## 🛡️ Garantias e Regras de Segurança

- **Decisão do Operador:** O robô nunca clica em botões de confirmação irreversíveis sem supervisão do operador humano.
- **Validação Comparativa sem Falsos-Positivos:** No ValidaPDF, o sistema diferencia testes com modelos não-conflitantes de erros reais de colisão.
- **Isolamento de Contas e RBAC:** Permissões de usuários e registros mantidos em SQLite local com isolamento total por conta (`empId`).

---

## 🧪 Testes Automatizados

Para executar os testes automatizados da aplicação:

```bash
# Todos os testes
npm test

# Testes específicos do ValidaPDF
node --test test/valida-pdf.test.mjs
```
