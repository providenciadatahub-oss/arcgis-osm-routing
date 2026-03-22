const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// ======================================================================
// 0. EL PING DE SEGURIDAD PARA EXPERIENCE BUILDER
// ======================================================================
app.get('/arcgis/rest/info', (req, res) => {
    res.json({
        currentVersion: 10.81,
        fullVersion: "10.8.1",
        owningSystemUrl: "https://arcgis-osm-proxy.onrender.com",
        authInfo: { 
            isTokenBasedSecurity: false,
            tokenServicesUrl: ""
        }
    });
});

// ======================================================================
// 1. GEOCODIFICADOR (Nominatim)
// ======================================================================
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81, serviceDescription: "Nominatim Proxy Geocoder",
        addressTypes: ["StreetAddress"], capabilities: "Geocode",
        spatialReference: { wkid: 4326, latestWkid: 4326 },
        singleLineAddressField: { name: "SingleLine", type: "esriFieldTypeString" },
        candidateFields: [ { name: "Shape", type: "esriFieldTypeGeometry" }, { name: "Match_addr", type: "esriFieldTypeString" } ]
    });
});

app.get('/arcgis/rest/services/Nominatim/GeocodeServer/findAddressCandidates', async (req, res) => {
    const query = req.query.SingleLine || req.query.address || "";
    if (!query) return res.json({ spatialReference: { wkid: 4326 }, candidates: [] });
    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`);
        const candidates = response.data.map(item => ({
            address: item.display_name, location: { x: parseFloat(item.lon), y: parseFloat(item.lat) },
            score: 100, attributes: { Match_addr: item.display_name }
        }));
        res.json({ spatialReference: { wkid: 4326 }, candidates });
    } catch (error) { res.status(500).json({ error: "Error de red" }); }
});

// ======================================================================
// 2. RUTAS: DISFRAZ DE "WORLD ROUTING SERVICE"
// ======================================================================
const networkAttributesExactos = [
    { name: "TravelTime", usageType: "esriNAUTCost", dataType: "esriNADTDouble", units: "esriNAUMinutes" },
    { name: "Kilometers", usageType: "esriNAUTCost", dataType: "esriNADTDouble", units: "esriNAUKilometers" }
];
const travelModesExactos = [
    { id: "1", name: "Tiempo de conducción", type: "AUTOMOBILE", impedanceAttributeName: "TravelTime", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" },
    { id: "5", name: "Tiempo a pie", type: "WALK", impedanceAttributeName: "TravelTime", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" }
];

const configuracionRuta = {
    currentVersion: 10.81, layerName: "Route_World", layerType: "esriNAServerRouteLayer", routeLayerName: "Route_World",
    impedance: "TravelTime", distanceUnits: "esriKilometers", restrictUTurns: "esriNFSBAllowBacktrack",
    outputLineType: "esriNAOutputLineTrueShape", supportsStartTime: true, timeZoneForTimeWindows: "esriNTSLocal", 
    trafficSupport: "esriNTSNone", defaultTravelMode: "Tiempo de conducción",
    supportedTravelModes: travelModesExactos, networkAttributes: networkAttributesExactos,
    directionsSupported: true, supportedDirectionsLanguages: ["es", "en"], 
    capabilities: "Route,NetworkAnalysis", spatialReference: { wkid: 4326, latestWkid: 4326 }
};

app.get('/arcgis/rest/services/World/Route/NAServer', (req, res) => res.json({ ...configuracionRuta, routeLayers: ["Route_World"], serviceAreaLayers: [], closestFacilityLayers: [] }));
app.get('/arcgis/rest/services/World/Route/NAServer/Route_World', (req, res) => res.json(configuracionRuta));

app.all('/arcgis/rest/services/World/Route/NAServer/Route_World/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops; 
    if (!stopsParam) return res.status(400).json({ error: "Faltan paradas" });

    let osrmStops = "";
    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        if (stopsJson.features && stopsJson.features.length > 0) {
            let coords = stopsJson.features.map(f => `${f.geometry.x},${f.geometry.y}`);
            osrmStops = coords.join(';');
        }
    } catch (e) {
        osrmStops = String(stopsParam).replace(/;/g, '|').replace(/\|/g, ';');
    }

    if (!osrmStops || !osrmStops.includes(',')) return res.json({ messages: ["Formato de paradas no reconocido"] });

    let modeString = String(req.query.travelMode || req.body.travelMode || "");
    let profile = (modeString.includes("5") || modeString.includes("WALK")) ? 'foot' : 'driving';

    try {
        const osrmUrl = `http://router.project-osrm.org/route/v1/${profile}/${osrmStops}?overview=full&geometries=geojson`;
        const response = await axios.get(osrmUrl);

        if (!response.data.routes || response.data.routes.length === 0) return res.json({ messages: ["No se encontró ruta"] });

        const route = response.data.routes[0];
        const minutes = route.duration / 60;
        const kilometers = route.distance / 1000;

        res.json({
            messages: [],
            routes: {
                spatialReference: { wkid: 4326, latestWkid: 4326 },
                features: [{ attributes: { Name: "Ruta OSRM", TravelTime: minutes, Total_TravelTime: minutes, Kilometers: kilometers, Total_Kilometers: kilometers }, geometry: { paths: [route.geometry.coordinates], spatialReference: { wkid: 4326, latestWkid: 4326 } } }]
            },
            directions: [{ routeId: 1, routeName: "Ruta", summary: { totalLength: kilometers, totalTime: minutes, totalDriveTime: minutes }, features: [{ attributes: { text: "Siga la ruta trazada.", length: kilometers, time: minutes, maneuverType: "esriDMTUnknown" } }] }]
        });
    } catch (error) { res.status(500).json({ error: "Error conectando con OSRM" }); }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Proxy Total Activo en puerto ${port}`));
