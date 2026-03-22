const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

// ======================================================================
// 1. GEOCODER (Nominatim)
// ======================================================================

app.get('/arcgis/rest/services/Nominatim/GeocodeServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "Nominatim Proxy",
        addressTypes: ["StreetAddress"],
        capabilities: "Geocode",
        spatialReference: { wkid: 4326 },
        singleLineAddressField: {
            name: "SingleLine",
            type: "esriFieldTypeString",
            alias: "Single Line Input"
        }
    });
});

app.get('/arcgis/rest/services/Nominatim/GeocodeServer/findAddressCandidates', async (req, res) => {
    const query = req.query.SingleLine || "";
    if (!query) return res.json({ spatialReference: { wkid: 4326 }, candidates: [] });

    try {
        const response = await axios.get(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
            { headers: { 'User-Agent': 'ArcGIS-Proxy' } }
        );

        const candidates = response.data.map(item => ({
            address: item.display_name,
            location: { x: parseFloat(item.lon), y: parseFloat(item.lat) },
            score: 100,
            attributes: { Match_addr: item.display_name }
        }));

        res.json({ spatialReference: { wkid: 4326 }, candidates });

    } catch {
        res.status(500).json({ error: "Error geocoding" });
    }
});

// ======================================================================
// 2. CONFIGURACIÓN ROUTING
// ======================================================================

const travelMode = {
    id: "1",
    name: "Driving Time",
    type: "AUTOMOBILE",
    description: "Driving Time",
    impedanceAttributeName: "TravelTime",
    timeAttributeName: "TravelTime",
    distanceAttributeName: "Kilometers"
};

const networkAttributes = [
    {
        name: "TravelTime",
        usageType: "esriNAUTCost",
        dataType: "esriNADTDouble",
        units: "esriNAUMinutes"
    },
    {
        name: "Kilometers",
        usageType: "esriNAUTCost",
        dataType: "esriNADTDouble",
        units: "esriNAUKilometers"
    }
];

// ======================================================================
// 2.1 ROOT NASERVER
// ======================================================================

app.get('/arcgis/rest/services/OSRM/NAServer', (req, res) => {
    res.json({
        currentVersion: 10.81,
        serviceDescription: "OSRM Routing Proxy",

        routeLayers: ["Route"],
        serviceAreaLayers: [],
        closestFacilityLayers: [],

        defaultTravelMode: "Driving Time",
        supportedTravelModes: [travelMode],

        networkAttributes: networkAttributes,

        // 🔥 CAMPOS CRÍTICOS
        supportedOperations: ["Route"],
        capabilities: "Route,NetworkAnalysis",

        spatialReference: { wkid: 4326 }
    });
});

// ======================================================================
// 2.2 ROUTE LAYER (ULTRA COMPLETO)
// ======================================================================

app.get('/arcgis/rest/services/OSRM/NAServer/Route', (req, res) => {
    res.json({
        currentVersion: 10.81,

        layerName: "Route",
        layerType: "esriNAServerRouteLayer",
        routeLayerName: "Route",
        networkDatasetName: "Routing_ND",

        defaultTravelMode: "Driving Time",
        supportedTravelModes: [travelMode],
        networkAttributes: networkAttributes,

        // 🔥 VALIDACIÓN INTERNA
        supportedOperations: ["solve"],
        capabilities: "Route",

        directionsSupported: true,
        directionsOutputType: "esriDOTComplete",
        supportedDirectionsLanguages: ["en", "es"],

        outputLines: "esriNAOutputLineTrueShape",
        findBestSequence: false,
        preserveFirstStop: true,
        preserveLastStop: true,
        useTimeWindows: false,

        // 🔥 MUCHOS WIDGETS LO PIDEN
        stopTypes: ["esriNAStop"],
        restrictionAttributes: [],
        accumulateAttributes: ["Kilometers"],

        // 🔥 FORMATOS ESPERADOS
        impedanceAttributeName: "TravelTime",

        spatialReference: { wkid: 4326 }
    });
});

// ======================================================================
// 2.3 SOLVE
// ======================================================================

app.get('/arcgis/rest/services/OSRM/NAServer/Route/solve', async (req, res) => {

    const stops = req.query.stops;
    if (!stops) return res.status(400).json({ error: "Missing stops" });

    try {
        const cleanStops = stops.replace(/;/g, '|');

        const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${cleanStops}?overview=full&geometries=geojson&steps=true`;
        const response = await axios.get(osrmUrl);

        const route = response.data.routes[0];

        const minutes = route.duration / 60;
        const kilometers = route.distance / 1000;

        // 🔥 GEOMETRÍA CORRECTA
        const path = route.geometry.coordinates.map(c => [c[0], c[1]]);

        // 🔥 DIRECTIONS DESDE OSRM
        const steps = route.legs[0].steps;

        const directionFeatures = steps.map(step => ({
            attributes: {
                text: step.maneuver.instruction || "Continue",
                length: step.distance / 1000,
                time: step.duration / 60,
                maneuverType: "esriDMTForward"
            }
        }));

        res.json({
            messages: [],

            routes: {
                spatialReference: { wkid: 4326 },
                features: [
                    {
                        attributes: {
                            Name: "Ruta OSRM",
                            TravelTime: minutes,
                            Total_TravelTime: minutes,
                            Kilometers: kilometers,
                            Total_Kilometers: kilometers
                        },
                        geometry: {
                            paths: [path],
                            spatialReference: { wkid: 4326 }
                        }
                    }
                ]
            },

            directions: {
                routeId: 1,
                routeName: "Ruta OSRM",
                summary: {
                    totalLength: kilometers,
                    totalTime: minutes,
                    totalDriveTime: minutes
                },
                features: directionFeatures
            }
        });

    } catch (err) {
        res.status(500).json({ error: "Routing error" });
    }
});

// ======================================================================
// SERVER
// ======================================================================

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`ArcGIS Routing Proxy FULL activo en puerto ${port}`);
});
