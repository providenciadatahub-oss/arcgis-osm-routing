const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

// Configuración de CORS total para evitar bloqueos de ArcGIS Online
app.use(cors({ origin: '*' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Forzar encabezado JSON en todas las respuestas
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// --- METADATOS COMPARTIDOS ---
const commonMetadata = {
    currentVersion: 10.81,
    serviceDescription: "OSRM Routing Proxy",
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer", // CRÍTICO: Esto es lo que busca el widget
    capabilities: "Route,NetworkAnalysis",
    supportedTravelModes: [
        {
            "id": "FEgifRtFndKNcJMJ",
            "name": "Driving Time",
            "type": "AUTOMOBILE",
            "impedanceAttributeName": "TravelTime",
            "timeAttributeName": "TravelTime",
            "distanceAttributeName": "Kilometers"
        }
    ],
    defaultTravelMode: "FEgifRtFndKNcJMJ",
    spatialReference: { wkid: 4326, latestWkid: 4326 }
};

// --- ENDPOINTS DE VALIDACIÓN ---

// 1. Info general
app.get('/arcgis/rest/info', (req, res) => {
    res.json({ currentVersion: 10.81, fullVersion: "10.8.1", authInfo: { isTokenBasedSecurity: false } });
});

// 2. Metadatos del NAServer (Cualquier variación de URL)
app.get([
    '/arcgis/rest/services/World/Route/NAServer',
    '/arcgis/rest/services/World/Route/NAServer/Route_World'
], (req, res) => {
    res.json(commonMetadata);
});

// 3. El validador de Modos de Viaje (Lo que causa el error "Not Supported")
app.get([
    '/arcgis/rest/services/World/Route/NAServer/retrieveTravelModes',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes'
], (req, res) => {
    res.json({
        supportedTravelModes: commonMetadata.supportedTravelModes,
        defaultTravelMode: commonMetadata.defaultTravelMode
    });
});

// --- MOTOR DE CÁLCULO /solve ---
app.all('/arcgis/rest/services/World/Route/NAServer/Route_World/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.status(400).json({ error: "No stops provided" });

    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        
        // Traducción de coordenadas rápida (Web Mercator a WGS84)
        let coords = stopsJson.features.map(f => {
            let x = parseFloat(f.geometry.x);
            let y = parseFloat(f.geometry.y);
            if (Math.abs(x) > 180) { // Si es Web Mercator
                const lon = (x / 20037508.34) * 180;
                let lat = (y / 20037508.34) * 180;
                lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
                return `${lon.toFixed(6)},${lat.toFixed(6)}`;
            }
            return `${x},${y}`;
        }).join(';');

        const osrmRes = await axios.get(`http://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
        const route = osrmRes.data.routes[0];

        // Respuesta en formato Esri JSON estricto
        res.json({
            routes: {
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 102100 }, // El widget espera que le devolvamos metros
                features: [{
                    attributes: { ObjectID: 1, TravelTime: route.duration / 60, Kilometers: route.distance / 1000 },
                    geometry: { 
                        // OSRM devuelve [lon, lat], ArcGIS espera [x, y] en metros para dibujar bien
                        paths: [route.geometry.coordinates.map(pt => {
                            const x = pt[0] * 20037508.34 / 180;
                            let y = Math.log(Math.tan((90 + pt[1]) * Math.PI / 360)) / (Math.PI / 180);
                            y = y * 20037508.34 / 180;
                            return [x, y];
                        })]
                    }
                }]
            }
        });
    } catch (e) {
        res.status(500).json({ error: "Error en el cálculo" });
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy listo para ArcGIS en puerto ${port}`));
