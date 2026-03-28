const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- CONFIGURACIÓN DE MODOS DE VIAJE (SEGÚN DOCUMENTACIÓN ESRI) ---
const travelModesData = {
    supportedTravelModes: [{
        "id": "FEgifRtFndKNcJMJ",
        "name": "Auto OSM",
        "type": "AUTOMOBILE",
        "impedanceAttributeName": "TravelTime",
        "timeAttributeName": "TravelTime",
        "distanceAttributeName": "Kilometers",
        "description": "Ruta rápida usando OSRM"
    }],
    defaultTravelMode: "FEgifRtFndKNcJMJ"
};

const commonMetadata = {
    currentVersion: 10.81,
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer",
    capabilities: "Route,NetworkAnalysis",
    ...travelModesData,
    spatialReference: { wkid: 102100, latestWkid: 3857 }
};

// --- ENDPOINTS DE VALIDACIÓN ---
app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } }));

// Metadatos del NAServer (Responde a todas las rutas que pide el widget)
app.get([
    '/arcgis/rest/services/World/Route/NAServer',
    '/arcgis/rest/services/World/Route/NAServer/Route_World',
    '/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes'
], (req, res) => res.json(commonMetadata));

// --- MOTOR DE CÁLCULO (SOLVE) ---
app.all('*/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.json({ routes: { features: [] } });

    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        
        // Traducción de coordenadas (Web Mercator a WGS84 para OSRM)
        let coords = stopsJson.features.map(f => {
            const lon = (f.geometry.x / 20037508.34) * 180;
            let lat = (f.geometry.y / 20037508.34) * 180;
            lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
            return `${lon.toFixed(6)},${lat.toFixed(6)}`;
        }).join(';');

        const response = await axios.get(`http://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
        const route = response.data.routes[0];

        // Devolvemos la geometría convertida de vuelta a METROS para que ArcGIS la dibuje
        const paths = route.geometry.coordinates.map(pt => {
            const x = pt[0] * 20037508.34 / 180;
            let y = Math.log(Math.tan((90 + pt[1]) * Math.PI / 360)) / (Math.PI / 180);
            y = y * 20037508.34 / 180;
            return [x, y];
        });

        res.json({
            routes: {
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 102100 },
                features: [{
                    attributes: { ObjectID: 1, TravelTime: route.duration / 60, Kilometers: route.distance / 1000 },
                    geometry: { paths: [paths] }
                }]
            }
        });
    } catch (e) { res.status(500).json({ error: "Solve Error" }); }
});

// --- MOTOR DE BÚSQUEDA (NOMINATIM) ---
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        capabilities: "Geocode,Suggest",
        addressTypes: ["StreetAddress"],
        singleLineAddressField: { name: "SingleLine", type: "esriFieldTypeString" },
        spatialReference: { wkid: 102100 }
    });
});

app.get('/arcgis/rest/services/Nominatim/GeocodeServer/findAddressCandidates', async (req, res) => {
    const query = req.query.SingleLine || "";
    try {
        const resp = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`);
        const candidates = resp.data.map(item => {
            // Convertimos la respuesta de Nominatim a Metros para el mapa
            const x = parseFloat(item.lon) * 20037508.34 / 180;
            let y = Math.log(Math.tan((90 + parseFloat(item.lat)) * Math.PI / 360)) / (Math.PI / 180);
            y = y * 20037508.34 / 180;
            return {
                address: item.display_name,
                location: { x, y },
                score: 100
            };
        });
        res.json({ spatialReference: { wkid: 102100 }, candidates });
    } catch (e) { res.json({ candidates: [] }); }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy OSRM/Nominatim compatible con Enterprise 11 activo`));
