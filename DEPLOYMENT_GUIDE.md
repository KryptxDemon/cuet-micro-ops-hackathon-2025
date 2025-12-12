# VM Deployment Guide - Brilliant Cloud

This guide will help you deploy the Delineate application to your Brilliant Cloud VM instance.

## Prerequisites

✅ VM instance created  
✅ Floating IP attached  
✅ SSH access to VM

---

## Step 1: Connect to Your VM via SSH

```bash
# Replace with your floating IP address
ssh root@YOUR_FLOATING_IP

# Example: ssh root@103.191.240.123
```

**Note:** If you get a permission denied error, you may need to use a key file:

```bash
ssh -i /path/to/your/key.pem root@YOUR_FLOATING_IP
```

---

## Step 2: Update System & Install Required Software

Once connected to your VM, run these commands:

```bash
# Update package lists
sudo apt update && sudo apt upgrade -y

# Install essential packages
sudo apt install -y curl git wget nano
```

---

## Step 3: Install Docker & Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Verify Docker installation
docker --version

# Install Docker Compose (latest version)
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify Docker Compose installation
docker-compose --version
```

---

## Step 4: Clone Your Project Repository

```bash
# Navigate to home directory
cd ~

# Clone your repository
git clone https://github.com/YOUR_USERNAME/cuet-micro-ops-hackathon-2025.git

# Or if you're pushing from your local machine, you can use SCP:
# From your LOCAL machine (not VM):
# scp -r /mnt/Data_Drive_1/Hackathon/Round\ of\ 50/cuet-micro-ops-hackathon-2025 root@YOUR_FLOATING_IP:~/

# Navigate to project directory
cd cuet-micro-ops-hackathon-2025
```

---

## Step 5: Create Environment File

```bash
# Create the .env.docker file
nano .env.docker
```

Copy and paste this configuration:

```env
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

# Optional: Add your Sentry DSN if you have one
# SENTRY_DSN=your_sentry_dsn_here
```

**Save the file:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## Step 6: Configure Firewall Rules

Open the necessary ports on your VM:

```bash
# Allow SSH (if not already allowed)
sudo ufw allow 22/tcp

# Allow HTTP
sudo ufw allow 80/tcp

# Allow HTTPS
sudo ufw allow 443/tcp

# Allow application port (3000)
sudo ufw allow 3000/tcp

# Allow MinIO console (optional, for debugging)
sudo ufw allow 9001/tcp

# Enable firewall
sudo ufw --force enable

# Check status
sudo ufw status
```

**Also configure firewall rules in Brilliant Cloud Portal:**

1. Go to your instance in the portal
2. Navigate to Network → Security Groups
3. Add rules for ports: 22, 80, 443, 3000

---

## Step 7: Build and Deploy with Docker Compose

```bash
# Make sure you're in the project directory
cd ~/cuet-micro-ops-hackathon-2025

# Build and start all services
docker-compose -f docker/compose.prod.yml up -d --build

# This will start:
# - delineate-app (API server on port 3000)
# - delineate-worker (Background job processor)
# - redis (Job queue)
# - minio (S3-compatible storage)
```

---

## Step 8: Verify Deployment

```bash
# Check if all containers are running
docker ps

# You should see 4 containers running:
# - delineate-api-prod
# - delineate-worker-prod
# - delineate-redis-prod
# - delineate-minio-prod

# Check logs
docker-compose -f docker/compose.prod.yml logs -f

# Check specific service logs
docker-compose -f docker/compose.prod.yml logs -f delineate-app
```

---

## Step 9: Test Your API

From your **local machine** (not the VM):

```bash
# Replace YOUR_FLOATING_IP with your actual IP
curl http://YOUR_FLOATING_IP:3000/health

# Should return: {"status":"ok"}

# Test the download endpoint
curl -X POST http://YOUR_FLOATING_IP:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 12345}'

# You should get a job_id in response
```

Or visit in your browser:

- API: `http://YOUR_FLOATING_IP:3000`
- API Documentation: `http://YOUR_FLOATING_IP:3000/docs`
- MinIO Console: `http://YOUR_FLOATING_IP:9001` (login: minioadmin/minioadmin)

---

## Step 10: (Optional) Set Up Nginx Reverse Proxy

For production, it's recommended to use Nginx as a reverse proxy:

```bash
# Install Nginx
sudo apt install -y nginx

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/delineate
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name YOUR_FLOATING_IP;  # or your domain name

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Increase timeouts for long-running requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

Enable the site:

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/delineate /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

Now your API will be accessible at: `http://YOUR_FLOATING_IP` (port 80)

---

## Common Management Commands

### View Logs

```bash
# All services
docker-compose -f docker/compose.prod.yml logs -f

# Specific service
docker-compose -f docker/compose.prod.yml logs -f delineate-app
```

### Restart Services

```bash
# Restart all
docker-compose -f docker/compose.prod.yml restart

# Restart specific service
docker-compose -f docker/compose.prod.yml restart delineate-app
```

### Stop Services

```bash
docker-compose -f docker/compose.prod.yml down
```

### Update Application (after code changes)

```bash
# Pull latest code
cd ~/cuet-micro-ops-hackathon-2025
git pull

# Rebuild and restart
docker-compose -f docker/compose.prod.yml up -d --build
```

### Check Resource Usage

```bash
# Container stats
docker stats

# Disk usage
docker system df
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose -f docker/compose.prod.yml logs delineate-app

# Check if port is already in use
sudo lsof -i :3000
```

### Out of disk space

```bash
# Clean up Docker resources
docker system prune -a --volumes

# Check disk space
df -h
```

### Can't access from browser

```bash
# Check if service is listening
sudo netstat -tlnp | grep 3000

# Check firewall
sudo ufw status

# Check if Docker containers are running
docker ps
```

### Redis connection issues

```bash
# Check Redis container
docker-compose -f docker/compose.prod.yml logs redis

# Test Redis connection
docker exec -it delineate-redis-prod redis-cli ping
```

---

## Security Recommendations

1. **Change default passwords** in `.env.docker`:
   - Update `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
   - Update MinIO credentials

2. **Use SSH key authentication** instead of password:

   ```bash
   ssh-copy-id -i ~/.ssh/id_rsa.pub root@YOUR_FLOATING_IP
   ```

3. **Disable root SSH login** after creating a user account

4. **Set up automatic security updates**:

   ```bash
   sudo apt install unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```

5. **Monitor logs regularly**:
   ```bash
   docker-compose -f docker/compose.prod.yml logs --tail=100
   ```

---

## Next Steps

- [ ] Set up a custom domain name
- [ ] Configure SSL/TLS with Let's Encrypt
- [ ] Set up monitoring (Prometheus + Grafana)
- [ ] Configure automated backups
- [ ] Set up CI/CD pipeline for automatic deployments

---

## Need Help?

If you encounter issues:

1. Check the logs: `docker-compose -f docker/compose.prod.yml logs -f`
2. Verify all containers are running: `docker ps`
3. Check firewall rules in both VM and Brilliant Cloud Portal
4. Ensure your floating IP is properly attached to the instance

**Your application should now be running at:** `http://YOUR_FLOATING_IP:3000`
