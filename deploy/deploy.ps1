# ============================================================
# Image-Process App -- AWS Deployment Script
# Run this in PowerShell from the Image-process folder:
#   cd C:\Users\USER\Desktop\Image-process
#   .\deploy\deploy.ps1
# ============================================================

$REGION      = "ap-south-1"
$APP_NAME    = "image-process"
$DB_NAME     = "image_platform"
$DB_USER     = "admin"
$DB_PASS     = "ImageApp2024!"   # change if you want
$KEY_NAME    = "image-process-key"

Write-Host "=== Step 1: Create EC2 Key Pair ===" -ForegroundColor Cyan
aws ec2 create-key-pair `
    --key-name $KEY_NAME `
    --query "KeyMaterial" `
    --output text `
    --region $REGION | Out-File -FilePath ".\deploy\$KEY_NAME.pem" -Encoding ascii
Write-Host "Key saved to deploy\$KEY_NAME.pem" -ForegroundColor Green

Write-Host "=== Step 2: Get Default VPC ===" -ForegroundColor Cyan
$VPC_ID = aws ec2 describe-vpcs `
    --filters "Name=is-default,Values=true" `
    --query "Vpcs[0].VpcId" `
    --output text `
    --region $REGION
Write-Host "VPC: $VPC_ID" -ForegroundColor Green

Write-Host "=== Step 3: Get Subnets ===" -ForegroundColor Cyan
$SUBNETS = aws ec2 describe-subnets `
    --filters "Name=vpc-id,Values=$VPC_ID" `
    --query "Subnets[*].SubnetId" `
    --output text `
    --region $REGION
$SUBNET_LIST = $SUBNETS -split "\t"
$SUBNET1 = $SUBNET_LIST[0]
$SUBNET2 = $SUBNET_LIST[1]
Write-Host "Subnets: $SUBNET1, $SUBNET2" -ForegroundColor Green

Write-Host "=== Step 4: Create Security Groups ===" -ForegroundColor Cyan

# EC2 security group - allows HTTP (80), HTTPS (443), SSH (22), and API (4000)
$EC2_SG = aws ec2 create-security-group `
    --group-name "$APP_NAME-ec2-sg" `
    --description "Image Process EC2 Security Group" `
    --vpc-id $VPC_ID `
    --query "GroupId" `
    --output text `
    --region $REGION
Write-Host "EC2 SG: $EC2_SG" -ForegroundColor Green

aws ec2 authorize-security-group-ingress --group-id $EC2_SG --protocol tcp --port 22   --cidr 0.0.0.0/0 --region $REGION | Out-Null
aws ec2 authorize-security-group-ingress --group-id $EC2_SG --protocol tcp --port 80   --cidr 0.0.0.0/0 --region $REGION | Out-Null
aws ec2 authorize-security-group-ingress --group-id $EC2_SG --protocol tcp --port 443  --cidr 0.0.0.0/0 --region $REGION | Out-Null
aws ec2 authorize-security-group-ingress --group-id $EC2_SG --protocol tcp --port 4000 --cidr 0.0.0.0/0 --region $REGION | Out-Null

# RDS security group - only allow MySQL from EC2 SG
$RDS_SG = aws ec2 create-security-group `
    --group-name "$APP_NAME-rds-sg" `
    --description "Image Process RDS Security Group" `
    --vpc-id $VPC_ID `
    --query "GroupId" `
    --output text `
    --region $REGION
Write-Host "RDS SG: $RDS_SG" -ForegroundColor Green

aws ec2 authorize-security-group-ingress `
    --group-id $RDS_SG `
    --protocol tcp --port 3306 `
    --source-group $EC2_SG `
    --region $REGION | Out-Null

Write-Host "=== Step 5: Create RDS Subnet Group ===" -ForegroundColor Cyan
aws rds create-db-subnet-group `
    --db-subnet-group-name "$APP_NAME-subnet-group" `
    --db-subnet-group-description "Image Process DB Subnet Group" `
    --subnet-ids $SUBNET1 $SUBNET2 `
    --region $REGION | Out-Null

Write-Host "=== Step 6: Launch RDS MySQL (free tier) ===" -ForegroundColor Cyan
aws rds create-db-instance `
    --db-instance-identifier "$APP_NAME-db" `
    --db-instance-class db.t3.micro `
    --engine mysql `
    --engine-version "8.0" `
    --master-username $DB_USER `
    --master-user-password $DB_PASS `
    --db-name $DB_NAME `
    --allocated-storage 20 `
    --no-multi-az `
    --no-publicly-accessible `
    --vpc-security-group-ids $RDS_SG `
    --db-subnet-group-name "$APP_NAME-subnet-group" `
    --backup-retention-period 0 `
    --region $REGION | Out-Null
Write-Host "RDS instance launched (takes ~5 min to be ready)" -ForegroundColor Yellow

Write-Host "=== Step 7: Launch EC2 t2.micro (free tier) ===" -ForegroundColor Cyan

# Amazon Linux 2023 AMI for ap-south-1
$AMI_ID = aws ec2 describe-images `
    --owners amazon `
    --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" `
    --query "sort_by(Images, &CreationDate)[-1].ImageId" `
    --output text `
    --region $REGION

Write-Host "Using AMI: $AMI_ID" -ForegroundColor Green

$USER_DATA = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content -Raw ".\deploy\userdata.sh")))

$INSTANCE_ID = aws ec2 run-instances `
    --image-id $AMI_ID `
    --instance-type t2.micro `
    --key-name $KEY_NAME `
    --security-group-ids $EC2_SG `
    --subnet-id $SUBNET1 `
    --associate-public-ip-address `
    --user-data $USER_DATA `
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$APP_NAME}]" `
    --query "Instances[0].InstanceId" `
    --output text `
    --region $REGION
Write-Host "EC2 Instance: $INSTANCE_ID" -ForegroundColor Green

Write-Host "=== Waiting for EC2 to be running ===" -ForegroundColor Cyan
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION

$PUBLIC_IP = aws ec2 describe-instances `
    --instance-ids $INSTANCE_ID `
    --query "Reservations[0].Instances[0].PublicIpAddress" `
    --output text `
    --region $REGION
Write-Host "EC2 Public IP: $PUBLIC_IP" -ForegroundColor Green

# Save deployment info
@"
INSTANCE_ID=$INSTANCE_ID
PUBLIC_IP=$PUBLIC_IP
VPC_ID=$VPC_ID
EC2_SG=$EC2_SG
RDS_SG=$RDS_SG
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_NAME=$DB_NAME
REGION=$REGION
KEY_NAME=$KEY_NAME
"@ | Out-File -FilePath ".\deploy\deployment-info.txt" -Encoding ascii

Write-Host ""
Write-Host "=== Infrastructure Created! ===" -ForegroundColor Green
Write-Host "EC2 IP: $PUBLIC_IP" -ForegroundColor Yellow
Write-Host "Now run: .\deploy\step2-get-rds-endpoint.ps1" -ForegroundColor Yellow
Write-Host "(Wait ~5 minutes for RDS to finish launching first)" -ForegroundColor Yellow
