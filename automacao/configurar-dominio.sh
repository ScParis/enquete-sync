#!/usr/bin/env bash
set -e
DOMAIN="app.jb-consultoria.com"
PORT=8766
echo "=========================================================="
echo "Configurando domínio local: http://${DOMAIN}/"
echo "=========================================================="
# 1. Configurar /etc/hosts
if grep -q "${DOMAIN}" /etc/hosts; then
  echo "✔ O domínio ${DOMAIN} já está presente em /etc/hosts"
else
  echo "Adicionando ${DOMAIN} em /etc/hosts..."
  echo "127.0.0.1 ${DOMAIN}" | sudo tee -a /etc/hosts > /dev/null
  echo "✔ Domínio ${DOMAIN} adicionado em /etc/hosts com sucesso!"
fi
# 2. Configurar redirecionamento da porta 80 -> 8766 via iptables
echo "Configurando redirecionamento da porta 80 para a porta ${PORT}..."
sudo iptables -t nat -C OUTPUT -p tcp -d 127.0.0.1 --dport 80 -j REDIRECT --to-ports "${PORT}" 2>/dev/null || \
  sudo iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport 80 -j REDIRECT --to-ports "${PORT}"
sudo iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports "${PORT}" 2>/dev/null || \
  sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports "${PORT}"
echo "✔ Redirecionamento de porta 80 configurado com sucesso!"
echo ""
echo "Pronto! Agora você pode acessar diretamente:"
echo "👉 http://${DOMAIN}/"
echo "=========================================================="