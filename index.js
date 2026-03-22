const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// ======================================================================
// 1. SECCIÓN DE GEOCODIFICACIÓN (Buscador de Direcciones con Nominatim)
// ======================================================================

// Pasaporte del Geocodificador
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "Nominatim Proxy Geocoder",
        addressTypes: ["StreetAddress"],
        capabilities: "Geocode",
        spatialReference: { wkid: 4326, latestWkid: 4326 },
        singleLineAddressField: { 
            name: "SingleLine", type: "esriFieldTypeString", alias: "Single Line Input" 
        },
        candidateFields: [
            { name: "Shape", type: "esriFieldTypeGeometry", alias: "Shape" },
            { name: "Match_addr", type: "esriFieldTypeString", alias: "Match_addr" }
        ]
    });
});

// Motor de búsqueda
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
        res.status(500).json({ error: "Error de red en Geocode" });
    }
});

// ======================================================================
// 2. SECCIÓN DE RUTAS (Network Analysis con OSRM)
// ======================================================================

// Pasaporte Raíz de Rutas
app.get('/osrm/rest/services/OSRM/NAServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "OSRM Routing Service",
        routeLayers: ["Route"],
        capabilities: "Route"
    });
});

// Pasaporte de la Capa de Ruta
app.get('/osrm/rest/services/OSRM/NAServer/Route', (req, res) => {
    res.json({
        currentVersion: 10.81,
        layerName: "Route",
        defaultTravelMode: "Driving",
        capabilities: "Route",
        networkDatasetName: "Routing_ND"
    });
});

// Motor de Cálculo de Rutas
app.get('/osrm/rest/services/OSRM/NAServer/Route/solve', async (req, res) => {
    const stops = req.query.stops; 
    if (!stops) return res.status(400).json({ error: "Faltan paradas (stops)" });

    try {
        const cleanStops = stops.replace(/;/g, '|'); 
        const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${cleanStops}?overview=full&geometries=geojson`;
        const response = await axios.get(osrmUrl);

        if (!response.data.routes || response.data.routes.length === 0) {
            return res.json({ messages: ["No se encontró ruta"] });
        }

        const route = response.data.routes[0];

        res.json({
            messages: [],
            routes: {
                features: [{
                    attributes: {
                        Name: "Ruta OSRM",
                        Total_Minutes: route.duration / 60,
                        Total_Kilometers: route.distance / 1000
                    },
                    geometry: {
                        paths: [route.geometry.coordinates], 
                        spatialReference: { wkid: 4326 }
                    }
                }],
                spatialReference: { wkid: 4326 }
            }
        });
    } catch (error) {
        res.status(500).json({ error: "Error de red en Routing" });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Proxy Total (Geocodificador + Rutas) activo en puerto ${port}`));
