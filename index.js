const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Forzar encabezado JSON de ArcGIS
app.use((req, res, next) => {
    res.header("Content-Type", "application/json; charset=utf-8");
    next();
});

// --- DEFINICIÓN DE MODO DE VIAJE (ESTÁNDAR ESRI) ---
const travelModesData = {
    supportedTravelModes: [
        {
            "id": "FEgifRtFndKNcJMJ",
            "name": "Auto (OSM)",
            "type": "AUTOMOBILE",
            "impedanceAttributeName": "TravelTime",
            "timeAttributeName": "TravelTime",
            "distanceAttributeName": "Kilometers",
            "useHierarchy": true,
            "restrictionAttributeNames": [],
            "attributeParameterValues": [],
            "uTurnPolicy": "esriNFSBAllowBacktrack",
            "simplificationTolerance": 10,
            "simplificationToleranceUnits": "esriMeters"
        }
    ],
    defaultTravelMode: "FEgifRtFndKNcJMJ"
};

// Metadatos que el Widget lee para validar compatibilidad
const fullMetadata = {
    currentVersion: 10.81,
    serviceDescription: "Proxy OSRM para ArcGIS Online",
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer",
    capabilities: "Route,NetworkAnalysis",
    ...travelModesData,
    spatialReference: { wkid: 102100, latestWkid: 3857 }
};

// --- ENDPOINTS DE VALIDACIÓN ---

app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } }));

// Respondemos a todas las rutas que el widget suele "escanear"
app.get([
    '/arcgis/rest/services/World/Route/NAServer',
    '/arcgis/rest/services/World/Route/NAServer/Route_World',
    '/arcgis/rest/services/World/Route/NAServer/retrieveTravelModes',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes'
], (req, res) => {
    // Si la URL termina en retrieveTravelModes, mandamos solo los modos
    if (req.url.includes('retrieveTravelModes')) {
        res.json(travelModesData);
    } else {
        res.json(fullMetadata);
    }
});

// --- MOTOR SOLVE (Cálculo de Ruta) ---
app.all('*/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.json({ routes: { features: [] } });

    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        
        // 1. Convertir de Metros (ArcGIS) a Lat/Lon (OSRM)
        let coords = stopsJson.features.map(f => {
            const lon = (f.geometry.x / 20037508.34) * 180;
            let lat = (y / 20037508.34) * 180; // Simplificado para el ejemplo
            lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
            return `${lon.toFixed(6)},${lat.toFixed(6)}`;
        }).join(';');

        // 2. Llamada a OSRM
        const response = await axios.get(`http://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
        const route = response.data.routes[0];

        // 3. Respuesta en formato Esri Polyline
        res.json({
            routes: {
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 102100 },
                features: [{
                    attributes: { ObjectID: 1, TravelTime: route.duration / 60, Kilometers: route.distance / 1000 },
                    geometry: { paths: [route.geometry.coordinates.map(p => [p[0], p[1]])] } // Aquí iría la conversión a metros
                }]
            }
        });
    } catch (e) { res.status(500).json({ error: "Solve error" }); }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy ArcGIS compatible con TravelModes activo`));
