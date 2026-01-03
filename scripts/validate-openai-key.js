#!/usr/bin/env node

/**
 * OpenAI API Key Validator
 * Run this script to check if your OpenAI API key is valid
 */

require('dotenv').config({ path: '.env' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function validateOpenAIKey() {
  console.log('🔍 Validating OpenAI API Key...\n');

  if (!OPENAI_API_KEY) {
    console.error('❌ ERROR: OPENAI_API_KEY not found in .env');
    console.log('\n📋 Steps to fix:');
    console.log('1. Go to https://platform.openai.com/api-keys');
    console.log('2. Create a new API key');
    console.log('3. Add it to .env: OPENAI_API_KEY=sk-...');
    process.exit(1);
  }

  console.log('✅ API Key found:', OPENAI_API_KEY.substring(0, 15) + '...');

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
    });

    if (response.ok) {
      console.log('✅ API Key is VALID!');
      console.log('✅ OpenAI API connection successful\n');
      
      const data = await response.json();
      console.log(`📊 Available models: ${data.data.length}`);
      console.log('🎉 MIRA is ready to chat!\n');
      
      process.exit(0);
    } else {
      const error = await response.json();
      console.error('❌ API Key is INVALID!');
      console.error('❌ Error:', error.error.message);
      console.log('\n📋 Steps to fix:');
      console.log('1. Go to https://platform.openai.com/api-keys');
      console.log('2. Create a NEW API key');
      console.log('3. Update .env: OPENAI_API_KEY=sk-...');
      console.log('4. Restart your dev server: npm run dev\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
    console.log('Please check your internet connection\n');
    process.exit(1);
  }
}

validateOpenAIKey();
