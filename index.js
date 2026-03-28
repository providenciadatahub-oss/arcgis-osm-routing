const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// 1. ENDPOINT DE VALIDACIÓN (Obligatorio para el Widget)
app.get('/arcgis/rest/services/OSM/NAServer/Route', (req, res) => {
    res.json({
        "currentVersion": 10.81,
        "serviceDescription": "OSM Proxy",
        "capabilities": "Route",
        "layerType": "NetworkAnalysisLayer",
        "supportedQueryFormats": "JSON",
        "directionsLanguage": "es",
        "totalFleets": 1,
        "networkDataset": { "name": "OSM_Network" },
        "defaultTravelMode": "driving" // Importante para que no pida configurar modos
    });
});

// 2. ENDPOINT DE MÉTODOS DE VIAJE (Evita el error "utility service not supported")
app.get('/arcgis/rest/services/OSM/NAServer/Route/retrieveTravelModes', (req, res) => {
    res.json({
        "supportedTravelModes": [
            { "id": "driving", "name": "Driving", "type": "AUTOMOBILE", "description": "OSM Car Routing" }
        ],
        "defaultTravelMode": "driving"
    });
});

// 3. EL TRADUCTOR "SOLVE"
app.get('/arcgis/rest/services/OSM/NAServer/Route/solve', async (req, res) => {
    try {
        const stops = req.query.stops;
        if (!stops) return res.status(400).json({ error: "No stops provided" });

        // Llamada a OSRM
        const osrmUrl = `https://router.project-osrm.org{stops}?geometries=geojson&overview=full&steps=true`;
        const response = await axios.get(osrmUrl);
        const route = response.data.routes[0];

        // Respuesta en formato Esri JSON
        res.json({
            "routes": {
                "features": [{
                    "geometry": { "paths": [route.geometry.coordinates] },
                    "attributes": { "Name": "Ruta OSM", "Total_Kilometers": route.distance / 1000 }
                }]
            },
            "directions": [{
                "features": route.legs[0].steps.map(step => ({
                    "attributes": { "text": step.maneuver.instruction, "length": step.distance / 1000 }
                }))
            }]
        });
    } catch (e) {
        res.status(500).json({ error: "OSRM request failed" });
    }
});

app.listen(PORT, () => console.log(`Proxy listo`));
