#!/bin/bash
# EC2 User Data -- runs as root on first boot
# Sets up Node.js 20, nginx, and the app structure

set -e
exec > /var/log/userdata.log 2>&1

echo "=== Starting setup ==="

# Update system
dnf update -y

# Install Node.js 20
dnf install -y nodejs20 npm
ln -sf /usr/bin/node20 /usr/bin/node || true

# Install nginx
dnf install -y nginx

# Install MySQL client (to import schema)
dnf install -y mysql

# Install git
dnf install -y git

# Create app directory
mkdir -p /app
mkdir -p /app/storage/incoming
mkdir -p /app/storage/categories
chown -R ec2-user:ec2-user /app

# Install PM2 globally to keep the Node server running
npm install -g pm2

# Enable nginx on boot
systemctl enable nginx
systemctl start nginx

# Configure nginx as reverse proxy
cat > /etc/nginx/conf.d/imageapp.conf << 'NGINX'
server {
    listen 80;
    server_name _;

    # Serve React frontend static files
    root /app/client-dist;
    index index.html;

    # API requests go to Express on port 4000
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 100M;
    }

    # React Router -- all non-API routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

systemctl reload nginx

echo "=== Setup complete. Ready for app deployment. ==="
