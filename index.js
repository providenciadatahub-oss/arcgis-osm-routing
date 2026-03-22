const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// ======================================================================
// 0. PING DE SEGURIDAD (Obligatorio para que Experience Builder no bloquee)
// ======================================================================
app.get('/arcgis/rest/info', (req, res) => {
    res.json({
        currentVersion: 10.81,
        fullVersion: "10.8.1",
        owningSystemUrl: "https://arcgis-osm-routing.onrender.com",
        authInfo: { isTokenBasedSecurity: false, tokenServicesUrl: "" }
    });
});

// ======================================================================
// 1. GEOCODIFICADOR (Nominatim Original + Suggest)
// ======================================================================
// Handshake Nominatim
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "Nominatim Proxy para ArcGIS Online",
        addressTypes: ["StreetAddress"],
        capabilities: "Geocode,Suggest", // <-- Agregamos Suggest aquí
        spatialReference: { wkid: 4326, latestWkid: 4326 },
        locatorProperties: { MaxBatchSize: 100, MaxResultSize: 100 },
        locators: [],
        singleLineAddressField: { name: "SingleLine", type: "esriFieldTypeString", alias: "Single Line Input", required: false, length: 200 },
        candidateFields: [
            { name: "Shape", type: "esriFieldTypeGeometry", alias: "Shape" },
            { name: "Score", type: "esriFieldTypeDouble", alias: "Score" },
            { name: "Match_addr", type: "esriFieldTypeString", alias: "Match_addr" }
        ]
    });
});

// Búsqueda (findAddressCandidates)
app.get('/arcgis/rest/services/Nominatim/GeocodeServer/findAddressCandidates', async (req, res) => {
    const query = req.query.SingleLine || req.query.address || "";
    if (!query) return res.json({ spatialReference: { wkid: 4326 }, candidates: [] });

    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10`, {
            headers: { 'User-Agent': 'ArcGIS-OSM-Proxy-Integration' }
        });
        
        const candidates = response.data.map(item => ({
            address: item.display_name,
            location: { x: parseFloat(item.lon), y: parseFloat(item.lat) },
            score: 100,
            attributes: { Match_addr: item.display_name, Addr_type: "StreetAddress" }
        }));
        
        res.json({ spatialReference: { wkid: 4326, latestWkid: 4326 }, candidates });
    } catch (error) {
        res.status(500).json({ error: "Error de red" });
    }
});

// NUEVO: Autocompletado (suggest) - Esto evita los errores 404 al teclear
app.get('/arcgis/rest/services/Nominatim/GeocodeServer/suggest', async (req, res) => {
    const text = req.query.text || "";
    if (!text) return res.json({ suggestions: [] });

    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=5`, {
            headers: { 'User-Agent': 'ArcGIS-OSM-Proxy-Integration' }
        });

        const suggestions = response.data.map((item, index) => ({
            text: item.display_name,
            magicKey: `NOM_${index}`, // ID requerido por el widget
            isCollection: false
        }));

        res.json({ suggestions });
    } catch (error) {
        res.status(500).json({ error: "Error de red en suggest" });
    }
});

// ======================================================================
// 2. RUTAS (Disfraz de OSRM a Esri Network Analyst)
// ======================================================================
const networkAttributesExactos = [
    { name: "TravelTime", usageType: "esriNAUTCost", dataType: "esriNADTDouble", units: "esriNAUMinutes" },
    { name: "Kilometers", usageType: "esriNAUTCost", dataType: "esriNADTDouble", units: "esriNAUKilometers" }
];
const travelModesExactos = [
    { id: "1", name: "Tiempo de conducción", type: "AUTOMOBILE", impedanceAttributeName: "TravelTime", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" },
    { id: "5", name: "Tiempo a pie", type: "WALK", impedanceAttributeName: "TravelTime", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" }
];

// Pasaporte del Servidor
app.get('/arcgis/rest/services/World/Route/NAServer', (req, res) => {
    res.json({
        currentVersion: 10.81, serviceDescription: "OSRM Routing Service Proxy",
        routeLayers: ["Route_World"], serviceAreaLayers: [], closestFacilityLayers: [],
        syncLocationDirLayers: [], asyncLocationDirLayers: [], defaultTravelMode: "Tiempo de conducción",
        supportedTravelModes: travelModesExactos, networkAttributes: networkAttributesExactos,
        capabilities: "Route,NetworkAnalysis", spatialReference: { wkid: 4326, latestWkid: 4326 }, resultMapServerName: ""
    });
});

// Pasaporte de la Capa
app.get('/arcgis/rest/services/World/Route/NAServer/Route_World', (req, res) => {
    res.json({
        currentVersion: 10.81, layerName: "Route_World", layerType: "esriNAServerRouteLayer", routeLayerName: "Route_World",
        impedance: "TravelTime", distanceUnits: "esriKilometers", restrictUTurns: "esriNFSBAllowBacktrack",
        outputLineType: "esriNAOutputLineTrueShape", hasZ: false, hasM: false,
        supportsStartTime: true, timeZoneForTimeWindows: "esriNTSLocal", trafficSupport: "esriNTSNone",
        defaultTravelMode: "Tiempo de conducción", supportedTravelModes: travelModesExactos,
        networkAttributes: networkAttributesExactos, directionsSupported: true,
        supportedDirectionsLanguages: ["es", "en"], capabilities: "Route,NetworkAnalysis",
        spatialReference: { wkid: 4326, latestWkid: 4326 }
    });
});

// Motor de Cálculo (/solve)
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

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy Total (Nominatim + Suggest + Rutas) activo en puerto ${port}`));
