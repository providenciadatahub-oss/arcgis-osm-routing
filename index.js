const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors()); // Permite que ArcGIS Online lea tu servidor
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Endpoint base para que el widget de ArcGIS valide el servicio
app.get('/arcgis/rest/services/OSM/NAServer/Route', (req, res) => {
    res.json({
        "currentVersion": 10.81,
        "serviceDescription": "Proxy OSM para ArcGIS",
        "capabilities": "Route",
        "layerType": "NetworkAnalysisLayer",
        "supportedQueryFormats": "JSON",
        "maxRecordCount": 1000
    });
});

// El traductor de la operación "solve"
app.get('/arcgis/rest/services/OSM/NAServer/Route/solve', async (req, res) => {
    try {
        const stops = req.query.stops; // Formato: "-3.7,40.4;-3.6,40.4"
        if (!stops) return res.status(400).json({ error: "No se enviaron paradas (stops)" });

        // 1. Llamar a OSRM (Gratis)
        const osrmUrl = `https://router.project-osrm.org{stops}?geometries=geojson&overview=full&steps=true`;
        const response = await axios.get(osrmUrl);
        
        if (!response.data.routes || response.data.routes.length === 0) {
            return res.json({ "error": { "code": 400, "message": "No se encontró ruta" } });
        }

        const route = response.data.routes[0];

        // 2. TRADUCCIÓN al formato NAServer
        // ArcGIS espera [ [lon, lat], [lon, lat] ] en 'paths'
        const arcgisResponse = {
            "routes": {
                "features": [{
                    "geometry": {
                        "paths": [route.geometry.coordinates]
                    },
                    "attributes": {
                        "Name": "Ruta Libre OSM",
                        "Total_Minutes": route.duration / 60,
                        "Total_Kilometers": route.distance / 1000
                    }
                }]
            },
            "directions": [{
                "features": route.legs[0].steps.map(step => ({
                    "attributes": {
                        "text": step.maneuver.instruction,
                        "length": step.distance / 1000,
                        "time": step.duration / 60
                    }
                }))
            }]
        };

        res.json(arcgisResponse);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error interno del proxy" });
    }
});

app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
