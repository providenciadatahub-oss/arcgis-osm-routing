const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Forzar encabezados de ArcGIS en cada respuesta
app.use((req, res, next) => {
    res.header("Content-Type", "application/json; charset=utf-8");
    res.header("Access-Control-Allow-Origin", "*");
    console.log(`Petición de ArcGIS detectada: ${req.url}`);
    next();
});

// Datos de viaje que el Widget exige ver
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

const metadata = {
    currentVersion: 10.81,
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer",
    capabilities: "Route,NetworkAnalysis",
    ...travelModes,
    spatialReference: { wkid: 102100 }
};

// --- RUTAS DE VALIDACIÓN (Si falta una, el widget falla) ---

app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } }));

// Esta ruta responde a CUALQUIER variante de la URL del NAServer
app.get([
    '/arcgis/rest/services/World/Route/NAServer',
    '/arcgis/rest/services/World/Route/NAServer/',
    '/arcgis/rest/services/World/Route/NAServer/Route_World',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/'
], (req, res) => res.json(metadata));

// Esta ruta responde a la petición secreta del Widget
app.get([
    '/arcgis/rest/services/World/Route/NAServer/retrieveTravelModes',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes'
], (req, res) => res.json(travelModes));

// --- MOTOR SOLVE (Simplificado para la prueba) ---
app.all('*/solve', async (req, res) => {
    res.json({ routes: { features: [] }, messages: [] });
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy ArcGIS en puerto ${port}`));
