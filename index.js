const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Logger para ver qué está pidiendo el widget de la Muni en tiempo real
app.use((req, res, next) => {
    console.log(`Petición recibida: ${req.method} ${req.url}`);
    next();
});

function toLatLon(x, y) {
    if (Math.abs(x) <= 180) return { lon: x, lat: y };
    const lon = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return { lon, lat };
}

const nasMetadata = {
    "currentVersion": 10.81,
    "serviceDescription": "OSRM Proxy Providencia",
    "layerType": "esriNAServerRouteLayer",
    "capabilities": "Route,NetworkAnalysis",
    "supportedTravelModes": [{"id": "1", "name": "Ruta OSRM"}],
    "defaultTravelMode": "1",
    "spatialReference": { "wkid": 102100, "latestWkid": 3857 },
    "directionsSupported": true,
    "supportedParameters": "f,stops,travelMode,returnDirections,returnRoutes,outSR",
    "layers": [{ "id": 0, "name": "Route", "type": "Network Layer" }]
};

// --- ENDPOINTS DE VALIDACIÓN CON WILDCARDS ---
// Esto acepta con o sin slash, y cualquier sub-ruta que el widget invente
app.get([
    '/arcgis/rest/services/World/Route/NAServer*',
    '/arcgis/rest/services/World/Route/NAServer/Route_World*',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/0*'
], (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(nasMetadata);
});

app.get('/arcgis/rest/info*', (req, res) => {
    res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } });
});

app.all('*/solve*', async (req, res) => {
    // Capturamos stops de query o de body (ArcGIS alterna ambos)
    const stopsParam = req.query.stops || req.body.stops;
    
    if (!stopsParam) {
        return res.json({ 
            routes: { features: [], spatialReference: { wkid: 102100 } },
            messages: [{type: "warning", description: "No stops provided"}] 
        });
    }

    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        let coords = stopsJson.features.map(f => {
            const p = toLatLon(f.geometry.x, f.geometry.y);
            return `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
        }).join(';');

        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
        const resp = await axios.get(url);
        const route = resp.data.routes[0];
        const lons = route.geometry.coordinates.map(c => c[0]);
        const lats = route.geometry.coordinates.map(c => c[1]);

        res.setHeader('Content-Type', 'application/json');
        res.json({
            messages: [],
            routes: {
                displayFieldName: "",
                fieldAliases: { ObjectID: "ObjectID", Name: "Name", Total_Minutes: "Total_Minutes", Total_Kilometers: "Total_Kilometers" },
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 102100, latestWkid: 3857 },
                fields: [
                    { name: "ObjectID", type: "esriFieldTypeOID", alias: "ObjectID" },
                    { name: "Name", type: "esriFieldTypeString", alias: "Name", length: 1024 },
                    { name: "Total_Minutes", type: "esriFieldTypeDouble", alias: "Total_Minutes" },
                    { name: "Total_Kilometers", type: "esriFieldTypeDouble", alias: "Total_Kilometers" }
                ],
                features: [{
                    attributes: { ObjectID: 1, Name: "Ruta OSRM", Total_Minutes: route.duration / 60, Total_Kilometers: route.distance / 1000 },
                    geometry: { paths: [route.geometry.coordinates], spatialReference: { wkid: 102100 } }
                }]
            },
            directions: [{
                routeName: "Ruta 1",
                summary: {
                    totalLength: route.distance / 1000,
                    totalTime: route.duration / 60,
                    envelope: { xmin: Math.min(...lons), ymin: Math.min(...lats), xmax: Math.max(...lons), ymax: Math.max(...lats), spatialReference: { wkid: 102100 } }
                },
                features: route.legs[0].steps.map(s => ({
                    attributes: { text: s.maneuver.instruction, length: s.distance / 1000, time: s.duration / 60, maneuverType: "esriDMTUnknown" }
                }))
            }]
        });
    } catch (e) {
        console.error("Error en solve:", e.message);
        res.status(500).json({ error: e.message });
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Servidor en puerto ${port}`));
