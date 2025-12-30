# 📍 Google Maps Geolocation Setup Guide

## Overview
This guide explains how to set up Google Maps-based precise geolocation for check-in/check-out functionality in the Talio HRMS application.

## ✅ What's Been Implemented

### 1. **Backend Changes**
- ✅ Updated `/lib/geocoding.js` with Google Maps Geocoding API integration
- ✅ Primary method: Google Maps API (most accurate)
- ✅ Fallback method: OpenStreetMap Nominatim (free backup)
- ✅ Enhanced address component extraction (building, unit, road, area, city, state, pincode, country)

### 2. **Database Storage**
The `Attendance` model already stores:
```javascript
location: {
  checkIn: {
    latitude: Number,
    longitude: Number,
    address: String,
    addressDetails: {
      city: String,
      state: String,
      country: String,
      pincode: String,
      fullAddress: String,
      houseNumber: String,      // NEW
      building: String,          // NEW
      unit: String,              // NEW
      road: String,              // NEW
      neighborhood: String,      // NEW
      source: String            // 'google_maps' or 'openstreetmap'
    },
    capturedAt: Date,
    accuracy: Number
  },
  checkOut: { /* same structure */ }
}
```

### 3. **API Integration**
- Backend API route (`/api/attendance`) already uses `reverseGeocode()` function
- Automatic geocoding on check-in/check-out
- Server-side processing (API key stays secure)

---

## 🔑 Step-by-Step: Get Google Maps API Key

### **Step 1: Create Google Cloud Project**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Click **"Select a Project"** (top bar) → **"New Project"**
4. Enter Project Name: `Talio-HRMS` (or your choice)
5. Click **"Create"**

### **Step 2: Enable Required APIs**

1. In the Google Cloud Console, go to **"APIs & Services"** → **"Library"**
2. Search and enable these APIs (click each and press **"Enable"**):
   - ✅ **Geocoding API** (REQUIRED - converts coordinates to address)
   - ⚠️ **Geolocation API** (OPTIONAL - for fallback location detection)
   - ⚠️ **Maps JavaScript API** (OPTIONAL - for future map display in UI)

### **Step 3: Create API Credentials**

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"+ CREATE CREDENTIALS"** → **"API key"**
3. Copy the generated API key (save it temporarily)
4. **Create TWO keys**:
   - **Key 1**: Backend Server Key (for reverse geocoding)
   - **Key 2**: Frontend Key (optional, for client-side features)

### **Step 4: Secure Your Backend API Key**

1. Click on the **backend key** name
2. Under **"API restrictions"**:
   - Select **"Restrict key"**
   - Check **"Geocoding API"** only
3. Under **"Application restrictions"**:
   - Select **"IP addresses"** (recommended for production)
   - Add your server's public IP address
   - For testing: Leave unrestricted or add `0.0.0.0/0` (⚠️ temporary only)
4. Click **"Save"**

### **Step 5: Secure Your Frontend API Key** (Optional)

1. Click on the **frontend key** name
2. Under **"API restrictions"**:
   - Select **"Restrict key"**
   - Check: **"Geolocation API"**, **"Maps JavaScript API"**
3. Under **"Application restrictions"**:
   - Select **"HTTP referrers (web sites)"**
   - Add: `*.yourdomain.com/*`
   - Add: `localhost/*` (for local testing)
4. Click **"Save"**

### **Step 6: Enable Billing**

⚠️ **IMPORTANT**: Google Maps APIs require a billing account (even for free tier)

1. Go to **"Billing"** in Google Cloud Console
2. Click **"Link a billing account"**
3. Follow steps to add a credit/debit card
4. **Don't worry about costs:**
   - Google provides **$200 free monthly credit**
   - Typical HRMS usage: ~6,000 requests/month (2 check-ins/day × 100 employees × 30 days)
   - Well within free tier (up to 40,000 requests/month free with $200 credit)

---

## 🔧 Environment Variables Setup

### **Add to `.env` file**

```bash
# Google Maps API Keys
GOOGLE_MAPS_API_KEY_BACKEND=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  # Backend server key (REQUIRED)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyYYYYYYYYYYYYYYYYYYYYYYYYYYYY  # Frontend key (OPTIONAL)
```

### **Where to Put Your Keys:**

1. Open your project's `.env` file
2. Add the lines above
3. Replace `AIzaSyXXXX...` with your actual API keys from Step 3
4. **Backend Key**: Used by server for reverse geocoding (check-in/check-out)
5. **Frontend Key**: Used by client-side features (future map displays)

### **Security Best Practices:**

✅ **DO:**
- Keep API keys in `.env` file (never commit to Git)
- Add `.env` to `.gitignore`
- Use environment variables in production (Vercel/Railway secrets)
- Restrict backend key to server IP
- Restrict frontend key to your domain

❌ **DON'T:**
- Hardcode API keys in source code
- Commit `.env` to version control
- Share API keys publicly
- Use unrestricted keys in production

---

## 🧪 Testing the Implementation

### **1. Test Check-In with Location**

```bash
# Make a check-in request
curl -X POST http://localhost:3000/api/attendance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "EMPLOYEE_ID",
    "type": "clock-in",
    "latitude": 28.6139,
    "longitude": 77.2090,
    "accuracy": 10
  }'
```

### **2. Check Server Logs**

You should see:
```
[Geocoding] Attempting Google Maps reverse geocode: 28.6139, 77.2090
✅ [Geocoding] Google Maps resolved: Connaught Place, New Delhi, Delhi 110001, India
```

### **3. Verify in Database**

```javascript
// Check attendance record
db.attendances.findOne({ employee: employeeId, date: todayDate })

// Should contain:
{
  location: {
    checkIn: {
      latitude: 28.6139,
      longitude: 77.2090,
      address: "Connaught Place, New Delhi, Delhi 110001, India",
      addressDetails: {
        fullAddress: "Connaught Place, New Delhi, Delhi 110001, India",
        road: "Connaught Place",
        city: "New Delhi",
        state: "Delhi",
        pincode: "110001",
        country: "India",
        source: "google_maps"
      }
    }
  }
}
```

---

## 🌍 How It Works

### **Check-In Flow:**
1. User clicks "Check In" button (web/desktop/mobile)
2. Browser/app captures GPS coordinates (latitude, longitude)
3. Coordinates sent to `/api/attendance` endpoint
4. Backend calls `reverseGeocode(lat, lng)` function
5. Google Maps Geocoding API converts coordinates to address
6. Detailed address components extracted and stored in database
7. Fallback to OpenStreetMap if Google fails

### **Example Address Resolution:**

**Input:** `28.6139, 77.2090`

**Google Maps Output:**
```json
{
  "success": true,
  "address": "Flat 302, ABC Apartments, 123 MG Road, Connaught Place, New Delhi, Delhi 110001, India",
  "details": {
    "fullAddress": "Flat 302, ABC Apartments, 123 MG Road, Connaught Place, New Delhi, Delhi 110001, India",
    "unit": "Flat 302",
    "building": "ABC Apartments",
    "houseNumber": "123",
    "road": "MG Road",
    "neighborhood": "Connaught Place",
    "city": "New Delhi",
    "state": "Delhi",
    "pincode": "110001",
    "country": "India",
    "source": "google_maps"
  }
}
```

---

## 📊 Cost Estimation

### **Google Maps Pricing:**
- **Geocoding API**: $5 per 1,000 requests (after free tier)
- **Free Tier**: $200/month credit = 40,000 requests/month FREE

### **Typical HRMS Usage:**
- Employees: 100
- Check-ins per day: 2 per employee (check-in + check-out)
- Working days: 22 days/month
- **Total requests/month**: 100 × 2 × 22 = **4,400 requests**

### **Monthly Cost:**
- Requests: 4,400
- Cost: **$0** (well within free $200 credit)
- Even with 500 employees: 22,000 requests = **$0** (still within free tier)

---

## 🔍 Troubleshooting

### **Problem: "API key not configured" in logs**
**Solution:** Add `GOOGLE_MAPS_API_KEY_BACKEND` to `.env` file and restart server

### **Problem: "Google Maps API returned: REQUEST_DENIED"**
**Solution:** 
1. Check if Geocoding API is enabled in Google Cloud Console
2. Verify API key restrictions aren't too strict
3. Check billing is enabled

### **Problem: Getting only coordinates, not addresses**
**Solution:**
1. Check server logs for Google Maps errors
2. System will automatically fall back to OpenStreetMap
3. Verify internet connection on server

### **Problem: "OVER_QUERY_LIMIT" error**
**Solution:**
1. Check Google Cloud Console billing/quotas
2. System will fall back to OpenStreetMap
3. Consider caching geocoded results

---

## 🎯 Next Steps (Optional Enhancements)

1. **Map Display in UI**
   - Show check-in/check-out locations on Google Maps
   - Add Maps JavaScript API integration to frontend

2. **Location Verification**
   - Compare check-in location with office geofence
   - Alert for suspicious locations

3. **Analytics Dashboard**
   - Heatmap of employee check-in locations
   - Identify remote workers

4. **Mobile App Integration**
   - Already works! Same API endpoints used across web/desktop/mobile

---

## ✅ Verification Checklist

- [ ] Google Cloud Project created
- [ ] Geocoding API enabled
- [ ] Backend API key created and secured
- [ ] Billing account linked (with credit card)
- [ ] `GOOGLE_MAPS_API_KEY_BACKEND` added to `.env`
- [ ] Server restarted after adding env variable
- [ ] Test check-in shows detailed address in logs
- [ ] Database stores full address details
- [ ] Fallback to OpenStreetMap works if Google fails

---

## 📞 Support

If you encounter issues:
1. Check server logs for detailed error messages
2. Verify Google Cloud Console settings
3. Test with sample coordinates: `28.6139, 77.2090` (Connaught Place, Delhi)
4. System includes automatic fallback to OpenStreetMap

---

## 🔐 Security Notes

- Backend API key is server-side only (never exposed to client)
- All geocoding happens on server to protect API key
- Rate limiting built into Google Maps API
- Automatic fallback prevents service outages
- Location data encrypted in transit (HTTPS)

---

**Implementation completed by:** AI Assistant  
**Date:** December 30, 2025  
**Version:** 1.0
