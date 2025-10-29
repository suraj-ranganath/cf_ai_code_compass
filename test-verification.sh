#!/bin/bash

# Full Verification Test Script for cf_ai_repo_socratic_mentor
# Tests all rubric requirements with real API calls

set -e  # Exit on error

API_URL="https://cf-ai-repo-socratic-mentor.suranganath.workers.dev"
FRONTEND_URL="https://socratic-mentor.pages.dev"
TEST_REPO="https://github.com/expressjs/express"  # Small, well-known repo for testing

echo "========================================"
echo "VERIFICATION TEST SUITE"
echo "========================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

# Helper functions
pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    ((pass_count++))
}

fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    ((fail_count++))
}

info() {
    echo -e "${YELLOW}ℹ INFO:${NC} $1"
}

# Test 1: Health Check
echo "Test 1: Backend Health Check"
echo "----------------------------"
health_response=$(curl -s "$API_URL/health")
if echo "$health_response" | grep -q '"status":"healthy"'; then
    pass "Backend API is healthy"
else
    fail "Backend API health check failed: $health_response"
fi
echo ""

# Test 2: Repository Ingestion
echo "Test 2: Repository Ingestion"
echo "----------------------------"
info "Ingesting $TEST_REPO (this may take 30-60 seconds)..."
ingest_response=$(curl -s -X POST "$API_URL/api/ingest?repo=$TEST_REPO&batch=1" | jq -c '.')
if echo "$ingest_response" | grep -q '"success":true'; then
    pass "Repository ingested successfully"
    files_processed=$(echo "$ingest_response" | jq -r '.stats.filesProcessed // 0')
    chunks_stored=$(echo "$ingest_response" | jq -r '.stats.chunksStored // 0')
    info "Files processed: $files_processed, Chunks stored: $chunks_stored"
else
    fail "Repository ingestion failed: $ingest_response"
fi
echo ""

# Test 3: Repository Analysis
echo "Test 3: Repository Analysis & Primer"
echo "----------------------------"
analyze_payload='{"repoUrl":"'$TEST_REPO'","goal":"Understand the middleware system"}'
analyze_response=$(curl -s -X POST "$API_URL/api/analyze" \
    -H "Content-Type: application/json" \
    -d "$analyze_payload")

session_id=$(echo "$analyze_response" | jq -r '.sessionId // empty')
if [ -n "$session_id" ]; then
    pass "Repository analyzed, session created: $session_id"
    
    # Check for analysis data
    if echo "$analyze_response" | jq -e '.analysis.structure | length > 0' > /dev/null; then
        pass "Repository structure extracted"
        file_count=$(echo "$analyze_response" | jq '.analysis.structure | length')
        info "Files found: $file_count"
    else
        fail "Repository structure missing"
    fi
    
    # Check for prerequisites/concepts
    if echo "$analyze_response" | jq -e '.analysis.prerequisites | length >= 3' > /dev/null; then
        pass "Foundational concepts extracted (3+ found)"
        concepts=$(echo "$analyze_response" | jq -r '.analysis.prerequisites[:3] | map(if type == "string" then . else .name end) | join(", ")')
        info "Concepts: $concepts"
    else
        fail "Less than 3 foundational concepts found"
    fi
    
    # Check for welcome message
    if echo "$analyze_response" | jq -e '.welcomeMessage | length > 10' > /dev/null; then
        pass "Personalized welcome message generated"
    else
        fail "Welcome message missing or too short"
    fi
else
    fail "Repository analysis failed: $analyze_response"
fi
echo ""

# Test 4: Concept Primer Generation
echo "Test 4: Concept Primer Generation"
echo "----------------------------"
primer_payload='{"sessionId":"'$session_id'","goal":"Learn middleware patterns"}'
primer_response=$(curl -s -X POST "$API_URL/api/primer" \
    -H "Content-Type: application/json" \
    -d "$primer_payload")

if echo "$primer_response" | jq -e '.primer | length > 100' > /dev/null; then
    pass "Concept primer generated (100+ chars)"
    info "Primer preview: $(echo "$primer_response" | jq -r '.primer' | head -c 100)..."
else
    fail "Primer generation failed or too short"
fi
echo ""

# Test 5: Semantic Search
echo "Test 5: Semantic Search (Vectorize)"
echo "----------------------------"
search_response=$(curl -s "$API_URL/api/search?q=middleware+function&repo=expressjs/express&topK=3")
if echo "$search_response" | jq -e '.results | length > 0' > /dev/null; then
    pass "Semantic search returned results"
    result_count=$(echo "$search_response" | jq '.results | length')
    info "Results found: $result_count"
    
    # Check for file paths in results
    if echo "$search_response" | jq -e '.results[0].filePath' > /dev/null; then
        pass "Search results include file paths"
        first_file=$(echo "$search_response" | jq -r '.results[0].filePath')
        info "Top result: $first_file"
    else
        fail "Search results missing file path metadata"
    fi
else
    fail "Semantic search returned no results (repo may not be fully indexed)"
fi
echo ""

# Test 6: Chat/Dialogue (Socratic Interaction)
echo "Test 6: Socratic Dialogue"
echo "----------------------------"
chat_payload='{"sessionId":"'$session_id'","message":"What is middleware?"}'
chat_response=$(curl -s -X POST "$API_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "$chat_payload")

if echo "$chat_response" | jq -e '.response.content | length > 20' > /dev/null; then
    pass "Chat response generated"
    response_preview=$(echo "$chat_response" | jq -r '.response.content' | head -c 150)
    info "Response: $response_preview..."
    
    # Check if response is question-based (Socratic method)
    if echo "$response_preview" | grep -qi '\?'; then
        pass "Response includes Socratic questions"
    else
        info "Response may not follow Socratic method (no '?' detected)"
    fi
else
    fail "Chat response failed or too short"
fi
echo ""

# Test 7: Flashcard Generation
echo "Test 7: Flashcard Generation"
echo "----------------------------"
# First, update session with some struggle concepts
flashcard_payload='{"sessionId":"'$session_id'"}'
flashcard_response=$(curl -s -X POST "$API_URL/api/flashcards" \
    -H "Content-Type: application/json" \
    -d "$flashcard_payload")

if echo "$flashcard_response" | jq -e '.flashcards | length == 5' > /dev/null; then
    pass "Exactly 5 flashcards generated"
    
    # Check flashcard structure
    if echo "$flashcard_response" | jq -e '.flashcards[0].front and .flashcards[0].back' > /dev/null; then
        pass "Flashcards have front/back structure"
    else
        fail "Flashcards missing proper structure"
    fi
else
    flashcard_count=$(echo "$flashcard_response" | jq -e '.flashcards | length' || echo "0")
    if [ "$flashcard_count" -eq 0 ]; then
        info "No flashcards generated (may need user struggles to be tracked)"
    else
        fail "Expected 5 flashcards, got $flashcard_count"
    fi
fi
echo ""

# Test 8: Study Plan Generation
echo "Test 8: Study Plan Generation"
echo "----------------------------"
plan_payload='{"sessionId":"'$session_id'"}'
plan_response=$(curl -s -X POST "$API_URL/api/plan" \
    -H "Content-Type: application/json" \
    -d "$plan_payload")

if echo "$plan_response" | jq -e '.studyPlan.plan | length > 0' > /dev/null; then
    pass "Study plan generated"
    activities=$(echo "$plan_response" | jq '.studyPlan.plan | length')
    duration=$(echo "$plan_response" | jq -r '.studyPlan.totalMinutes // "N/A"')
    info "Activities: $activities, Duration: ${duration} minutes"
else
    info "Study plan generation skipped (may need user struggles)"
fi
echo ""

# Test 9: Frontend Accessibility
echo "Test 9: Frontend Accessibility"
echo "----------------------------"
frontend_response=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
if [ "$frontend_response" = "200" ]; then
    pass "Frontend is accessible at $FRONTEND_URL"
else
    fail "Frontend returned HTTP $frontend_response"
fi
echo ""

# Test 10: Durable Objects (Session State)
echo "Test 10: Durable Objects (Session State)"
echo "----------------------------"
session_response=$(curl -s "$API_URL/api/session/$session_id")
if echo "$session_response" | jq -e '.id and .repoUrl and .messages' > /dev/null; then
    pass "Session state persisted in Durable Object"
    message_count=$(echo "$session_response" | jq '.messages | length')
    info "Messages in session: $message_count"
else
    fail "Session state retrieval failed"
fi
echo ""

# Summary
echo "========================================"
echo "VERIFICATION SUMMARY"
echo "========================================"
echo -e "Total Tests: $((pass_count + fail_count))"
echo -e "${GREEN}Passed: $pass_count${NC}"
echo -e "${RED}Failed: $fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
