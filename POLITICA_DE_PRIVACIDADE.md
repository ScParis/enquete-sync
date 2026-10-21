# Política de Privacidade e Conformidade com a LGPD

**Última atualização: 20 de outubro de 2026**

Esta Política de Privacidade estabelece as diretrizes de proteção de dados, privacidade e segurança aplicáveis ao uso do software **Enquete Sync** ("Aplicação" ou "Software"), em estrita consonância com a **Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 - LGPD)** e demais normas brasileiras de privacidade e segurança da informação.

---

### 1. Princípio Fundamental: Tratamento 100% Local (Privacy by Design)

1.1. O **Enquete Sync** foi concebido e programado sob os princípios de **Privacidade por Padrão (Privacy by Default)** e **Privacidade desde a Concepção (Privacy by Design)**.

1.2. **Arquitetura Fechada / On-Premises**: A aplicação é executada com exclusividade no ambiente computacional (hardware e sistema operacional) do operador ("Usuário").
- **Não há servidores centrais de coleta**: O desenvolvedor do software **não mantém servidores de nuvem, banco de dados externo ou telemetria oculta** para coletar, inspecionar ou armazenar dados manipulados pela aplicação.
- **Não há compartilhamento com terceiros**: Nenhum dado cadastral, fiscal, contábil ou empresarial é transmitido, copiado ou compartilhado com terceiros ou com o desenvolvedor do software.

---

### 2. Qualificação dos Papéis perante a LGPD

Para os fins do Artigo 5º da Lei nº 13.709/2018:

2.1. **Controlador dos Dados**: É o **escritório contábil, consultoria ou empresa contratante** do Usuário, a quem competem as decisões sobre o tratamento de dados, a legitimidade das bases legais adotadas, a finalidade da coleta e o conteúdo das planilhas e cadastros fiscais utilizados como insumo na Ferramenta.

2.2. **Operador Local**: É o **operador humano (consultor, analista ou colaborador)** devidamente autorizado pelo Controlador, responsável por iniciar a aplicação, configurar planilhas, mapear obrigações e conferir os dados antes de qualquer confirmação.

2.3. **Posição do Desenvolvedor / Fornecedor da Ferramenta**: O desenvolvedor atua unicamente como licenciante de um utilitário tecnológico de execução local. **O desenvolvedor NÃO é Controlador nem Operador dos dados fiscais ou pessoais inseridos na ferramenta**, uma vez que não possui posse, custódia, acesso lógico, poderes de decisão ou ingerência sobre os dados processados no ambiente local do Usuário.

---

### 3. Natureza dos Dados Processados

3.1. **Dados de Pessoas Jurídicas**: O escopo primordial do software é o cruzamento de obrigações tributárias de empresas (Pessoas Jurídicas), englobando:
- Número de inscrição no CNPJ;
- Razão Social / Nome Empresarial;
- Código interno de identificação (`EmpID`);
- Obrigações acessórias, regimes tributários e tarefas contábeis (ex.: DAS, DeSTDA, GIA, EFD, ISS).
*Conforme o Art. 1º e Art. 5º, I da LGPD, informações relativas a Pessoas Jurídicas não se qualificam, em regra, como dados pessoais.*

3.2. **Dados Pessoais Incidentais**: Nos casos em que a planilha contiver informações de Microempreendedores Individuais (MEI), Empresários Individuais (EI) ou campos de texto livre que identifiquem pessoas naturais (ex.: sócios ou contadores responsáveis), tais dados serão tratados única e exclusivamente na memória volátil e em arquivos locais do computador do Usuário, para a estrita finalidade de permitir a conferência e o preenchimento de cadastros solicitados pelo próprio Controlador.

3.3. **Dados Sensíveis**: A aplicação **NÃO coleta, não processa e não requer dados pessoais sensíveis** (Art. 11 da LGPD), tais como dados de saúde, biometria, convicção religiosa, dados genéticos, filiação sindical ou orientação sexual.

---

### 4. Armazenamento, Retenção e Descarte de Dados

4.1. **Localização dos Arquivos**: Todos os arquivos gerados pela Ferramenta permanecem sob posse e guarda física exclusiva do Usuário:
- `registros/`: Trilha de auditoria das respostas gravadas e confirmadas pelo operador;
- `runs/`: Relatórios técnicos e logs de execução em formato CSV/JSON;
- Perfil do navegador: Armazenado no diretório de dados do sistema operacional local do Usuário (`~/.local/share/gclick-enquete` no Linux ou `%LOCALAPPDATA%\gclick-enquete` no Windows).

4.2. **Autonomia de Descarte**: O Usuário e o Controlador têm total autonomia técnica para expurgar, a qualquer momento e sem necessidade de prévia solicitação, todos os arquivos de logs, relatórios, cadastros e sessões gerados pelo software, mediante a simples exclusão das pastas locais correspondentes em seu sistema de arquivos.

---

### 5. Integrações Externas e Credenciais de Acesso

5.1. **Integração com Google Sheets / Apps Script**:
- A comunicação com planilhas privadas ou públicas ocorre de forma ponto-a-ponto entre o computador do Usuário e os servidores da Google (Google Sheets API).
- Chaves de contas de serviço Google (`.json`) ou tokens do Apps Script fornecidos pelo Usuário são carregados exclusivamente em memória e utilizados estritamente para a leitura ou atualização solicitada, não sendo enviadas a servidores externos.

5.2. **Autenticação nos Sistemas de Gestão**:
- As credenciais de acesso (usuário, senha, token de dois fatores) são digitadas pelo operador diretamente na janela nativa do navegador Google Chrome.
- A aplicação não intercepta, não registra em log e não armazena senhas digitadas pelo operador.

---

### 6. Deveres de Segurança da Informação do Usuário

6.1. Como os dados residem integralmente no ambiente do Usuário, cabe a este e ao Controlador zelar pelas medidas de segurança lógica e física da máquina (Art. 46 da LGPD), incluindo:
- Uso de senhas fortes para login no sistema operacional;
- Criptografia de disco (ex.: BitLocker no Windows, LUKS no Linux);
- Manutenção de antivírus e sistema operacional atualizados;
- Restrição de acesso físico e lógico ao terminal de trabalho por pessoas não autorizadas.

---

### 7. Atualizações Desta Política

7.1. Esta Política de Privacidade poderá ser aprimorada a qualquer momento para refletir melhorias no software, adequações regulatórias ou novas exigências da Autoridade Nacional de Proteção de Dados (ANPD).

7.2. A versão vigente estará sempre disponível no repositório oficial da aplicação.

---

### 8. Contato e Encarregado de Proteção de Dados (DPO)

Para dúvidas sobre a arquitetura de privacidade desta Ferramenta, esclarecimentos técnicos sobre segurança ou notificações relacionadas à LGPD, entre em contato através dos canais de suporte do desenvolvedor indicados no repositório do projeto.
