/**
 * Master Setup Script for Vector Database
 * This script guides you through the complete setup process
 * Run: node scripts/setup-vector-db.js
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log('\n🚀 MIRA Vector Database Setup Wizard\n');
  console.log('This wizard will help you set up vector search for MIRA.\n');

  // Step 1: Check environment variables
  console.log('📋 Step 1: Environment Variables\n');

  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log('✅ Found .env file\n');
  } else {
    console.log('⚠️  No .env file found. Creating one...\n');
  }

  // Check MongoDB URI
  if (!envContent.includes('MONGODB_URI=')) {
    const mongoUri = await question('Enter your MongoDB Atlas connection string: ');
    envContent += `\nMONGODB_URI=${mongoUri}`;
  } else {
    console.log('✅ MONGODB_URI found');
  }

  // Check MongoDB DB Name
  if (!envContent.includes('MONGODB_DB_NAME=')) {
    const dbName = await question('Enter your database name (default: hrms_db): ');
    envContent += `\nMONGODB_DB_NAME=${dbName || 'hrms_db'}`;
  } else {
    console.log('✅ MONGODB_DB_NAME found');
  }

  // Check OpenAI API Key
  if (!envContent.includes('OPENAI_API_KEY=')) {
    console.log('\n📝 OpenAI API Key (for embeddings)');
    console.log('   - Option 1: Use OpenAI (best quality, ~$0.02 per 10K docs)');
    console.log('   - Option 2: Use FREE embeddings (no cost, good quality)\n');

    const useOpenAI = await question('Do you want to use OpenAI embeddings? (y/n): ');

    if (useOpenAI.toLowerCase() === 'y') {
      const openaiKey = await question('Enter your OpenAI API key: ');
      envContent += `\nOPENAI_API_KEY=${openaiKey}`;
    } else {
      console.log('✅ Will use FREE embeddings (no API key needed)');
    }
  } else {
    console.log('✅ OPENAI_API_KEY found');
  }

  // Save .env
  fs.writeFileSync(envPath, envContent.trim());
  console.log('\n✅ Environment variables saved to .env\n');

  // Step 2: MongoDB Atlas Index Setup
  console.log('📋 Step 2: MongoDB Atlas Vector Search Index\n');
  console.log('You need to create vector search indexes in MongoDB Atlas.\n');
  console.log('📖 Follow these steps:\n');
  console.log('1. Open MongoDB Atlas in your browser');
  console.log('2. Go to your cluster → Search & Vector Search');
  console.log('3. Click "Create Search Index"');
  console.log('4. Use these settings:\n');
  console.log('   Index Name: vector_index');
  console.log('   Database: hrms_db');
  console.log('   Collection: announcements (start with this)\n');

  const useOpenAIEmbeddings = envContent.includes('OPENAI_API_KEY=sk-');

  if (useOpenAIEmbeddings) {
    console.log('5. Index Definition (OpenAI - 1536 dimensions):\n');
    console.log(JSON.stringify({
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: 1536,
          similarity: 'cosine',
        },
        {
          type: 'filter',
          path: 'metadata.type',
        },
        {
          type: 'filter',
          path: 'metadata.department',
        },
      ],
    }, null, 2));
  } else {
    console.log('5. Index Definition (FREE - 384 dimensions):\n');
    console.log(JSON.stringify({
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: 384,
          similarity: 'cosine',
        },
        {
          type: 'filter',
          path: 'metadata.type',
        },
        {
          type: 'filter',
          path: 'metadata.department',
        },
      ],
    }, null, 2));
  }

  console.log('\n6. Click "Create Search Index"');
  console.log('7. Wait 2-3 minutes for index to build');
  console.log('8. Repeat for these collections:');
  console.log('   - employees');
  console.log('   - assets');
  console.log('   - companymeetings');
  console.log('   - dailygoals');
  console.log('   - departments\n');

  const indexCreated = await question('Have you created the vector indexes? (y/n): ');

  if (indexCreated.toLowerCase() !== 'y') {
    console.log('\n⚠️  Please create the indexes first, then run this script again.\n');
    console.log('📖 See MONGODB_ATLAS_VECTOR_SETUP.md for detailed instructions.\n');
    rl.close();
    return;
  }

  // Step 3: Generate Embeddings
  console.log('\n📋 Step 3: Generate Embeddings\n');
  console.log('Now we need to generate vector embeddings for your data.\n');

  if (useOpenAIEmbeddings) {
    console.log('Run this command:\n');
    console.log('  node scripts/generate-embeddings-openai.js\n');
  } else {
    console.log('Run this command:\n');
    console.log('  node scripts/generate-embeddings-free.js\n');
  }

  console.log('This will:');
  console.log('  - Read all documents from your collections');
  console.log('  - Generate vector embeddings');
  console.log('  - Store embeddings back in MongoDB\n');

  const runNow = await question('Do you want to run the embedding script now? (y/n): ');

  if (runNow.toLowerCase() === 'y') {
    console.log('\n🔄 Starting embedding generation...\n');
    rl.close();

    const { spawn } = require('child_process');
    const scriptName = useOpenAIEmbeddings
      ? 'generate-embeddings-openai.js'
      : 'generate-embeddings-free.js';

    const child = spawn('node', [path.join(__dirname, scriptName)], {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Embedding generation complete!\n');
        console.log('📋 Next Steps:\n');
        console.log('1. Test the API: npm run dev');
        console.log('2. Try a search: curl -X POST http://localhost:3000/api/mira/vector-search \\');
        console.log('     -H "Content-Type: application/json" \\');
        console.log('     -d \'{"query": "company events", "type": "announcements"}\'');
        console.log('\n🎉 Setup complete! MIRA now has vector search capabilities!\n');
      } else {
        console.log('\n❌ Embedding generation failed. Check the error above.\n');
      }
    });
  } else {
    console.log('\n📝 Manual Steps:\n');
    console.log(`1. Run: node scripts/${useOpenAIEmbeddings ? 'generate-embeddings-openai.js' : 'generate-embeddings-free.js'}`);
    console.log('2. Wait for completion');
    console.log('3. Test the API\n');
    rl.close();
  }
}

main().catch((error) => {
  console.error('❌ Setup error:', error);
  rl.close();
  process.exit(1);
});

