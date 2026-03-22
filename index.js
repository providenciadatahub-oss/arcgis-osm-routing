const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// 1. Endpoint de "Handshake" (Para que ArcGIS reconozca que es un servidor de rutas)
app.get('/osrm/rest/services/OSRM/NAServer/Route', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceName: "OSRM Route Proxy",
        capabilities: "Route",
        networkDatasetName: "OpenStreetMap Network",
        supportedTravelModes: [{ name: "Driving", id: "1" }]
    });
});

// 2. Endpoint de Cálculo (El que dibuja la línea)
app.get('/osrm/rest/services/OSRM/NAServer/Route/solve', async (req, res) => {
    const stops = req.query.stops; // ArcGIS envía las paradas como "lon,lat;lon,lat"
    if (!stops) return res.status(400).json({ error: "Faltan paradas (stops)" });

    try {
        // Consultamos la API pública y gratuita de OSRM
        const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${stops}?overview=full&geometries=geojson`;
        const response = await axios.get(osrmUrl);

        if (!response.data.routes || response.data.routes.length === 0) {
            return res.json({ messages: ["No se encontró ruta"] });
        }

        const route = response.data.routes[0];

        // Traducimos el GeoJSON al formato "Esri Polyline"
        const arcgisResponse = {
            routes: {
                features: [{
                    geometry: {
                        paths: [route.geometry.coordinates], 
                        spatialReference: { wkid: 4326 }
                    },
                    attributes: {
                        Total_Minutes: route.duration / 60,
                        Total_Kilometers: route.distance / 1000
                    }
                }]
            }
        };

        res.json(arcgisResponse);
    } catch (error) {
        console.error("Error consultando OSRM:", error.message);
        res.status(500).json({ error: "Error de red en Routing" });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Proxy de Rutas OSRM Activo en puerto ${port}`));
