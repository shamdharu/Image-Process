# AWS Deployment Guide

## What gets created (all FREE TIER)
- EC2 t2.micro — runs Express API + serves uploaded files (750 hrs/mo free)
- RDS MySQL db.t3.micro — your database (750 hrs/mo free for 12 months)
- nginx on EC2 — reverse proxy, serves React frontend

## Steps

### Step 1 — Run the infrastructure script
Open PowerShell as normal user (not admin), navigate to your project:

```powershell
cd C:\Users\USER\Desktop\Image-process
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\deploy\deploy.ps1
```

This will:
- Create an EC2 key pair (saved as deploy\image-process-key.pem)
- Create security groups
- Launch RDS MySQL (free tier)
- Launch EC2 t2.micro (free tier)
- Print your EC2 public IP

**Wait 5 minutes for RDS to finish launching.**

### Step 2 — Deploy the app
```powershell
.\deploy\step2-deploy-app.ps1
```

This will:
- Get the RDS endpoint
- Build the React frontend
- Upload everything to EC2 via SCP
- Import the database schema
- Start the Node.js server with PM2

### Done!
Your app will be live at `http://<EC2-IP>`

Default login: `admin` / `Admin2024!`

## Costs
- Within AWS Free Tier: $0/month for 12 months
- After free tier: ~$25-30/month if you keep it running

## To SSH into your server later
```powershell
ssh -i .\deploy\image-process-key.pem ec2-user@<EC2-IP>
```

## To view server logs
```bash
pm2 logs image-app
```
