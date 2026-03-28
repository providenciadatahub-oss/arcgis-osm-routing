const express = require('express');
const cors = require('cors');
const app = express();

// 1. Configuración de CORS Total
app.use(cors({ origin: '*' }));
app.use(express.json());

// 2. Encabezados obligatorios para ArcGIS
app.use((req, res, next) => {
    res.header("Content-Type", "application/json; charset=utf-8");
    res.header("Access-Control-Allow-Origin", "*");
    next();
});

// --- VARIABLES DE CONFIGURACIÓN ---
const travelModes = {
    supportedTravelModes: [{
        "id": "FEgifRtFndKNcJMJ",
        "name": "Driving Time",
        "type": "AUTOMOBILE",
        "impedanceAttributeName": "TravelTime",
        "timeAttributeName": "TravelTime",
        "distanceAttributeName": "Kilometers"
    }],
    defaultTravelMode: "FEgifRtFndKNcJMJ"
};

const serviceMetadata = {
    currentVersion: 10.81,
    serviceDescription: "OSRM Network Service",
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer", // ESTO ES LO QUE BUSCA EL WIDGET
    capabilities: "Route,NetworkAnalysis",
    ...travelModes,
    spatialReference: { wkid: 102100, latestWkid: 3857 }
};

// --- ENDPOINTS DE VALIDACIÓN ---

// Info General
app.get('/arcgis/rest/info', (req, res) => {
    res.json({ currentVersion: 10.81, fullVersion: "10.8.1", authInfo: { isTokenBasedSecurity: false } });
});

// Metadatos del NAServer (Responde a todas las rutas posibles)
app.get([
    '/arcgis/rest/services/World/Route/NAServer',
    '/arcgis/rest/services/World/Route/NAServer/',
    '/arcgis/rest/services/World/Route/NAServer/Route_World',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/'
], (req, res) => {
    res.json(serviceMetadata);
});

// El validador de modos de viaje que el widget consulta por separado
app.get([
    '/arcgis/rest/services/World/Route/NAServer/retrieveTravelModes',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes'
], (req, res) => {
    res.json(travelModes);
});

// --- MOTOR DE CÁLCULO (SOLVE) ---
app.all('*/solve', async (req, res) => {
    // Aquí devolvemos una estructura mínima válida para que el widget no falle al conectar
    res.json({
        routes: {
            geometryType: "esriGeometryPolyline",
            spatialReference: { wkid: 102100 },
            features: []
        },
        messages: []
    });
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy ArcGIS en puerto ${port}`));
