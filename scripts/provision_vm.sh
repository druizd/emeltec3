#!/bin/bash
# Script de aprovisionamiento para Ubuntu en Azure

set -e

echo "🚀 Iniciando configuración del servidor Emeltec..."

# 1. Actualizar el sistema
sudo apt-get update && sudo apt-get upgrade -y

# 2. Instalar dependencias básicas
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# 3. Instalar Docker
if ! command -v docker &> /dev/null; then
    echo "🐳 Instalando Docker..."
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# 4. Configurar permisos
sudo usermod -aG docker $USER

# 5. Ejecutar la plataforma
echo "🏗️ Levantando contenedores..."
docker compose up -d

echo "✅ ¡Configuración completada con éxito!"
echo "📡 Acceso Frontend: http://$(curl -s ifconfig.me):5173"
echo "⚙️  Acceso API: http://$(curl -s ifconfig.me):3000"
