/**
 * Test script for screenshot upload functionality
 * Run with: node test-screenshot-upload.js
 */

const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function testScreenshotUpload() {
  console.log('=== Screenshot Upload Test ===\n');
  console.log(`Server URL: ${SERVER_URL}`);

  // You need a valid JWT token to test
  const token = process.env.TEST_TOKEN || '';
  
  if (!token) {
    console.error('\n⚠️  No test token provided!');
    console.log('Set TEST_TOKEN environment variable with a valid JWT token');
    console.log('\nExample:');
    console.log('TEST_TOKEN="your-jwt-token" node test-screenshot-upload.js\n');
    
    // Still test if the endpoint exists
    console.log('Testing endpoint availability...');
    try {
      const response = await fetch(`${SERVER_URL}/api/activity/screenshot`, {
        method: 'GET'
      });
      console.log(`GET /api/activity/screenshot: ${response.status} ${response.statusText}`);
    } catch (error) {
      console.error('Failed to reach endpoint:', error.message);
    }
    return;
  }

  // Test 1: Check clock status
  console.log('\n1. Testing clock status endpoint...');
  try {
    const clockResponse = await fetch(`${SERVER_URL}/api/activity/clock-status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const clockData = await clockResponse.json();
    console.log(`   Status: ${clockResponse.status}`);
    console.log(`   Data:`, JSON.stringify(clockData, null, 2));
  } catch (error) {
    console.error('   Error:', error.message);
  }

  // Test 2: Upload a test screenshot
  console.log('\n2. Testing screenshot upload...');
  try {
    // Create a small test image (1x1 pixel red PNG)
    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    const uploadResponse = await fetch(`${SERVER_URL}/api/activity/screenshot`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        screenshot: testImageBase64,
        timestamp: Date.now().toString()
      })
    });
    
    const uploadData = await uploadResponse.json();
    console.log(`   Status: ${uploadResponse.status}`);
    console.log(`   Data:`, JSON.stringify(uploadData, null, 2));
    
    if (uploadData.success && uploadData.path) {
      // Verify file exists
      const filePath = path.join(process.cwd(), 'public', uploadData.path);
      if (fs.existsSync(filePath)) {
        console.log(`   ✓ File created at: ${filePath}`);
      } else {
        console.log(`   ✗ File NOT found at: ${filePath}`);
      }
    }
  } catch (error) {
    console.error('   Error:', error.message);
  }

  // Test 3: Check screenshot info endpoint
  console.log('\n3. Testing screenshot info endpoint...');
  try {
    const infoResponse = await fetch(`${SERVER_URL}/api/activity/screenshot`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const infoData = await infoResponse.json();
    console.log(`   Status: ${infoResponse.status}`);
    console.log(`   Data:`, JSON.stringify(infoData, null, 2));
  } catch (error) {
    console.error('   Error:', error.message);
  }

  console.log('\n=== Test Complete ===\n');
}

testScreenshotUpload().catch(console.error);
