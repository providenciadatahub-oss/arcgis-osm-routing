const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// 1. EL "PASAPORTE" PARA ARCGIS (Root NAServer)
// Esto es lo que ArcGIS revisa cuando intentas agregar el elemento por URL
app.get('/osrm/rest/services/OSRM/NAServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "OSRM Routing Service",
        routeLayers: ["Route"],
        capabilities: "Route"
    });
});

// 2. LA CAPA DE RUTA (Route Layer)
app.get('/osrm/rest/services/OSRM/NAServer/Route', (req, res) => {
    res.json({
        currentVersion: 10.81,
        layerName: "Route",
        defaultTravelMode: "Driving",
        capabilities: "Route",
        networkDatasetName: "Routing_ND"
    });
});

// 3. EL MOTOR DE CÁLCULO (Solve) - El que hace el trabajo gratis
app.get('/osrm/rest/services/OSRM/NAServer/Route/solve', async (req, res) => {
    const stops = req.query.stops; 
    if (!stops) return res.status(400).json({ error: "Faltan paradas (stops)" });

    try {
        // ArcGIS manda las paradas con un formato extraño a veces, las limpiamos:
        const cleanStops = stops.replace(/;/g, '|'); // Por si manda punto y coma
        
        const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${stops}?overview=full&geometries=geojson`;
        const response = await axios.get(osrmUrl);

        if (!response.data.routes || response.data.routes.length === 0) {
            return res.json({ messages: ["No se encontró ruta"] });
        }

        const route = response.data.routes[0];

        // Traducimos a formato ArcGIS
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
app.listen(port, () => console.log(`Proxy OSRM con Pasaporte ArcGIS activo en puerto ${port}`));
