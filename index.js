// Importamos el módulo Graphic de la API de ArcGIS
// En Experience Builder (React), esto suele venir de 'esri/Graphic'
import Graphic from "esri/Graphic";

async function dibujarRutaOSM(puntoA, puntoB, view) {
    // 1. Llamamos a tu proxy en Render
    const proxyUrl = "https://tu-servicio-en-render.onrender.com/route";
    const coords = `start=${puntoA.lng},${puntoA.lat}&end=${puntoB.lng},${puntoB.lat}`;
    
    try {
        const respuesta = await fetch(`${proxyUrl}?${coords}`);
        const datos = await respuesta.json();
        
        // Asumimos que el proxy devuelve la geometría GeoJSON de OSRM
        // Extraemos el arreglo de coordenadas: [ [lng, lat], [lng, lat], ... ]
        const coordenadasRuta = datos.routes[0].geometry.coordinates;

        // 2. Construimos la Geometría (Esri Polyline)
        // Ojo aquí: Esri requiere que las coordenadas estén dentro de un arreglo de "paths"
        const polyline = {
            type: "polyline",
            paths: [coordenadasRuta], 
            spatialReference: { wkid: 4326 } // Sistema de coordenadas estándar GPS
        };

        // 3. Definimos el Símbolo (Estilo visual)
        const lineSymbol = {
            type: "simple-line",
            color: [34, 110, 227, 0.8], // Azul (R, G, B, Transparencia)
            width: 4 // Grosor de la línea
        };

        // 4. Creamos el Gráfico uniendo la geometría y el símbolo
        const routeGraphic = new Graphic({
            geometry: polyline,
            symbol: lineSymbol
        });

        // 5. Limpiamos rutas anteriores y añadimos la nueva al mapa
        view.graphics.removeAll(); 
        view.graphics.add(routeGraphic);
        
        // Opcional: Hacer zoom automático a la ruta dibujada
        view.goTo(routeGraphic.geometry.extent);

    } catch (error) {
        console.error("Error al trazar la ruta desde el proxy:", error);
    }
}
