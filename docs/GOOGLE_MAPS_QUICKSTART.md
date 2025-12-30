# 🔑 Google Maps API - Quick Setup Reference

## 1. Get API Key (5 minutes)

### Google Cloud Console
1. Go to: https://console.cloud.google.com/
2. Create new project: **"Talio-HRMS"**
3. Enable APIs:
   - **Geocoding API** ✅ (REQUIRED)
   - Geolocation API (optional)
   - Maps JavaScript API (optional)

### Create Credentials
4. Go to: **APIs & Services** → **Credentials**
5. Click: **+ CREATE CREDENTIALS** → **API key**
6. Copy the key: `AIzaSy...`

### Secure the Key
7. Click on key name to edit
8. **Application restrictions**:
   - Production: Select **"IP addresses"**, add your server IP
   - Development: Leave unrestricted (temporary)
9. **API restrictions**:
   - Select: **"Restrict key"**
   - Check: **"Geocoding API"** only
10. Click **Save**

### Enable Billing
11. Go to: **Billing** → **Link a billing account**
12. Add credit/debit card
13. **Don't worry**: $200/month free credit covers ~40,000 requests
14. Typical usage: 4,400 requests/month = **$0 cost**

---

## 2. Add to Your Project (1 minute)

### Edit `.env` file:
```bash
# Add this line
GOOGLE_MAPS_API_KEY_BACKEND=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Restart server:
```bash
npm run dev
```

---

## 3. Test It (30 seconds)

### Run test script:
```bash
node scripts/test-google-maps-geocoding.js
```

### Expected output:
```
✅ Success!
Source: google_maps
Address: Connaught Place, New Delhi, Delhi 110001, India
Details:
  - Road: Connaught Place
  - City: New Delhi
  - State: Delhi
  - Pincode: 110001
  - Country: India
```

---

## ✅ Verification Checklist

- [ ] Google Cloud project created
- [ ] Geocoding API enabled
- [ ] API key created
- [ ] API key secured (IP/API restrictions)
- [ ] Billing account linked (credit card added)
- [ ] `GOOGLE_MAPS_API_KEY_BACKEND` in `.env`
- [ ] Server restarted
- [ ] Test script shows `✅ Success!`
- [ ] Test script shows `Source: google_maps`

---

## 🚨 Troubleshooting

### "API key not configured"
➡️ Add `GOOGLE_MAPS_API_KEY_BACKEND` to `.env` and restart server

### "REQUEST_DENIED"
➡️ Check: 1) Geocoding API enabled, 2) Billing enabled, 3) Key restrictions

### "OVER_QUERY_LIMIT"
➡️ Check quotas in Google Cloud Console → Fallback to OpenStreetMap active

### Shows "openstreetmap" instead of "google_maps"
➡️ Google Maps failed, check API key and restrictions

---

## 📞 Quick Links

- **Google Cloud Console**: https://console.cloud.google.com/
- **Enable Geocoding API**: https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com
- **Manage Credentials**: https://console.cloud.google.com/apis/credentials
- **Billing**: https://console.cloud.google.com/billing
- **Full Setup Guide**: See `docs/GOOGLE_MAPS_SETUP.md`

---

**Setup Time**: ~5-10 minutes  
**Cost**: $0 (within free $200/month credit)  
**Result**: Enterprise-grade location accuracy 🎯
