# Street View + Three.js Example

This example overlays Three.js 3D objects on top of Google Street View.

## API Flow

```
User enters address (e.g., "Paris")
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  1. GEOCODING (Address → Coordinates)               │
│                                                     │
│  street.js calls YOUR PROXY:                        │
│  https://replicateproxy-tc5vweqxmq-uc.a.run.app    │
│  /api/addressToLatLon?address=Paris                 │
│                                                     │
│  The proxy calls Google Geocoding API server-side   │
│  and returns: {lat: 48.857, lng: 2.351}            │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  2. STREET VIEW DISPLAY                             │
│                                                     │
│  street.html loads Google Maps JavaScript API       │
│  directly in the browser with YOUR API KEY:         │
│                                                     │
│  <script src="https://maps.googleapis.com/maps/    │
│    api/js?key=YOUR_KEY_HERE">                       │
│                                                     │
│  street.js then creates a StreetViewPanorama        │
│  at the coordinates from step 1                     │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  3. THREE.JS OVERLAY                                │
│                                                     │
│  Three.js renders on a transparent canvas           │
│  positioned on top of the Street View               │
│  - Drop images onto the scene                       │
│  - Type text to add 3D text                         │
│  - Drag to rotate camera                            │
└─────────────────────────────────────────────────────┘
```

## Setup Requirements

### Google Cloud Console (console.cloud.google.com)

1. **Create/Select a Project**

2. **Enable APIs** (APIs & Services → Library):
   - Maps JavaScript API (required for Street View display)
   
3. **Create API Key** (APIs & Services → Credentials):
   - Click "Create Credentials" → "API Key"
   - Copy the key
   
4. **Configure Key** (click on the key to edit):
   - Application restrictions: "None" for development, or add your domains
   - API restrictions: "Don't restrict key" or select "Maps JavaScript API"

5. **Enable Billing** (required for Maps APIs to work)

### Update the Code

Put your API key in `street.html`:
```html
<script async defer
    src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY_HERE">
</script>
```

## Files

- `street.html` - HTML structure, loads Google Maps API with your key
- `street.js` - All the logic:
  - Geocoding via proxy (address → lat/lng)
  - Street View panorama creation
  - Three.js scene setup
  - Mouse/keyboard controls
  - Drag-and-drop image handling

## Why Two Different API Approaches?

1. **Geocoding uses a proxy** because:
   - Avoids CORS issues
   - Keeps API key hidden server-side
   - Your proxy already handles this

2. **Street View loads directly** because:
   - Google Maps JavaScript API must run in browser
   - The API key is exposed (that's normal for client-side maps)
   - Restrict the key by domain in production for security

## Troubleshooting

**"Oops! Something went wrong"**
- API key not valid or restricted
- Maps JavaScript API not enabled
- Billing not enabled on project

**"ApiTargetBlockedMapError"**
- API key is restricted to certain domains
- Remove restrictions or add localhost for development

**Geocoding fails but Street View works**
- Check the proxy URL is correct
- Proxy might be down
