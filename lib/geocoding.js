/**
 * Geocoding Utility
 * 
 * Uses Google Maps Geocoding API for precise reverse geocoding (coordinates to address)
 * Falls back to OpenStreetMap Nominatim if Google Maps fails
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY_BACKEND;
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

/**
 * Reverse geocode using Google Maps API (Primary method)
 * 
 * @param {number} latitude - GPS latitude
 * @param {number} longitude - GPS longitude
 * @returns {Promise<{success: boolean, address: string, details: object|null, error?: string}>}
 */
async function reverseGeocodeGoogle(latitude, longitude) {
    try {
        if (!GOOGLE_MAPS_API_KEY) {
            console.warn('[Geocoding] Google Maps API key not configured, using fallback');
            return { success: false, error: 'API key not configured' };
        }

        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}&result_type=street_address|premise|subpremise|route|neighborhood&language=en`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`[Geocoding] Google Maps API HTTP error: ${response.status}`);
            return { success: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json();

        if (data.status !== 'OK' || !data.results || data.results.length === 0) {
            console.warn(`[Geocoding] Google Maps API returned: ${data.status}`);
            return { success: false, error: data.status || 'No results' };
        }

        const result = data.results[0];
        const addressComponents = result.address_components || [];

        // Extract detailed address components
        const getComponent = (types) => {
            for (const type of types) {
                const component = addressComponents.find(c => c.types.includes(type));
                if (component) return component.long_name;
            }
            return '';
        };

        // Extract precise components with Google's detailed breakdown
        const streetNumber = getComponent(['street_number']);
        const route = getComponent(['route', 'street_address']);
        const sublocality1 = getComponent(['sublocality_level_1', 'sublocality']);
        const sublocality2 = getComponent(['sublocality_level_2']);
        const sublocality3 = getComponent(['sublocality_level_3']);
        const neighborhood = getComponent(['neighborhood']);
        const locality = getComponent(['locality', 'postal_town']);
        const city = getComponent(['locality', 'administrative_area_level_2']);
        const state = getComponent(['administrative_area_level_1']);
        const country = getComponent(['country']);
        const pincode = getComponent(['postal_code']);
        const premise = getComponent(['premise']); // Building name
        const subpremise = getComponent(['subpremise']); // Floor/Unit/Apt

        // Build comprehensive address
        const addressParts = [];

        // Start with most specific (building/house details)
        if (subpremise) addressParts.push(subpremise); // e.g., "Flat 302"
        if (premise) addressParts.push(premise); // e.g., "ABC Apartments"
        if (streetNumber) addressParts.push(streetNumber); // e.g., "123"
        if (route) addressParts.push(route); // e.g., "MG Road"

        // Add area/locality details
        if (neighborhood && !addressParts.includes(neighborhood)) addressParts.push(neighborhood);
        if (sublocality3 && !addressParts.includes(sublocality3)) addressParts.push(sublocality3);
        if (sublocality2 && !addressParts.includes(sublocality2)) addressParts.push(sublocality2);
        if (sublocality1 && !addressParts.includes(sublocality1)) addressParts.push(sublocality1);

        // Add city/state/country
        if (locality && !addressParts.includes(locality)) addressParts.push(locality);
        if (city && city !== locality && !addressParts.includes(city)) addressParts.push(city);
        if (state && !addressParts.includes(state)) addressParts.push(state);
        if (pincode) addressParts.push(pincode);
        if (country) addressParts.push(country);

        let formattedAddress = addressParts.filter(Boolean).join(', ');

        // Fallback to Google's formatted address if our construction is too short
        if (addressParts.length < 3 && result.formatted_address) {
            formattedAddress = result.formatted_address;
        }

        console.log(`✅ [Geocoding] Google Maps resolved: ${formattedAddress}`);

        return {
            success: true,
            address: formattedAddress,
            details: {
                fullAddress: result.formatted_address || formattedAddress,
                houseNumber: streetNumber,
                building: premise,
                unit: subpremise,
                road: route,
                neighborhood: neighborhood,
                sublocality: sublocality1,
                locality: locality,
                city: city || locality,
                state: state,
                country: country,
                pincode: pincode,
                placeId: result.place_id,
                locationType: result.geometry?.location_type,
                source: 'google_maps',
                raw: addressComponents
            }
        };
    } catch (error) {
        console.error('[Geocoding] Google Maps error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Reverse geocode using OpenStreetMap Nominatim (Fallback method)
 * 
 * @param {number} latitude - GPS latitude
 * @param {number} longitude - GPS longitude
 * @returns {Promise<{success: boolean, address: string, details: object|null, error?: string}>}
 */
async function reverseGeocodeNominatim(latitude, longitude) {
    try {
        const url = `${NOMINATIM_BASE_URL}/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1&zoom=18`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Talio-HRMS/1.0 (contact@talio.in)',
                'Accept-Language': 'en'
            }
        });

        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json();

        if (data.error) {
            return { success: false, error: data.error };
        }

        // Extract address components (existing Nominatim logic)
        const addr = data.address || {};
        const addressParts = [];

        const houseNumber = addr.house_number || '';
        if (houseNumber) addressParts.push(houseNumber);

        const building = addr.building || addr.amenity || addr.shop || addr.office || '';
        if (building) addressParts.push(building);

        const road = addr.road || addr.street || addr.path || addr.footway || '';
        if (road) addressParts.push(road);

        const neighbourhood = addr.neighbourhood || addr.quarter || addr.residential || '';
        if (neighbourhood && !addressParts.includes(neighbourhood)) addressParts.push(neighbourhood);

        const suburb = addr.suburb || addr.sublocality || '';
        if (suburb && !addressParts.includes(suburb)) addressParts.push(suburb);

        const locality = addr.hamlet || addr.village || addr.town || addr.city_district || '';
        if (locality && !addressParts.includes(locality)) addressParts.push(locality);

        const city = addr.city || addr.municipality || addr.town || '';
        if (city && !addressParts.includes(city)) addressParts.push(city);

        const state = addr.state || addr.region || addr.province || '';
        if (state && !addressParts.includes(state)) addressParts.push(state);

        const country = addr.country || '';
        if (country) addressParts.push(country);

        const pincode = addr.postcode || addr.postal_code || '';

        let formattedAddress = addressParts.filter(Boolean).join(', ');
        if (pincode) formattedAddress += ` - ${pincode}`;

        if (addressParts.length < 3 && data.display_name) {
            formattedAddress = data.display_name;
        }

        console.log(`✅ [Geocoding] OpenStreetMap (fallback) resolved: ${formattedAddress}`);

        return {
            success: true,
            address: formattedAddress,
            details: {
                fullAddress: data.display_name || formattedAddress,
                houseNumber: houseNumber,
                building: building,
                road: road,
                neighbourhood: neighbourhood,
                city: city,
                state: state,
                country: country,
                pincode: pincode,
                source: 'openstreetmap',
                raw: addr
            }
        };
    } catch (error) {
        console.error('[Geocoding] OpenStreetMap error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Reverse geocode coordinates to a human-readable address
 * Uses Google Maps API (primary) with OpenStreetMap fallback
 * 
 * @param {number} latitude - GPS latitude
 * @param {number} longitude - GPS longitude
 * @returns {Promise<{success: boolean, address: string, details: object|null, error?: string}>}
 */
export async function reverseGeocode(latitude, longitude) {
    try {
        // Validate inputs
        if (!latitude || !longitude) {
            return {
                success: false,
                address: 'Location not available',
                details: null,
                error: 'Invalid coordinates'
            };
        }

        // Validate coordinate ranges
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return {
                success: false,
                address: 'Invalid coordinates',
                details: null,
                error: 'Coordinates out of valid range'
            };
        }

        // Try Google Maps first (more accurate, detailed)
        console.log(`[Geocoding] Attempting Google Maps reverse geocode: ${latitude}, ${longitude}`);
        const googleResult = await reverseGeocodeGoogle(latitude, longitude);

        if (googleResult.success) {
            return googleResult;
        }

        // Fallback to OpenStreetMap if Google fails
        console.log(`[Geocoding] Google Maps failed, falling back to OpenStreetMap`);
        const nominatimResult = await reverseGeocodeNominatim(latitude, longitude);

        if (nominatimResult.success) {
            return nominatimResult;
        }

        // Both failed - return coordinates
        console.warn('[Geocoding] All geocoding services failed');
        return {
            success: false,
            address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            details: {
                fullAddress: `Coordinates: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
                city: '',
                state: '',
                country: '',
                pincode: '',
                source: 'coordinates_only'
            },
            error: 'Geocoding services unavailable'
        };

    } catch (error) {
        console.error('[Geocoding] Reverse geocoding error:', error);
        return {
            success: false,
            address: latitude && longitude ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : 'Unavailable',
            details: null,
            error: error.message
        };
    }
}

/**
 * Format an address for display, making it more concise
 * 
 * @param {string} fullAddress - Full address string
 * @param {number} maxLength - Maximum length (default 60)
 * @returns {string} - Formatted address
 */
export function formatAddressForDisplay(fullAddress, maxLength = 60) {
    if (!fullAddress) return 'Location not captured';

    // If it's just coordinates, return as-is
    if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(fullAddress.trim())) {
        return fullAddress;
    }

    // Truncate if too long
    if (fullAddress.length > maxLength) {
        return fullAddress.substring(0, maxLength - 3) + '...';
    }

    return fullAddress;
}

/**
 * Check if a string looks like coordinates (not a resolved address)
 * 
 * @param {string} address - Address string to check
 * @returns {boolean}
 */
export function isCoordinatesOnly(address) {
    if (!address) return true;

    // Match patterns like "12.345678, 78.901234" or "12.345678,78.901234"
    const coordPattern = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/;
    return coordPattern.test(address.trim());
}

/**
 * Validate location data object
 * 
 * @param {object} location - Location object with latitude, longitude
 * @returns {{valid: boolean, message?: string}}
 */
export function validateLocationData(location) {
    if (!location) {
        return { valid: false, message: 'Location data is required' };
    }

    const { latitude, longitude } = location;

    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
        return { valid: false, message: 'Latitude and longitude are required' };
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return { valid: false, message: 'Latitude and longitude must be numbers' };
    }

    if (isNaN(latitude) || isNaN(longitude)) {
        return { valid: false, message: 'Invalid coordinate values' };
    }

    if (latitude < -90 || latitude > 90) {
        return { valid: false, message: 'Latitude must be between -90 and 90' };
    }

    if (longitude < -180 || longitude > 180) {
        return { valid: false, message: 'Longitude must be between -180 and 180' };
    }

    return { valid: true };
}

export default {
    reverseGeocode,
    formatAddressForDisplay,
    isCoordinatesOnly,
    validateLocationData
};
