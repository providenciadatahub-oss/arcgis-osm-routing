const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// ======================================================================
// 1. GEOCODIFICADOR (Nominatim)
// ======================================================================
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "Nominatim Proxy Geocoder",
        addressTypes: ["StreetAddress"],
        capabilities: "Geocode",
        spatialReference: { wkid: 4326, latestWkid: 4326 },
        singleLineAddressField: { name: "SingleLine", type: "esriFieldTypeString", alias: "Single Line Input" },
        candidateFields: [
            { name: "Shape", type: "esriFieldTypeGeometry", alias: "Shape" },
            { name: "Match_addr", type: "esriFieldTypeString", alias: "Match_addr" }
        ]
    });
});

app.get('/arcgis/rest/services/Nominatim/GeocodeServer/findAddressCandidates', async (req, res) => {
    const query = req.query.SingleLine || req.query.address || "";
    if (!query) return res.json({ spatialReference: { wkid: 4326 }, candidates: [] });

    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`, {
            headers: { 'User-Agent': 'ArcGIS-DataHub-Proxy' }
        });
        
        const candidates = response.data.map(item => ({
            address: item.display_name,
            location: { x: parseFloat(item.lon), y: parseFloat(item.lat) },
            score: 100,
            attributes: { Match_addr: item.display_name }
        }));
        
        res.json({ spatialReference: { wkid: 4326 }, candidates });
    } catch (error) {
        res.status(500).json({ error: "Error de red" });
    }
});

// ======================================================================
// 2. RUTAS (El Fix Definitivo para "Incompatible")
// ======================================================================

// El objeto "Travel Mode" exacto que exige Experience Builder
const travelModeExacto = {
    "id": "1",
    "name": "Driving Time",
    "description": "Tiempo de conducción OSRM",
    "type": "AUTOMOBILE",
    "impedanceAttributeName": "TravelTime", // <-- CRÍTICO
    "timeAttributeName": "TravelTime",      // <-- CRÍTICO
    "distanceAttributeName": "Kilometers"   // <-- CRÍTICO
};

// Pasaporte Raíz (NAServer)
app.get('/arcgis/rest/services/OSRM/NAServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "OSRM Routing Proxy",
        routeLayers: ["Route"],
        serviceAreaLayers: [],      // <-- CRÍTICO (Evita el cuelgue del widget)
        closestFacilityLayers: [],  // <-- CRÍTICO
        asyncLocationDirLayers: [],
        syncLocationDirLayers: [],
        defaultTravelMode: "Driving Time",
        supportedTravelModes: [travelModeExacto],
        capabilities: "Route,NetworkAnalysis",
        spatialReference: { wkid: 4326, latestWkid: 4326 }
    });
});

// Pasaporte de la Capa (Route)
app.get('/arcgis/rest/services/OSRM/NAServer/Route', (req, res) => {
    res.json({
        currentVersion: 10.81,
        layerName: "Route",
        layerType: "esriNAServerRouteLayer", // <-- ¡EL TIPO EXACTO QUE BUSCA ESRI!
        routeLayerName: "Route",
        networkDatasetName: "Routing_ND",
        defaultTravelMode: "Driving Time",
        supportedTravelModes: [travelModeExacto],
        capabilities: "Route",
        spatialReference: { wkid: 4326, latestWkid: 4326 }
    });
});

// Motor de Cálculo
app.get('/arcgis/rest/services/OSRM/NAServer/Route/solve', async (req, res) => {
    const stops = req.query.stops; 
    if (!stops) return res.status(400).json({ error: "Faltan paradas" });

    try {
        const cleanStops = stops.replace(/;/g, '|'); 
        const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${cleanStops}?overview=full&geometries=geojson`;
        const response = await axios.get(osrmUrl);

        if (!response.data.routes || response.data.routes.length === 0) {
            return res.json({ messages: ["No se encontró ruta"] });
        }

        const route = response.data.routes[0];
        const minutes = route.duration / 60;
        const kilometers = route.distance / 1000;

        res.json({
            messages: [],
            routes: {
                spatialReference: { wkid: 4326, latestWkid: 4326 },
                features: [{
                    attributes: {
                        Name: "Ruta OSRM",
                        // Deben coincidir con los nombres de impedancia
                        TravelTime: minutes,
                        Total_TravelTime: minutes,
                        Kilometers: kilometers,
                        Total_Kilometers: kilometers
                    },
                    geometry: {
                        paths: [route.geometry.coordinates], 
                        spatialReference: { wkid: 4326, latestWkid: 4326 }
                    }
                }]
            }
        });
    } catch (error) {
        res.status(500).json({ error: "Error en Routing" });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Proxy (Geocodificador + Rutas Clon ArcGIS) activo`));
