const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- TRADUCTOR DE INSTRUCCIONES (Extraído de tu código HTML) ---
function traducirPaso(step) {
    const type = step.maneuver.type;
    const modifier = step.maneuver.modifier || "";
    const street = step.name || "la vía";
    if (type === "depart") return "Inicia el recorrido";
    if (type === "arrive") return "Llegaste al destino";
    if (type === "turn") {
        if (modifier === "left") return `Gira a la izquierda en ${street}`;
        if (modifier === "right") return `Gira a la derecha en ${street}`;
    }
    return `${type} en ${street}`;
}

// --- ENDPOINT DE RUTAS (NASERVER) ---
app.all('*/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.json({ routes: { features: [] } });

    try {
        const stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        
        // Convertimos las paradas (stops) a formato OSRM (lon,lat)
        // Nota: Asumimos que vienen en WGS84 o Web Mercator según el widget
        const coords = stopsJson.features.map(f => {
            // Si las coordenadas son muy grandes, son Web Mercator (Metros)
            if (Math.abs(f.geometry.x) > 180) {
                const lon = (f.geometry.x / 20037508.34) * 180;
                let lat = (f.geometry.y / 20037508.34) * 180;
                lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
                return `${lon.toFixed(6)},${lat.toFixed(6)}`;
            }
            return `${f.geometry.x},${f.geometry.y}`;
        }).join(';');

        // Llamada a OSRM (Igual que en tu HTML)
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
        const resp = await axios.get(url);
        const route = resp.data.routes[0];

        // Construimos la respuesta "Espejo" de ArcGIS
        res.json({
            messages: [],
            directions: [{
                features: route.legs[0].steps.map(step => ({
                    attributes: { text: traducirPaso(step), length: step.distance / 1000 }
                }))
            }],
            routes: {
                geometryType: "esriGeometryPolyline",
                features: [{
                    attributes: { 
                        Total_TravelTime: route.duration / 60, 
                        Total_Kilometers: route.distance / 1000 
                    },
                    geometry: {
                        paths: [route.geometry.coordinates], // OSRM devuelve [lon, lat]
                        spatialReference: { wkid: 4326 }
                    }
                }]
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Metadatos mínimos para que el widget no falle
app.get(['*/NAServer', '*/NAServer/Route_World'], (req, res) => {
    res.json({
        currentVersion: 10.81,
        layerType: "esriNAServerRouteLayer",
        capabilities: "Route",
        supportedTravelModes: [{ id: "1", name: "Ruta OSRM" }],
        defaultTravelMode: "1",
        spatialReference: { wkid: 4326 }
    });
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy OSRM Híbrido activo`));
