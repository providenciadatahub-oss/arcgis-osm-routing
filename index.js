const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Middleware para forzar que ArcGIS reciba JSON siempre
app.use((req, res, next) => {
    res.header("Content-Type", "application/json; charset=utf-8");
    next();
});

// Función traductora de coordenadas
function mercatorToLatLon(x, y) {
    const lon = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return { lng: lon.toFixed(6), lat: lat.toFixed(6) };
}

// Datos de los modos de viaje (Centralizados)
const travelModesData = {
    supportedTravelModes: [
        {
            "id": "FEgifRtFndKNcJMJ",
            "name": "Driving Time",
            "type": "AUTOMOBILE",
            "impedanceAttributeName": "TravelTime",
            "timeAttributeName": "TravelTime",
            "distanceAttributeName": "Kilometers"
        },
        {
            "id": "caFAgoThrvUpkFBW",
            "name": "Walking Time",
            "type": "WALK",
            "impedanceAttributeName": "WalkTime",
            "timeAttributeName": "WalkTime",
            "distanceAttributeName": "Kilometers"
        }
    ],
    defaultTravelMode: "FEgifRtFndKNcJMJ"
};

// Endpoints de información
app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, fullVersion: "10.8.1", authInfo: { isTokenBasedSecurity: false } }));

// Endpoints de metadatos del servicio
const serviceMetadata = {
    currentVersion: 10.81,
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer",
    capabilities: "Route,NetworkAnalysis",
    supportedTravelModes: travelModesData.supportedTravelModes,
    defaultTravelMode: travelModesData.defaultTravelMode,
    spatialReference: { wkid: 4326 }
};

app.get(['/arcgis/rest/services/World/Route/NAServer', '/arcgis/rest/services/World/Route/NAServer/Route_World'], (req, res) => {
    res.json(serviceMetadata);
});

// --- EL PUNTO CRÍTICO: RetrieveTravelModes ---
app.get([
    '/arcgis/rest/services/World/Route/NAServer/retrieveTravelModes',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes'
], (req, res) => {
    res.json(travelModesData);
});

// El Motor /solve
app.all('/arcgis/rest/services/World/Route/NAServer/Route_World/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.status(400).json({ error: "Missing stops" });

    let osrmStops = "";
    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        let coords = stopsJson.features.map(f => {
            let x = parseFloat(f.geometry.x);
            let y = parseFloat(f.geometry.y);
            if (Math.abs(x) > 180) {
                const conv = mercatorToLatLon(x, y);
                return `${conv.lng},${conv.lat}`;
            }
            return `${x},${y}`;
        });
        osrmStops = coords.join(';');
    } catch (e) { osrmStops = ""; }

    try {
        const response = await axios.get(`http://router.project-osrm.org/route/v1/driving/${osrmStops}?overview=full&geometries=geojson`);
        const route = response.data.routes[0];
        res.json({
            routes: {
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 4326 },
                features: [{
                    attributes: { ObjectID: 1, TravelTime: route.duration / 60, Kilometers: route.distance / 1000 },
                    geometry: { paths: [route.geometry.coordinates] }
                }]
            }
        });
    } catch (error) { res.status(500).json({ error: "OSRM Error" }); }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Servidor activo en puerto ${port}`));
