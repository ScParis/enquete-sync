# Enquete Sync

> **Plataforma de Automação, Conferência e Conciliação de Enquetes Fiscais e Contábeis**

O **Enquete Sync** é uma ferramenta de produtividade desenvolvida para consultores e escritórios contábeis. A solução automatiza a leitura da relação de clientes × tarefas/obrigações e realiza o preenchimento, conferência e marcação supervisionada de enquetes de qualificação cadastral, eliminando o preenchimento manual individualizado cliente a cliente.

A execução ocorre de forma **100% local**, sem envio de dados fiscais ou CNPJs para servidores de terceiros, garantindo total privacidade e conformidade com a LGPD.

---

## Principais Recursos

- **Conferência Automática em Tempo Real**: Analisa cada cliente e obrigação da planilha confrontando com as perguntas cadastradas, classificando com precisão os estados (*Já correto*, *Sem resposta / A gravar*, *Divergente*, *Bloqueado* ou *Não localizado*).
- **Gravação Supervisionada (Operador Soberano)**: O robô automatiza o preenchimento na interface, mas a decisão final de confirmação de qualquer lote permanece exclusiva do operador humano no diálogo do sistema.
- **Conciliação e Retorno na Planilha**: Registra o histórico de gravações confirmadas em trilha de auditoria local (`registros/`) e sincroniza automaticamente o status na planilha de trabalho do escritório via integração Google Apps Script.
- **Detecção de Conflitos e Inconsistências**: Previne gravações indevidas ao identificar tarefas conflitantes para o mesmo cliente em perguntas de escolha única, CNPJs duplicados ou cadastros ausentes.
- **Privacidade por Padrão (Privacy by Design)**: Nenhum dado de cliente (CNPJ, razão social, obrigações) é transmitido para nuvens externas. O perfil de sessão e os dados de conciliação permanecem restritos ao ambiente local do operador.

---

## Requisitos do Sistema

- **Sistema Operacional**: Linux (Ubuntu 22.04+ / Debian 12+) ou Windows 10/11 com ambiente Node.js.
- **Node.js**: Versão 22 ou superior.
- **Navegador**: Google Chrome instalado.
- **Dependências**: Gerenciador de pacotes `npm`.

---

## Guia de Início Rápido

### 1. Instalação

Clone o repositório e instale as dependências na pasta `automacao`:

```bash
cd automacao
npm install
```

### 2. Execução da Aplicação

Inicie o servidor local:

```bash
npm start
```

Abra em seu navegador:
```
http://127.0.0.1:8766
```

### 3. Fluxo de Trabalho Recomendado

1. **Identificação da Conta**: Informe o código do escritório atendido para carregar as configurações e links associados.
2. **Conexão**: Abra a janela de navegação pelo botão da interface e realize a autenticação no sistema de gestão. O catálogo de perguntas e respostas é capturado automaticamente.
3. **Seleção da Planilha**: Informe o link da planilha no Google Sheets ou envie o arquivo (`.csv`/`.xlsx`) com as colunas de tarefas e CNPJs.
4. **Mapeamento de Tarefas**: Associe cada obrigação da planilha à pergunta e resposta correspondente na enquete, ou marque como tarefa excluída.
5. **Conferência Prévia**: Acompanhe o resultado da conferência automática e o relatório detalhado de pendências.
6. **Gravação**: Clique em *Marcar respostas*, confira os clientes destacados na janela do navegador e confirme o diálogo.

---

## Testes Automatizados

A suíte de testes unitários e de integração garante a confiabilidade de todas as rotinas de conferência, conciliação e regras de negócio:

```bash
cd automacao
npm test
```

---

## Licença e Termos de Uso

- **Licença**: Software Proprietário. Todos os direitos reservados. Consulte o arquivo [LICENSE](LICENSE) para maiores detalhes.
- **Termos de Uso**: O uso desta ferramenta está sujeito aos termos e condições descritos em [TERMOS_DE_USO.md](TERMOS_DE_USO.md).
