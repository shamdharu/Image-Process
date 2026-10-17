# Step 2: Get RDS endpoint and deploy the app to EC2
# Run after deploy.ps1 and waiting ~5 minutes for RDS

$info = Get-Content ".\deploy\deployment-info.txt" | ConvertFrom-StringData
$REGION     = $info.REGION
$APP_NAME   = "image-process"

Write-Host "=== Getting RDS endpoint ===" -ForegroundColor Cyan
$RDS_ENDPOINT = aws rds describe-db-instances `
    --db-instance-identifier "$APP_NAME-db" `
    --query "DBInstances[0].Endpoint.Address" `
    --output text `
    --region $REGION

if ($RDS_ENDPOINT -eq "None" -or $RDS_ENDPOINT -eq "") {
    Write-Host "RDS not ready yet. Wait 2 more minutes and re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host "RDS Endpoint: $RDS_ENDPOINT" -ForegroundColor Green

# Add RDS endpoint to deployment info
Add-Content -Path ".\deploy\deployment-info.txt" -Value "RDS_ENDPOINT=$RDS_ENDPOINT"

# Build the .env file for production
$ENV_CONTENT = @"
DB_HOST=$RDS_ENDPOINT
DB_PORT=3306
DB_USER=$($info.DB_USER)
DB_PASSWORD=$($info.DB_PASS)
DB_NAME=$($info.DB_NAME)
STORAGE_PATH=/app/storage
PORT=4000
SESSION_SECRET=$(New-Guid)$(New-Guid)
ADMIN_SEED_PASSWORD=Admin2024!
CORS_ORIGIN=http://$($info.PUBLIC_IP)
GEMINI_API_KEY=
"@
$ENV_CONTENT | Out-File -FilePath ".\deploy\.env.production" -Encoding ascii
Write-Host "Production .env created" -ForegroundColor Green

Write-Host "=== Building React frontend ===" -ForegroundColor Cyan
Set-Location client
npm install
npx vite build --outDir ../deploy/client-dist
Set-Location ..
Write-Host "Frontend built" -ForegroundColor Green

Write-Host "=== Uploading files to EC2 ===" -ForegroundColor Cyan
$KEY = ".\deploy\$($info.KEY_NAME).pem"
$IP  = $info.PUBLIC_IP

# Wait for SSH to be ready
Write-Host "Waiting for EC2 SSH to be ready..."
Start-Sleep -Seconds 30

# Upload server code
Write-Host "Uploading server files..."
scp -i $KEY -r -o StrictHostKeyChecking=no .\server ec2-user@${IP}:/app/
scp -i $KEY -o StrictHostKeyChecking=no .\deploy\.env.production ec2-user@${IP}:/app/.env
scp -i $KEY -o StrictHostKeyChecking=no .\schema.sql ec2-user@${IP}:/app/

# Upload built frontend
scp -i $KEY -r -o StrictHostKeyChecking=no .\deploy\client-dist ec2-user@${IP}:/app/

Write-Host "=== Installing server dependencies on EC2 ===" -ForegroundColor Cyan
ssh -i $KEY -o StrictHostKeyChecking=no ec2-user@$IP @"
cd /app/server
npm install --production
"@

Write-Host "=== Importing database schema ===" -ForegroundColor Cyan
ssh -i $KEY -o StrictHostKeyChecking=no ec2-user@$IP @"
mysql -h $RDS_ENDPOINT -u $($info.DB_USER) -p'$($info.DB_PASS)' < /app/schema.sql
echo 'Schema imported!'
"@

Write-Host "=== Starting the app with PM2 ===" -ForegroundColor Cyan
ssh -i $KEY -o StrictHostKeyChecking=no ec2-user@$IP @"
cd /app/server
pm2 start src/index.js --name image-app
pm2 startup
pm2 save
"@

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host " DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host " Your app is live at:" -ForegroundColor Yellow
Write-Host " http://$($info.PUBLIC_IP)" -ForegroundColor Cyan
Write-Host ""
Write-Host " Default login: admin / Admin2024!" -ForegroundColor Yellow
Write-Host "======================================" -ForegroundColor Green
