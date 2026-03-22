const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// ======================================================================
// 1. GEOCODIFICADOR (Nominatim)
// ======================================================================
app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "Nominatim Proxy Geocoder",
        addressTypes: ["StreetAddress"],
        capabilities: "Geocode",
        spatialReference: { wkid: 4326, latestWkid: 4326 },
        singleLineAddressField: { name: "SingleLine", type: "esriFieldTypeString" },
        candidateFields: [
            { name: "Shape", type: "esriFieldTypeGeometry" },
            { name: "Match_addr", type: "esriFieldTypeString" }
        ]
    });
});

app.get('/arcgis/rest/services/Nominatim/GeocodeServer/findAddressCandidates', async (req, res) => {
    const query = req.query.SingleLine || req.query.address || "";
    if (!query) return res.json({ spatialReference: { wkid: 4326 }, candidates: [] });
    try {
        const response = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`);
        const candidates = response.data.map(item => ({
            address: item.display_name,
            location: { x: parseFloat(item.lon), y: parseFloat(item.lat) },
            score: 100,
            attributes: { Match_addr: item.display_name }
        }));
        res.json({ spatialReference: { wkid: 4326 }, candidates });
    } catch (error) {
        res.status(500).json({ error: "Error de red" });
    }
});

// ======================================================================
// 2. RUTAS CLON PREMIUM (Rellenando la UI del Widget)
// ======================================================================

const networkAttributesExactos = [
    { name: "TravelTime", usageType: "esriNAUTCost", dataType: "esriNADTDouble", units: "esriNAUMinutes" },
    { name: "Kilometers", usageType: "esriNAUTCost", dataType: "esriNADTDouble", units: "esriNAUKilometers" }
];

// AQUÍ ESTÁ LA MAGIA PARA RELLENAR TU PRIMERA FOTO:
const travelModesExactos = [
    { id: "1", name: "Tiempo de conducción", type: "AUTOMOBILE", impedanceAttributeName: "TravelTime", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" },
    { id: "2", name: "Distancia de conducción", type: "AUTOMOBILE", impedanceAttributeName: "Kilometers", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" },
    { id: "3", name: "Tiempo en camión", type: "TRUCK", impedanceAttributeName: "TravelTime", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" },
    { id: "4", name: "Distancia en camión", type: "TRUCK", impedanceAttributeName: "Kilometers", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" },
    { id: "5", name: "Tiempo a pie", type: "WALK", impedanceAttributeName: "TravelTime", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" },
    { id: "6", name: "Distancia a pie", type: "WALK", impedanceAttributeName: "Kilometers", timeAttributeName: "TravelTime", distanceAttributeName: "Kilometers" }
];

// AQUÍ ESTÁ LA MAGIA PARA RELLENAR TU SEGUNDA FOTO (supportsStartTime):
const configuracionRuta = {
    currentVersion: 10.81,
    layerName: "Route",
    layerType: "esriNAServerRouteLayer", 
    routeLayerName: "Route",
    impedance: "TravelTime",
    distanceUnits: "esriKilometers",
    restrictUTurns: "esriNFSBAllowBacktrack",
    outputLineType: "esriNAOutputLineTrueShape",
    supportsStartTime: true,               // <-- ACTIVA EL MENÚ "HORA DE SALIDA"
    timeZoneForTimeWindows: "esriNTSLocal", // <-- EVITA QUE CHOQUE EL HUSO HORARIO
    trafficSupport: "esriNTSNone",          
    defaultTravelMode: "Tiempo de conducción",
    supportedTravelModes: travelModesExactos, // <-- RELLENA EL MENÚ "MODOS DE VIAJE"
    networkAttributes: networkAttributesExactos,
    directionsSupported: true,                  
    supportedDirectionsLanguages: ["es", "en"], 
    capabilities: "Route,NetworkAnalysis",
    spatialReference: { wkid: 4326, latestWkid: 4326 }
};

// Pasaporte Raíz (NAServer)
app.get('/arcgis/rest/services/OSRM/NAServer', (req, res) => {
    res.json({
        ...configuracionRuta,
        routeLayers: ["Route"],
        serviceAreaLayers: [],      
        closestFacilityLayers: [] 
    });
});

// Pasaporte de la Capa (Route)
app.get('/arcgis/rest/services/OSRM/NAServer/Route', (req, res) => {
    res.json(configuracionRuta);
});

// Motor de Cálculo (/solve)
app.get('/arcgis/rest/services/OSRM/NAServer/Route/solve', async (req, res) => {
    const stops = req.query.stops; 
    if (!stops) return res.status(400).json({ error: "Faltan paradas" });

    // Verificamos qué eligió el usuario en el menú desplegable
    let modeString = String(req.query.travelMode || "");
    let profile = 'driving'; // Por defecto Auto o Camión
    if (modeString.includes("5") || modeString.includes("6") || modeString.includes("pie") || modeString.includes("WALK")) {
        profile = 'foot'; // Cambia a Peatón si elige "A pie"
    }

    try {
        const cleanStops = stops.replace(/;/g, '|'); 
        const osrmUrl = `http://router.project-osrm.org/route/v1/${profile}/${cleanStops}?overview=full&geometries=geojson`;
        const response = await axios.get(osrmUrl);

        if (!response.data.routes || response.data.routes.length === 0) {
            return res.json({ messages: ["No se encontró ruta"] });
        }

        const route = response.data.routes[0];
        const minutes = route.duration / 60;
        const kilometers = route.distance / 1000;

        res.json({
            messages: [],
            routes: {
                spatialReference: { wkid: 4326, latestWkid: 4326 },
                features: [{
                    attributes: {
                        Name: "Ruta OSRM",
                        TravelTime: minutes,
                        Total_TravelTime: minutes,
                        Kilometers: kilometers,
                        Total_Kilometers: kilometers
                    },
                    geometry: {
                        paths: [route.geometry.coordinates], 
                        spatialReference: { wkid: 4326, latestWkid: 4326 }
                    }
                }]
            },
            directions: [{
                routeId: 1,
                routeName: "Ruta",
                summary: { totalLength: kilometers, totalTime: minutes, totalDriveTime: minutes },
                features: [{ attributes: { text: "Siga la ruta trazada en el mapa.", length: kilometers, time: minutes, maneuverType: "esriDMTUnknown" } }]
            }]
        });
    } catch (error) {
        res.status(500).json({ error: "Error en Routing" });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Proxy (Geocodificador + UI de Rutas) activo`));
