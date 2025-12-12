#!/bin/bash
# Test script to verify all 5 hints are properly implemented

BASE_URL="http://localhost:3000"

echo "=============================================="
echo "  TESTING ALL 5 HACKATHON HINTS"
echo "=============================================="
echo ""

# ---------------------------------------------
# HINT 1: Browser closes mid-download
# ---------------------------------------------
echo "=== HINT 1: Browser Closes Mid-Download ==="
echo "Creating job and NOT polling (simulating browser close)..."

RESPONSE=$(curl -s -X POST "$BASE_URL/v1/download/async" \
  -H "Content-Type: application/json" \
  -d '{"file_ids": [10001]}')

JOB1_ID=$(echo "$RESPONSE" | jq -r '.jobId')
echo "Job ID: $JOB1_ID"
echo "Waiting 5 seconds (browser closed)..."
sleep 5

STATUS=$(curl -s "$BASE_URL/v1/download/status/$JOB1_ID")
JOB1_STATUS=$(echo "$STATUS" | jq -r '.status')
echo "Status after return: $JOB1_STATUS"

if [ "$JOB1_STATUS" = "ready" ]; then
  echo "✅ HINT 1 PASSED: Job completed in background!"
else
  echo "⚠️  Job still processing (status: $JOB1_STATUS)"
fi
echo ""

# ---------------------------------------------
# HINT 2: Multiple concurrent downloads
# ---------------------------------------------
echo "=== HINT 2: Multiple Concurrent Downloads ==="
echo "Creating 3 jobs simultaneously..."

JOB2A=$(curl -s -X POST "$BASE_URL/v1/download/async" -H "Content-Type: application/json" -d '{"file_ids": [20001]}')
JOB2B=$(curl -s -X POST "$BASE_URL/v1/download/async" -H "Content-Type: application/json" -d '{"file_ids": [20002]}')
JOB2C=$(curl -s -X POST "$BASE_URL/v1/download/async" -H "Content-Type: application/json" -d '{"file_ids": [20003]}')

JOB2A_ID=$(echo "$JOB2A" | jq -r '.jobId')
JOB2B_ID=$(echo "$JOB2B" | jq -r '.jobId')
JOB2C_ID=$(echo "$JOB2C" | jq -r '.jobId')

echo "Job A: $JOB2A_ID"
echo "Job B: $JOB2B_ID"
echo "Job C: $JOB2C_ID"

echo "Waiting 6 seconds for all to complete..."
sleep 6

STATUS_A=$(curl -s "$BASE_URL/v1/download/status/$JOB2A_ID" | jq -r '.status')
STATUS_B=$(curl -s "$BASE_URL/v1/download/status/$JOB2B_ID" | jq -r '.status')
STATUS_C=$(curl -s "$BASE_URL/v1/download/status/$JOB2C_ID" | jq -r '.status')

echo "Job A status: $STATUS_A"
echo "Job B status: $STATUS_B"
echo "Job C status: $STATUS_C"

if [ "$STATUS_A" = "ready" ] && [ "$STATUS_B" = "ready" ] && [ "$STATUS_C" = "ready" ]; then
  echo "✅ HINT 2 PASSED: All concurrent jobs completed!"
else
  echo "⚠️  Some jobs still processing"
fi
echo ""

# ---------------------------------------------
# HINT 3: Cost implications (documentation check)
# ---------------------------------------------
echo "=== HINT 3: Cost Implications ==="
if grep -q "Cost Considerations" ARCHITECTURE.md 2>/dev/null; then
  echo "✅ HINT 3 PASSED: Cost section exists in ARCHITECTURE.md"
  grep -A 8 "Cost Considerations" ARCHITECTURE.md | head -10
else
  echo "❌ HINT 3: Cost section missing"
fi
echo ""

# ---------------------------------------------
# HINT 4: Redis, BullMQ, SSE, WebSockets
# ---------------------------------------------
echo "=== HINT 4: Technology Implementation ==="

# Test SSE endpoint exists
echo "Testing SSE endpoint..."
SSE_TEST=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/download/subscribe/$JOB1_ID")
if [ "$SSE_TEST" = "200" ]; then
  echo "✅ SSE endpoint working (HTTP $SSE_TEST)"
else
  echo "⚠️  SSE endpoint returned HTTP $SSE_TEST"
fi

# Check Redis is running
echo "Testing Redis connection..."
REDIS_PING=$(docker exec delineate-redis redis-cli ping 2>/dev/null || echo "FAILED")
if [ "$REDIS_PING" = "PONG" ]; then
  echo "✅ Redis is running"
else
  echo "⚠️  Redis check: $REDIS_PING"
fi

# Check documentation mentions technologies
echo "Checking documentation..."
TECH_COUNT=0
for tech in "Redis" "BullMQ" "SSE" "WebSocket"; do
  if grep -q "$tech" ARCHITECTURE.md 2>/dev/null; then
    echo "  ✓ $tech documented"
    TECH_COUNT=$((TECH_COUNT + 1))
  fi
done
echo "✅ HINT 4: $TECH_COUNT/4 technologies documented"
echo ""

# ---------------------------------------------
# HINT 5: Presigned S3 URLs
# ---------------------------------------------
echo "=== HINT 5: Presigned S3 URLs ==="
echo "Checking download URL from completed job..."

DOWNLOAD_URL=$(curl -s "$BASE_URL/v1/download/status/$JOB1_ID" | jq -r '.downloadUrl')

if [[ "$DOWNLOAD_URL" == *"X-Amz-Signature"* ]]; then
  echo "✅ HINT 5 PASSED: Presigned URL contains AWS signature!"
  echo "URL preview: ${DOWNLOAD_URL:0:80}..."
elif [[ "$DOWNLOAD_URL" == "null" ]]; then
  echo "⚠️  No download URL yet (job may still be processing)"
else
  echo "URL: $DOWNLOAD_URL"
fi
echo ""

# ---------------------------------------------
# SUMMARY
# ---------------------------------------------
echo "=============================================="
echo "  TEST SUMMARY"
echo "=============================================="
echo ""
echo "Run 'npm run test:e2e' for full E2E test suite"
echo ""
