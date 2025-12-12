#!/bin/bash

# Quick test script for your deployed application
# Floating IP: 36.255.68.124

FLOATING_IP="36.255.68.124"

echo "🧪 Testing your deployed application..."
echo "=========================================="
echo ""

# Test 1: Health check
echo "1️⃣  Health Check:"
curl -s http://$FLOATING_IP:3000/health && echo "" || echo "❌ Health check failed"
echo ""

# Test 2: Root endpoint
echo "2️⃣  Root Endpoint:"
curl -s http://$FLOATING_IP:3000/ | head -c 100 && echo "..." || echo "❌ Root endpoint failed"
echo ""

# Test 3: Start a download job
echo "3️⃣  Starting Download Job:"
RESPONSE=$(curl -s -X POST http://$FLOATING_IP:3000/v1/download/start \
  -H "Content-Type: application/json" \
  -d '{"file_id": 12345}')
echo "$RESPONSE"
echo ""

# Extract job_id from response if available
JOB_ID=$(echo "$RESPONSE" | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$JOB_ID" ]; then
    echo "✅ Job created with ID: $JOB_ID"
    echo ""
    echo "4️⃣  Checking Job Status:"
    sleep 2
    curl -s "http://$FLOATING_IP:3000/v1/download/status/$JOB_ID"
    echo ""
else
    echo "⚠️  Could not extract job_id from response"
fi

echo ""
echo "=========================================="
echo "🌐 Access Points:"
echo "   API:           http://$FLOATING_IP:3000"
echo "   API Docs:      http://$FLOATING_IP:3000/docs"
echo "   MinIO Console: http://$FLOATING_IP:9001"
echo "=========================================="
