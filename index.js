const Koop = require('koop') 
const osrm = require('koop-provider-osrm') // <--- Nombre actualizado
const express = require('express')

const koop = new Koop()

// Registramos el proveedor de rutas OSRM
koop.register(osrm) 

const app = express()

// Habilitar CORS para que ArcGIS Online no bloquee la conexión
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Koop servirá las rutas bajo el path /osrm
app.use(koop.server)

const port = process.env.PORT || 8080
app.listen(port, () => console.log(`Proxy de Rutas Providencia Activo`))
