const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*' })); // Permiso total

// Respuesta rápida para que ArcGIS sepa que estamos vivos
app.get('/arcgis/rest/info', (req, res) => {
    res.json({ currentVersion: 10.81, authInfo: { isTokenBasedSecurity: false } });
});

// Metadatos que el widget de rutas NECESITA para no decir "Incompatible"
app.get(['/arcgis/rest/services/World/Route/NAServer', '/arcgis/rest/services/World/Route/NAServer/Route_World'], (req, res) => {
    res.json({
        currentVersion: 10.81,
        layerType: "esriNAServerRouteLayer",
        capabilities: "Route",
        supportedTravelModes: [{ "id": "1", "name": "Coche" }],
        defaultTravelMode: "1",
        spatialReference: { wkid: 102100 }
    });
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Servidor de prueba activo"));
