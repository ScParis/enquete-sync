# Enquete Sync & G-Click Automação

> **Plataforma Local de Automação, Conferência, Conciliação e Validação de PDF para o G-Click**

O **Enquete Sync** é uma ferramenta de produtividade e automação desenvolvida para consultores e escritórios contábeis. A solução automatiza a leitura da relação de clientes × tarefas/obrigações e realiza o preenchimento, conferência e marcação supervisionada de enquetes de qualificação cadastral, além da criação e mapeamento automático de modelos no módulo **ValidaPDF** do G-Click, eliminando o preenchimento manual individualizado cliente a cliente.

A execução ocorre de forma **100% local**, sem envio de dados fiscais ou CNPJs para servidores de terceiros, garantindo total privacidade e conformidade com a LGPD.

---

## 💻 Compatibilidade do Sistema

O sistema é **totalmente compatível com Windows e Linux** (executando nativamente no Windows 10/11 ou no Linux Ubuntu/Debian, além de suporte a WSL2):

| Componente | Windows (Nativo) | Linux / WSL2 | Observações |
|---|:---:|:---:|---|
| **Node.js (v22+)** | ✅ Suportado | ✅ Suportado | Usa ES Modules nativos |
| **Banco de Dados (SQLite)** | ✅ Suportado | ✅ Suportado | Usa `node:sqlite` nativo (sem compilação C++) |
| **Navegador (Google Chrome)** | ✅ Suportado | ✅ Suportado | Localizado automaticamente pelo Playwright |
| **Módulo ValidaPDF (`pdftotext`)** | ✅ Suportado | ✅ Suportado | Requer utilitário Poppler no PATH |
| **Sessão do Navegador** | ✅ `C:\Users\<User>\.local\...` | ✅ `~/.local/share/...` | Gerenciado via `os.homedir()` |
| **Downloads de Planilhas** | ✅ `C:\Users\<User>\Downloads` | ✅ `~/Downloads` | Pasta padrão do usuário |

---

## 📋 Requisitos Pré-requisitos

1. **Node.js**: Versão **22.0.0** ou superior ([Download Node.js](https://nodejs.org/)).
2. **Google Chrome**: Navegador instalado no sistema ([Download Chrome](https://www.google.com/chrome/)).
3. **Poppler (`pdftotext`)** *(necessário para o módulo ValidaPDF)*:
   - **Windows**: Instalação em um comando via terminal:
     ```powershell
     winget install poppler
     ```
     *(ou via Chocolatey: `choco install poppler`)*
   - **Linux (Ubuntu/Debian)**:
     ```bash
     sudo apt update && sudo apt install -y poppler-utils
     ```

---

## 🚀 Instalação e Uso no Windows

### Passo 1: Instalar o Node.js e o Poppler

1. Abra o **PowerShell** (ou Terminal do Windows) como Administrador ou usuário comum.
2. Verifique se o Node.js 22+ está instalado:
   ```powershell
   node -v
   ```
   *(Caso não esteja instalado, baixe em [nodejs.org](https://nodejs.org/) ou instale via `winget install OpenJS.NodeJS.LTS`).*

3. Instale o utilitário **Poppler** para permitir a leitura e autodetecção de texto dos PDFs:
   ```powershell
   winget install poppler
   ```
   > **Dica:** Feche e reabra o terminal após instalar o Poppler para atualizar as variáveis de ambiente (`PATH`). Para testar, execute `pdftotext -v`.

### Passo 2: Instalar as Dependências

Navegue até a pasta `automacao` do projeto:

```powershell
cd automacao
npm install
```

*(Opcional) Caso deseje instalar os navegadores gerenciados do Playwright:*
```powershell
npx playwright install chromium
```

### Passo 3: Iniciar o Servidor

No PowerShell ou Prompt de Comando (`cmd`):

```powershell
npm start
```

O terminal exibirá a inicialização:
```text
G-Click local: http://127.0.0.1:8766
```

### Passo 4: Acessar o Painel

Abra seu navegador (Google Chrome, Edge ou Firefox) e acesse:
```
http://127.0.0.1:8766
```

---

## 🐧 Instalação e Uso no Linux / WSL2

```bash
# 1. Instalar utilitários no Linux
sudo apt update
sudo apt install -y poppler-utils

# 2. Instalar dependências do projeto
cd automacao
npm install

# 3. Iniciar o servidor
npm start
```

---

## 🧭 Funcionalidades do Painel

1. **Conexão e Sessão G-Click**:
   - Clique em **Abrir janela de login** para autenticar de forma segura na interface do G-Click. O perfil e os cookies de sessão ficam salvos localmente no seu computador.
2. **ValidaPDF & Criação de Modelos**:
   - **Varredura em Lote**: Analisa pastas locais de arquivos PDF e gera diagnóstico de conformidade com os 3 pilares do G-Click (Obrigação, Inscrição e Competência).
   - **Novo Mapeamento & Autodetecção**: Carrega o PDF do modelo, autodetecta os 3 pilares (inclusive CPF sem máscara e datas anuais/mensais), permite seleção interativa com mouse na linha e grifo visual.
   - **Criação Automática no G-Click**: Dispara o robô Playwright para criar o modelo no departamento, mapear os campos, configurar multi-linhas e validar comparativamente sem falsos-positivos.
3. **Enquete Sync (Clientes × Obrigações)**:
   - Importa planilhas (Google Sheets ou CSV/XLSX local).
   - Realiza conferência automática e gravação supervisionada pelo operador com confirmação segura.
4. **Relatórios e Diagnóstico**:
   - Emissão de relatórios em HTML/PDF para impressão e exportação em CSV/JSON.

---

## 🧪 Testes Automatizados

Para rodar a suíte completa de testes unitários e de integração:

```bash
cd automacao
npm test
```

Para rodar especificamente a suíte de testes do ValidaPDF:

```bash
node --test test/valida-pdf.test.mjs
```

---

## 🔒 Licença, Termos de Uso e Privacidade

- **Licença**: Software Proprietário. Todos os direitos reservados.
- **Termos de Uso**: O uso desta ferramenta está sujeito aos termos operacionais descritos em [TERMOS_DE_USO.md](TERMOS_DE_USO.md).
- **Política de Privacidade e LGPD**: Diretrizes detalhadas em [POLITICA_DE_PRIVACIDADE.md](POLITICA_DE_PRIVACIDADE.md).
