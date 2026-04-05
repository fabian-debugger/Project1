#!/bin/bash
# Setup script voor Oracle Cloud Free Tier VM
# Draai dit script na het SSH'en naar je VM:
#   chmod +x setup-oracle.sh && ./setup-oracle.sh

set -e

echo "=== Docker installeren ==="
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER

echo ""
echo "=== Repository klonen ==="
cd ~
git clone https://github.com/fabian-debugger/project1.git
cd project1

echo ""
echo "=== .env bestand aanmaken ==="
cp .env.example .env
echo ""
echo "============================================"
echo "  SETUP BIJNA KLAAR!"
echo "============================================"
echo ""
echo "Volgende stappen:"
echo ""
echo "1. Vul je .env bestand in:"
echo "   nano ~/project1/.env"
echo "   -> Vul je GEMINI_API_KEY in"
echo "   -> Controleer de WHATSAPP_GROUP_NAME"
echo ""
echo "2. Log opnieuw in (voor Docker rechten):"
echo "   exit"
echo "   (SSH opnieuw verbinden)"
echo ""
echo "3. Start de bot:"
echo "   cd ~/project1"
echo "   docker compose up -d"
echo ""
echo "4. Bekijk de logs voor de QR-code:"
echo "   docker compose logs -f"
echo ""
echo "5. Scan de QR-code met WhatsApp"
echo "   (klik op de URL in de logs)"
echo ""
echo "============================================"
