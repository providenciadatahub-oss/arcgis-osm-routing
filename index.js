const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// ======================================================================
// TRADUCTOR DE COORDENADAS (Web Mercator a WGS84)
// ======================================================================
function mercatorToLatLon(x, y) {
    const lon = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return { lng: lon.toFixed(6), lat: lat.toFixed(6) };
}

// ======================================================================
// 0. PING DE SEGURIDAD (Obligatorio para Experience Builder)
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
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "Nominatim Proxy para ArcGIS Online",
        addressTypes: ["StreetAddress"],
        capabilities: "Geocode,Suggest",
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

app.get('/arcgis/rest/services/Nominatim/GeocodeServer/suggest', async (req, res) => {
    const text = req.query.text || "";
    if (!text) return res.json({ suggestions: [] });

    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=5`, {
            headers: { 'User-Agent': 'ArcGIS-OSM-Proxy-Integration' }
        });

        const suggestions = response.data.map((item, index) => ({
            text: item.display_name,
            magicKey: `NOM_${index}`,
            isCollection: false
        }));

        res.json({ suggestions });
    } catch (error) {
        res.status(500).json({ error: "Error de red en suggest" });
    }
});

// ======================================================================
// 2. RUTAS (EL CLON PERFECTO DE ESRI NASERVER)
// ======================================================================
const esriTravelModes = [
    {
        "id": "FEgifRtFndKNcJMJ", 
        "name": "Driving Time",
        "description": "Models the movement of cars and other similar small automobiles.",
        "type": "AUTOMOBILE",
        "impedanceAttributeName": "TravelTime",
        "timeAttributeName": "TravelTime",
        "distanceAttributeName": "Kilometers",
        "useHierarchy": true,
        "uTurnPolicy": "ALLOW_DEAD_ENDS_AND_INTERSECTIONS_ONLY",
        "simplificationToleranceUnits": "esriMeters",
        "simplificationTolerance": 10
    },
    {
        "id": "caFAgoThrvUpkFBW", 
        "name": "Walking Time",
        "description": "Follows paths and roads that allow pedestrian traffic.",
        "type": "WALK",
        "impedanceAttributeName": "WalkTime",
        "timeAttributeName": "WalkTime",
        "distanceAttributeName": "Kilometers",
        "useHierarchy": false,
        "uTurnPolicy": "ALLOW_DEAD_ENDS_AND_INTERSECTIONS_ONLY",
        "simplificationToleranceUnits": "esriMeters",
        "simplificationTolerance": 2
    }
];

const esriNetworkAttributes = [
    { "name": "TravelTime", "usageType": "esriNAUTCost", "dataType": "esriNADTDouble", "units": "esriNAUMinutes" },
    { "name": "WalkTime", "usageType": "esriNAUTCost", "dataType": "esriNADTDouble", "units": "esriNAUMinutes" },
    { "name": "Kilometers", "usageType": "esriNAUTCost", "dataType": "esriNADTDouble", "units": "esriNAUKilometers" }
];

const esriMetadata = {
    "currentVersion": 10.81,
    "layerName": "Route_World",
    "layerType": "esriNAServerRouteLayer",
    "routeLayerName": "Route_World",
    "impedance": "TravelTime",
    "distanceUnits": "esriKilometers",
    "restrictUTurns": "esriNFSBAllowBacktrack",
    "outputLineType": "esriNAOutputLineTrueShape",
    "hasZ": false,
    "hasM": false,
    "supportsStartTime": true,
    "timeZoneForTimeWindows": "esriNTSLocal",
    "trafficSupport": "esriNTSLiveAndHistorical",
    "directionsSupported": true,
    "directionsLengthUnits": "esriNAUMiles",
    "directionsTimeAttributeName": "TravelTime",
    "supportedDirectionsLanguages": ["es", "en"],
    "defaultTravelMode": "FEgifRtFndKNcJMJ",
    "supportedTravelModes": esriTravelModes,
    "networkAttributes": esriNetworkAttributes,
    "capabilities": "Route,NetworkAnalysis",
    "spatialReference": { "wkid": 4326, "latestWkid": 4326 }
};

// --- PASAPORTES ---
app.get('/arcgis/rest/services/World/Route/NAServer', (req, res) => {
    let baseMetadata = { ...esriMetadata };
    delete baseMetadata.layerType;
    baseMetadata.routeLayers = ["Route_World"];
    baseMetadata.serviceAreaLayers = [];
    baseMetadata.closestFacilityLayers = [];
    res.json(baseMetadata);
});

app.get('/arcgis/rest/services/World/Route/NAServer/Route_World', (req, res) => {
    res.json(esriMetadata);
});

// --- NUEVO: COMPROBADOR DE MODOS DE VIAJE ---
app.get('/arcgis/rest/services/World/Route/NAServer/retrieveTravelModes', (req, res) => {
    res.json({
        supportedTravelModes: esriTravelModes,
        defaultTravelMode: "FEgifRtFndKNcJMJ"
    });
});

app.get('/arcgis/rest/services/World/Route/NAServer/Route_World/retrieveTravelModes', (req, res) => {
    res.json({
        supportedTravelModes: esriTravelModes,
        defaultTravelMode: "FEgifRtFndKNcJMJ"
    });
});

// --- EL MOTOR /solve ---
app.all('/arcgis/rest/services/World/Route/NAServer/Route_World/solve', async (req, res) => {
    const stopsParam = req.query.stops || req.body.stops; 
    if (!stopsParam) return res.status(400).json({ error: "Missing stops parameter" });

    let osrmStops = "";
    try {
        let stopsJson = typeof stopsParam === 'string' ? JSON.parse(stopsParam) : stopsParam;
        if (stopsJson.features && stopsJson.features.length > 0) {
            
            let coords = stopsJson.features.map(f => {
                let x = parseFloat(f.geometry.x);
                let y = parseFloat(f.geometry.y);
                
                if (Math.abs(x) > 180 || Math.abs(y) > 90) {
                    const converted = mercatorToLatLon(x, y);
                    return `${converted.lng},${converted.lat}`;
                } else {
                    return `${x},${y}`;
                }
            });
            osrmStops = coords.join(';');
            
        } else {
            return res.json({ messages: ["Invalid stops structure"] });
        }
    } catch (e) {
        osrmStops = String(stopsParam).replace(/;/g, '|').replace(/\|/g, ';');
    }

    let modeString = String(req.query.travelMode || req.body.travelMode || "");
    let profile = (modeString.includes("WALK") || modeString.includes("caFAgoThrvUpkFBW")) ? 'foot' : 'driving';

    try {
        const osrmUrl = `http://router.project-osrm.org/route/v1/${profile}/${osrmStops}?overview=full&geometries=geojson&steps=true`;
        const response = await axios.get(osrmUrl);

        if (!response.data.routes || response.data.routes.length === 0) {
            return res.json({ messages: [{ type: 50, description: "No route found." }] });
        }

        const route = response.data.routes[0];
        const minutes = route.duration / 60;
        const kilometers = route.distance / 1000;

        res.json({
            messages: [],
            routes: {
                fieldAliases: { "ObjectID": "ObjectID", "Name": "Name", "TravelTime": "TravelTime", "Kilometers": "Kilometers" },
                geometryType: "esriGeometryPolyline",
                spatialReference: { wkid: 4326, latestWkid: 4326 },
                features: [{ 
                    attributes: { "ObjectID": 1, "Name": "OSRM Route", "TravelTime": minutes, "Kilometers": kilometers }, 
                    geometry: { paths: [route.geometry.coordinates], spatialReference: { wkid: 4326, latestWkid: 4326 } } 
                }]
            },
            directions: [{ 
                routeId: 1, 
                routeName: "OSRM Route", 
                summary: { totalLength: kilometers, totalTime: minutes, totalDriveTime: minutes }, 
                features: [{ 
                    attributes: { text: "Siga la ruta calculada.", length: kilometers, time: minutes, maneuverType: "esriDMTUnknown" },
                    compressedGeometry: ""
                }] 
            }]
        });
    } catch (error) { 
        res.status(500).json({ error: "OSRM Server Error" }); 
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Proxy Total (Nominatim + OSRM Clonado) activo en puerto ${port}`));
