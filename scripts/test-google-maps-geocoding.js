/**
 * Test script for Google Maps Geocoding API integration
 * 
 * Usage:
 * node scripts/test-google-maps-geocoding.js
 * 
 * Requirements:
 * - GOOGLE_MAPS_API_KEY_BACKEND in .env file
 */

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') })

// Import geocoding function
const geocoding = await import('../lib/geocoding.js')
const { reverseGeocode } = geocoding

// Test coordinates (major Indian cities)
const testLocations = [
    {
        name: 'Connaught Place, New Delhi',
        latitude: 28.6315,
        longitude: 77.2167
    },
    {
        name: 'Gateway of India, Mumbai',
        latitude: 18.9220,
        longitude: 72.8347
    },
    {
        name: 'MG Road, Bangalore',
        latitude: 12.9762,
        longitude: 77.6033
    },
    {
        name: 'Marina Beach, Chennai',
        latitude: 13.0499,
        longitude: 80.2824
    },
    {
        name: 'Park Street, Kolkata',
        latitude: 22.5542,
        longitude: 88.3516
    }
]

console.log('🧪 Testing Google Maps Geocoding Integration\n')
console.log('='.repeat(70))

// Check if API key is configured
if (!process.env.GOOGLE_MAPS_API_KEY_BACKEND) {
    console.log('⚠️  WARNING: GOOGLE_MAPS_API_KEY_BACKEND not configured')
    console.log('   Will fallback to OpenStreetMap Nominatim\n')
}

// Run tests
async function runTests() {
    let successCount = 0
    let failureCount = 0

    for (const location of testLocations) {
        console.log(`\n📍 Testing: ${location.name}`)
        console.log(`   Coordinates: ${location.latitude}, ${location.longitude}`)

        try {
            const result = await reverseGeocode(location.latitude, location.longitude)

            if (result.success) {
                successCount++
                console.log(`   ✅ Success!`)
                console.log(`   Source: ${result.details?.source || 'unknown'}`)
                console.log(`   Address: ${result.address}`)

                if (result.details) {
                    const { details } = result
                    console.log(`   Details:`)
                    if (details.building) console.log(`     - Building: ${details.building}`)
                    if (details.houseNumber) console.log(`     - House Number: ${details.houseNumber}`)
                    if (details.road) console.log(`     - Road: ${details.road}`)
                    if (details.neighborhood) console.log(`     - Neighborhood: ${details.neighborhood}`)
                    if (details.city) console.log(`     - City: ${details.city}`)
                    if (details.state) console.log(`     - State: ${details.state}`)
                    if (details.pincode) console.log(`     - Pincode: ${details.pincode}`)
                    if (details.country) console.log(`     - Country: ${details.country}`)
                }
            } else {
                failureCount++
                console.log(`   ❌ Failed: ${result.message || 'Unknown error'}`)
            }
        } catch (error) {
            failureCount++
            console.log(`   ❌ Error: ${error.message}`)
        }

        // Rate limit: wait 1 second between requests
        if (testLocations.indexOf(location) < testLocations.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }

    // Summary
    console.log('\n' + '='.repeat(70))
    console.log(`\n📊 Test Summary:`)
    console.log(`   ✅ Successful: ${successCount}/${testLocations.length}`)
    console.log(`   ❌ Failed: ${failureCount}/${testLocations.length}`)

    if (successCount === testLocations.length) {
        console.log(`\n🎉 All tests passed! Google Maps geocoding is working correctly.`)
    } else if (successCount > 0) {
        console.log(`\n⚠️  Some tests failed. Check your API key and configuration.`)
    } else {
        console.log(`\n❌ All tests failed. Please check:`)
        console.log(`   1. GOOGLE_MAPS_API_KEY_BACKEND is set in .env`)
        console.log(`   2. Geocoding API is enabled in Google Cloud Console`)
        console.log(`   3. Billing is enabled`)
        console.log(`   4. API key restrictions allow your server IP`)
    }

    console.log('\n')
}

// Run the tests
runTests().catch(error => {
    console.error('❌ Fatal error running tests:', error)
    process.exit(1)
})
