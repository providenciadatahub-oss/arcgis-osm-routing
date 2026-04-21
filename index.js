const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// --- TRADUCTOR DE COORDENADAS ---
function toLatLon(x, y) {
    if (Math.abs(x) <= 180) return { lon: x, lat: y };
    const lon = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return { lon, lat };
}

// --- METADATOS EXTENDIDOS ---
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
    // Esta sección es vital para el widget de Direcciones
    "layers": [{ "id": 0, "name": "Route", "type": "Network Layer" }] 
};

// --- RUTAS DEL SERVIDOR ---

app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } }));

// Soporte para la URL base y para la capa '0' que el widget busca por defecto
app.get([
    '/arcgis/rest/services/World/Route/NAServer',
    '/arcgis/rest/services/World/Route/NAServer/Route_World',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/0' // <--- IMPORTANTE
], (req, res) => {
    res.json(nasMetadata);
});

// El motor de rutas /solve
app.all('*/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.json({ routes: { features: [] } });

    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        let coords = stopsJson.features.map(f => {
            const p = toLatLon(f.geometry.x, f.geometry.y);
            return `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
        }).join(';');

        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
        const resp = await axios.get(url);
        const route = resp.data.routes[0];

        res.json({
            messages: [],
            routes: {
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 102100 },
                features: [{
                    attributes: { ObjectID: 1, Total_TravelTime: route.duration / 60, Total_Kilometers: route.distance / 1000 },
                    geometry: { paths: [route.geometry.coordinates] }
                }]
            },
            directions: [{
                features: route.legs[0].steps.map(s => ({ attributes: { text: s.maneuver.instruction, length: s.distance / 1000 } }))
            }]
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy OSRM activo en puerto ${port}`));
