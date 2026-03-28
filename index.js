const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Este servidor SOLO devuelve texto (JSON), no dibuja nada.
app.get('/route', async (req, res) => {
    const { start, end } = req.query; 
    try {
        const url = `http://router.project-osrm.org/route/v1/driving/${start};${end}?geometries=geojson`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Error al calcular la ruta' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
