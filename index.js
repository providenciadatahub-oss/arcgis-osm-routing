const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Forzar el formato que ArcGIS espera
app.use((req, res, next) => {
    res.header("Content-Type", "application/json; charset=utf-8");
    next();
});

// --- MOTOR DE BÚSQUEDA (NOMINATIM / GEOCODE) ---
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "Nominatim Engine",
        capabilities: "Geocode,ReverseGeocode,Suggest",
        addressTypes: ["StreetAddress", "POI"],
        spatialReference: { wkid: 102100, latestWkid: 3857 },
        // Campos que Gravois y Esri exigen
        candidateFields: [
            { name: "ResultID", type: "esriFieldTypeInteger" },
            { name: "Match_addr", type: "esriFieldTypeString" },
            { name: "Score", type: "esriFieldTypeDouble" }
        ],
        singleLineAddressField: { name: "SingleLine", type: "esriFieldTypeString", length: 200 }
    });
});

// Endpoint de búsqueda (findAddressCandidates)
app.get('/arcgis/rest/services/Nominatim/GeocodeServer/findAddressCandidates', async (req, res) => {
    const text = req.query.SingleLine || req.query.address || "";
    try {
        const resp = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=5`);
        const candidates = resp.data.map((item, index) => {
            // Conversión manual a Web Mercator (102100) para ArcGIS
            const x = parseFloat(item.lon) * 20037508.34 / 180;
            let y = Math.log(Math.tan((90 + parseFloat(item.lat)) * Math.PI / 360)) / (Math.PI / 180);
            y = y * 20037508.34 / 180;

            return {
                address: item.display_name,
                location: { x, y },
                score: 100,
                attributes: { ResultID: index, Match_addr: item.display_name }
            };
        });
        res.json({ spatialReference: { wkid: 102100 }, candidates });
    } catch (e) { res.json({ candidates: [] }); }
});

// --- MOTOR DE RUTAS (NASERVER) ---
const routeMetadata = {
    currentVersion: 10.81,
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer",
    capabilities: "Route,NetworkAnalysis",
    supportedTravelModes: [{
        "id": "1",
        "name": "Auto OSM",
        "type": "AUTOMOBILE",
        "impedanceAttributeName": "TravelTime"
    }],
    defaultTravelMode: "1",
    spatialReference: { wkid: 102100 }
};

app.get(['/arcgis/rest/services/World/Route/NAServer', '/arcgis/rest/services/World/Route/NAServer/Route_World'], (req, res) => res.json(routeMetadata));

// Endpoint crítico para Experience Builder
app.get('*/retrieveTravelModes', (req, res) => res.json({
    supportedTravelModes: routeMetadata.supportedTravelModes,
    defaultTravelMode: "1"
}));

// El motor que dibuja la ruta
app.all('*/solve', async (req, res) => {
    // Aquí implementamos la lógica de OSRM que ya tienes
    res.json({ routes: { geometryType: "esriGeometryPolyline", features: [] } });
});

app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } }));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Servidor estilo Gravois activo`));
