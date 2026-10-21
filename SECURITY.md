# Política de Segurança — Enquete Sync

A segurança da informação, a integridade dos dados fiscais e a conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018) são pilares fundamentais da arquitetura do **Enquete Sync**.

---

## Versões com Suporte Oficial

Atualizações de segurança e correções de integridade são fornecidas exclusivamente para as versões ativas listadas abaixo:

| Versão | Suporte a Segurança | Status |
| :--- | :---: | :--- |
| `0.1.x` | :white_check_mark: | **Ativa (Suporte Regular)** |
| `< 0.1.0` | :x: | Descontinuada / Não suportada |

---

## Diretrizes de Arquitetura Segura (Security by Design)

O software foi concebido sob princípios estritos de soberania de dados:

1. **Execução Estritamente Local**: Toda a conferência, mapeamento e preenchimento ocorrem na máquina do operador, sem tráfego de dados sensíveis (CNPJs, razão social ou obrigações) para servidores externos ou nuvens de terceiros.
2. **Prevenção contra Vazamento de Dados**: Planilhas, arquivos CSV com dados de clientes e trilhas de conciliação nunca devem ser versionados em repositórios ou compartilhados externamente.
3. **Decisão Humana Soberana**: Nenhuma alteração cadastral ou envio de respostas é executado sem a validação visual e confirmação expressa do operador no diálogo do sistema.

---

## Como Reportar uma Vulnerabilidade

Se você identificar qualquer vulnerabilidade de segurança, potencial vetor de vazamento de dados ou comportamento inesperado no sistema:

> [!WARNING]
> **NÃO abra uma issue pública ou comente publicamente no repositório sobre a falha.**

### Procedimento de Divulgação Responsável:

1. **Contato Privado**:
   - Envie um e-mail confidencial para: **`schpariss@gmail.com`**
   - Assunto: `[SECURITY] Relato de Vulnerabilidade - Enquete Sync`
   - Ou utilize a aba privada de **Security Advisories** do próprio GitHub (caso habilitada).

2. **Informações Desejadas no Relato**:
   - Descrição detalhada da vulnerabilidade ou comportamento anômalo.
   - Passos reproduzíveis ou Prova de Conceito (PoC) simplificada.
   - Versão do Node.js, sistema operacional e navegador utilizados.
   - Análise de impacto potencial sobre a confidencialidade ou integridade dos dados.

3. **Prazos e Resposta**:
   - **Confirmação de recebimento**: em até **48 horas úteis**.
   - **Análise preliminar e plano de mitigação**: em até **5 dias úteis**.
   - Notificaremos quando a correção for disponibilizada e validada.

---

## Boas Práticas Recomendadas para o Operador

- Mantenha o arquivo `.gitignore` sempre íntegro e verifique o diretório local `docs/` e `registros/` antes de qualquer sincronização externa.
- Execute o sistema sempre em ambientes locais confiáveis e protegidos por autenticação de sistema operacional.
- Utilize sempre as versões atualizadas do ambiente Node.js LTS e do navegador Google Chrome.
