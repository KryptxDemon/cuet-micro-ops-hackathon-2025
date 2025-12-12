#!/bin/bash

# ============================================
# Delineate VM Deployment Script
# ============================================
# This script will deploy your application to the Brilliant Cloud VM
# Floating IP: 36.255.68.124
# ============================================

set -e  # Exit on any error

FLOATING_IP="36.255.68.124"
PROJECT_NAME="cuet-micro-ops-hackathon-2025"
PROJECT_PATH="/mnt/Data_Drive_1/Hackathon/Round of 50/$PROJECT_NAME"

echo "============================================"
echo "🚀 Delineate VM Deployment Script"
echo "============================================"
echo "Target IP: $FLOATING_IP"
echo "Project: $PROJECT_NAME"
echo ""

# Step 1: Upload project to VM
echo "📦 Step 1: Uploading project to VM..."
echo "-------------------------------------------"
scp -r "$PROJECT_PATH" root@$FLOATING_IP:~/
echo "✅ Project uploaded successfully!"
echo ""

# Step 2: Create environment file on VM
echo "⚙️  Step 2: Creating environment file..."
echo "-------------------------------------------"
ssh root@$FLOATING_IP "cat > ~/$PROJECT_NAME/.env.docker" << 'EOF'
# Application Settings
NODE_ENV=production
PORT=3000

# S3 Storage (MinIO)
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET_NAME=downloads
S3_FORCE_PATH_STYLE=true
S3_REGION=us-east-1

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379

# Download Settings
DOWNLOAD_DELAY_MIN_MS=10000
DOWNLOAD_DELAY_MAX_MS=120000

# Performance Settings
NODE_OPTIONS=--max-old-space-size=384
UV_THREADPOOL_SIZE=8
EOF
echo "✅ Environment file created!"
echo ""

# Step 3: Install Docker and dependencies on VM
echo "🐳 Step 3: Installing Docker on VM..."
echo "-------------------------------------------"
ssh root@$FLOATING_IP << 'ENDSSH'
# Update system
apt update -qq

# Install Docker if not already installed
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl start docker
    systemctl enable docker
else
    echo "Docker already installed"
fi

# Install Docker Compose if not already installed
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose already installed"
fi

docker --version
docker-compose --version
ENDSSH
echo "✅ Docker installed!"
echo ""

# Step 4: Configure firewall on VM
echo "🔒 Step 4: Configuring firewall..."
echo "-------------------------------------------"
ssh root@$FLOATING_IP << 'ENDSSH'
# Install UFW if not installed
apt install -y ufw -qq

# Configure firewall rules
ufw --force allow 22/tcp
ufw --force allow 80/tcp
ufw --force allow 443/tcp
ufw --force allow 3000/tcp
ufw --force allow 9001/tcp
ufw --force enable

echo "Firewall status:"
ufw status
ENDSSH
echo "✅ Firewall configured!"
echo ""

# Step 5: Deploy application
echo "🚢 Step 5: Deploying application..."
echo "-------------------------------------------"
ssh root@$FLOATING_IP << ENDSSH
cd ~/$PROJECT_NAME
docker-compose -f docker/compose.prod.yml down 2>/dev/null || true
docker-compose -f docker/compose.prod.yml up -d --build
echo ""
echo "Waiting for services to start..."
sleep 10
echo ""
echo "Container status:"
docker ps
ENDSSH
echo "✅ Application deployed!"
echo ""

# Step 6: Verify deployment
echo "🔍 Step 6: Verifying deployment..."
echo "-------------------------------------------"
sleep 5
if curl -s http://$FLOATING_IP:3000/health | grep -q "ok"; then
    echo "✅ Health check passed!"
else
    echo "⚠️  Health check failed. Checking logs..."
    ssh root@$FLOATING_IP "cd ~/$PROJECT_NAME && docker-compose -f docker/compose.prod.yml logs --tail=50"
fi
echo ""

# Final summary
echo "============================================"
echo "🎉 Deployment Complete!"
echo "============================================"
echo ""
echo "📍 Your application is now running at:"
echo "   API:           http://$FLOATING_IP:3000"
echo "   Health:        http://$FLOATING_IP:3000/health"
echo "   API Docs:      http://$FLOATING_IP:3000/docs"
echo "   MinIO Console: http://$FLOATING_IP:9001"
echo ""
echo "🔐 MinIO Credentials:"
echo "   Username: minioadmin"
echo "   Password: minioadmin"
echo ""
echo "📊 Useful commands:"
echo "   View logs:     ssh root@$FLOATING_IP 'cd ~/$PROJECT_NAME && docker-compose -f docker/compose.prod.yml logs -f'"
echo "   Restart:       ssh root@$FLOATING_IP 'cd ~/$PROJECT_NAME && docker-compose -f docker/compose.prod.yml restart'"
echo "   Stop:          ssh root@$FLOATING_IP 'cd ~/$PROJECT_NAME && docker-compose -f docker/compose.prod.yml down'"
echo ""
echo "⚠️  IMPORTANT: Configure security groups in Brilliant Cloud Portal!"
echo "   Go to Instance → Network → Security Groups"
echo "   Add inbound rules for ports: 22, 80, 443, 3000, 9001"
echo ""
echo "============================================"
