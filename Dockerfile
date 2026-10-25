# Dockerfile para G-Click Enquete Sync
# Imagem base oficial Playwright com Node 22 e navegadores instalados
FROM mcr.microsoft.com/playwright:v1.48.0-noble

# Configura diretório de trabalho
WORKDIR /app

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=8766
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copia manifestos de dependência
COPY package*.json ./
COPY automacao/package*.json ./automacao/

# Instala dependências de produção
RUN cd automacao && npm ci --omit=dev

# Copia o código da aplicação
COPY . .

# Expõe a porta do servidor web
EXPOSE 8766

# Diretórios de dados persistentes montados via volume
VOLUME ["/app/automacao/data", "/app/automacao/catalogos", "/app/automacao/registros", "/app/automacao/runs"]

# Executa o servidor da aplicação
WORKDIR /app/automacao
CMD ["node", "server.mjs"]
