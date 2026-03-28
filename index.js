const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Forzar JSON y registrar qué puerta están tocando
app.use((req, res, next) => {
    console.log(`PETICIÓN RECIBIDA: ${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

const commonMetadata = {
    currentVersion: 10.81,
    serviceDescription: "OSRM Routing Proxy",
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer",
    capabilities: "Route,NetworkAnalysis",
    supportedTravelModes: [{
        "id": "FEgifRtFndKNcJMJ",
        "name": "Driving Time",
        "type": "AUTOMOBILE",
        "impedanceAttributeName": "TravelTime",
        "timeAttributeName": "TravelTime",
        "distanceAttributeName": "Kilometers"
    }],
    defaultTravelMode: "FEgifRtFndKNcJMJ",
    spatialReference: { wkid: 102100, latestWkid: 3857 }
};

// Ruta raíz para que el dominio no dé error 404
app.get('/', (req, res) => res.json({ message: "Servidor Proxy ArcGIS-OSM Activo" }));

app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, fullVersion: "10.8.1", authInfo: { isTokenBasedSecurity: false } }));

// ATENCIÓN: Agregamos todas las variantes de URL posibles
app.get([
    '/arcgis/rest/services/World/Route/NAServer',
    '/arcgis/rest/services/World/Route/NAServer/',
    '/arcgis/rest/services/World/Route/NAServer/Route_World',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/'
], (req, res) => res.json(commonMetadata));

app.get([
    '/arcgis/rest/services/World/Route/NAServer/retrieveTravelModes',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes'
], (req, res) => res.json({
    supportedTravelModes: commonMetadata.supportedTravelModes,
    defaultTravelMode: commonMetadata.defaultTravelMode
}));

// Motor /solve (Simplificado para estabilidad)
app.all('/arcgis/rest/services/World/Route/NAServer/Route_World/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.status(400).json({ error: "No stops" });
    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        let coords = stopsJson.features.map(f => `${f.geometry.x},${f.geometry.y}`).join(';');
        // (Aquí iría la lógica de conversión que ya tenemos, la omito por brevedad pero mantenla)
        res.json({ routes: { features: [] } }); // Respuesta vacía de prueba
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy Total en puerto ${port}`));
