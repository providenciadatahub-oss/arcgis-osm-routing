const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// --- UTILIDADES DE CONVERSIÓN ---
function toMetros(lon, lat) {
    const x = lon * 20037508.34 / 180;
    let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    y = y * 20037508.34 / 180;
    return [x, y];
}

function toLatLon(x, y) {
    const lon = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return { lon, lat };
}

// --- METADATOS DEL SERVICIO ---
const metadata = {
    currentVersion: 10.81,
    serviceDescription: "OSRM Proxy para ArcGIS",
    layerName: "Route_World",
    layerType: "esriNAServerRouteLayer",
    capabilities: "Route,NetworkAnalysis",
    supportedTravelModes: [{
        "id": "FEgifRtFndKNcJMJ",
        "name": "Driving Time",
        "type": "AUTOMOBILE",
        "impedanceAttributeName": "TravelTime",
        "timeAttributeName": "TravelTime",
        "distanceAttributeName": "Kilometers"
    }],
    defaultTravelMode: "FEgifRtFndKNcJMJ",
    spatialReference: { wkid: 102100, latestWkid: 3857 }
};

app.get('/arcgis/rest/info', (req, res) => res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } }));
app.get(['/arcgis/rest/services/World/Route/NAServer', '/arcgis/rest/services/World/Route/NAServer/Route_World'], (req, res) => res.json(metadata));
app.get('*/retrieveTravelModes', (req, res) => res.json({ supportedTravelModes: metadata.supportedTravelModes, defaultTravelMode: "FEgifRtFndKNcJMJ" }));

// --- EL MOTOR SOLVE ---
app.all('*/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops;
    if (!stopsParam) return res.json({ routes: { features: [] } });

    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        
        // 1. Traducir paradas a Lat/Lon para OSRM
        let coordsArr = stopsJson.features.map(f => {
            const p = toLatLon(f.geometry.x, f.geometry.y);
            return `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
        });
        const osrmStops = coordsArr.join(';');

        // 2. Pedir ruta a OSRM con instrucciones (steps=true)
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${osrmStops}?overview=full&geometries=geojson&steps=true&languages=es`;
        const response = await axios.get(osrmUrl);
        const route = response.data.routes[0];

        // 3. Convertir geometría de la ruta a Metros (Web Mercator)
        const webMercatorPaths = route.geometry.coordinates.map(pt => toMetros(pt[0], pt[1]));

        const totalMinutes = route.duration / 60;
        const totalKm = route.distance / 1000;

        // 4. Construir respuesta idéntica al JSON que enviaste
        res.json({
            messages: [],
            directions: [{
                routeId: 1,
                routeName: "Ruta OSRM",
                summary: {
                    totalLength: totalKm,
                    totalTime: totalMinutes,
                    totalDriveTime: totalMinutes,
                    spatialReference: { wkid: 102100 }
                },
                features: route.legs[0].steps.map(step => ({
                    attributes: {
                        length: step.distance / 1000,
                        time: step.duration / 60,
                        text: step.maneuver.instruction,
                        maneuverType: "esriDMTStraight"
                    }
                }))
            }],
            routes: {
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 102100, latestWkid: 3857 },
                features: [{
                    attributes: {
                        ObjectID: 1,
                        Name: "Ruta OSRM",
                        Total_TravelTime: totalMinutes,
                        Total_Kilometers: totalKm,
                        Shape_Length: route.distance
                    },
                    geometry: {
                        paths: [webMercatorPaths]
                    }
                }]
            }
        });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: { code: 400, message: "Error calculando ruta", details: [e.message] } });
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy Clonado de ArcGIS activo en puerto ${port}`));
