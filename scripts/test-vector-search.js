/**
 * Test Vector Search
 * This script tests if vector search is working correctly
 * Run: node scripts/test-vector-search.js
 */

// Load environment variables
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { searchEmployees, searchAnnouncements, multiCollectionSearch } = require('../lib/vectorSearch');

async function main() {
  console.log('\n🧪 Testing Vector Search\n');

  try {
    // Test 1: Search employees
    console.log('📋 Test 1: Search for employees\n');
    console.log('Query: "software developer with React experience"\n');

    const employeeResults = await searchEmployees('software developer with React experience', {
      limit: 3,
    });

    console.log(`✅ Found ${employeeResults.length} employees:\n`);
    employeeResults.forEach((emp, index) => {
      console.log(`${index + 1}. ${emp.name || 'Unknown'}`);
      console.log(`   Email: ${emp.email || 'N/A'}`);
      console.log(`   Designation: ${emp.designation || 'N/A'}`);
      console.log(`   Department: ${emp.department || 'N/A'}`);
      console.log(`   Search Score: ${emp._searchScore?.toFixed(4) || 'N/A'}`);
      console.log('');
    });

    // Test 2: Search announcements
    console.log('\n📋 Test 2: Search for announcements\n');
    console.log('Query: "company events and celebrations"\n');

    const announcementResults = await searchAnnouncements('company events and celebrations', {
      limit: 3,
    });

    console.log(`✅ Found ${announcementResults.length} announcements:\n`);
    if (announcementResults.length === 0) {
      console.log('   (No announcements in database yet)\n');
    } else {
      announcementResults.forEach((ann, index) => {
        console.log(`${index + 1}. ${ann.title || 'Untitled'}`);
        console.log(`   Description: ${ann.description || 'N/A'}`);
        console.log(`   Search Score: ${ann._searchScore?.toFixed(4) || 'N/A'}`);
        console.log('');
      });
    }

    // Test 3: Multi-collection search
    console.log('\n📋 Test 3: Multi-collection search\n');
    console.log('Query: "engineering team"\n');

    const multiResults = await multiCollectionSearch('engineering team', {
      limit: 5,
    });

    console.log(`✅ Found ${multiResults.length} results across all collections:\n`);
    multiResults.forEach((result, index) => {
      console.log(`${index + 1}. [${result._collection}] ${result.name || result.title || 'Unknown'}`);
      console.log(`   Search Score: ${result._searchScore?.toFixed(4) || 'N/A'}`);
      console.log('');
    });

    console.log('\n🎉 Vector search is working correctly!\n');
    console.log('✅ Next steps:');
    console.log('   1. Start your app: npm run dev');
    console.log('   2. Test the API: POST /api/mira/vector-search');
    console.log('   3. Test MIRA chat: POST /api/mira/chat-with-context\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Vector search test failed:', error.message);
    console.error('\nPossible issues:');
    console.error('   - Vector indexes not created in MongoDB Atlas');
    console.error('   - Embeddings not generated yet');
    console.error('   - MongoDB connection issue\n');
    console.error('Full error:', error);
    process.exit(1);
  }
}

main();

