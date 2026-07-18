'use client';

import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Custom CSS for pulsing glowing marker point
const markerStyle = `
  .pulsing-bus-node {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pulse-core {
    width: 14px;
    height: 14px;
    background-color: #a855f7;
    border: 2.5px solid #ffffff;
    border-radius: 50%;
    box-shadow: 0 0 12px 6px rgba(168, 85, 247, 0.6);
  }
  .pulse-halo {
    position: absolute;
    width: 32px;
    height: 32px;
    border: 2px solid #a855f7;
    border-radius: 50%;
    opacity: 0;
    animation: ripple 2s infinite ease-out;
  }
  @keyframes ripple {
    0% {
      transform: scale(0.4);
      opacity: 0.8;
    }
    100% {
      transform: scale(1.6);
      opacity: 0;
    }
  }
`;

const routeCoordinates: [number, number][] = [
  [18.922, 72.834],
  [18.924, 72.833],
  [18.927, 72.831],
  [18.930, 72.830],
  [18.933, 72.831],
  [18.937, 72.832],
  [18.940, 72.835],
  [18.942, 72.838],
  [18.943, 72.842],
  [18.941, 72.846],
  [18.938, 72.849],
  [18.935, 72.851],
  [18.932, 72.851],
  [18.929, 72.849],
  [18.927, 72.845],
  [18.925, 72.841],
  [18.922, 72.838],
  [18.922, 72.834]
];

export function LoginMapAnimation() {
  const mapContainerId = 'login-animation-map';

  useEffect(() => {
    // 1. Initialize map
    const map = L.map(mapContainerId, {
      center: [18.932, 72.822],
      zoom: 14,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: false
    });

    // 2. Add Dark Matter Tile Layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20
    }).addTo(map);

    // 3. Add Polyline Route
    L.polyline(routeCoordinates, {
      color: '#a855f7',
      weight: 4,
      opacity: 0.7,
      dashArray: '8, 12',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // 4. Custom Pulsing Marker
    const customIcon = L.divIcon({
      className: 'pulsing-bus-node',
      html: `
        <div class="pulse-halo"></div>
        <div class="pulse-core"></div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const marker = L.marker(routeCoordinates[0], { icon: customIcon }).addTo(map);

    // 5. Animate marker along coordinates
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % routeCoordinates.length;
      marker.setLatLng(routeCoordinates[index]);
    }, 1500);

    return () => {
      clearInterval(interval);
      map.remove();
    };
  }, []);

  return (
    <div className="w-full h-full relative">
      <style dangerouslySetInnerHTML={{ __html: markerStyle }} />
      <div id={mapContainerId} className="w-full h-full" />
      {/* Technical Grid Overlay */}
      <div 
        className="absolute inset-0 z-10 pointer-events-none opacity-[0.06]" 
        style={{
          backgroundImage: `
            linear-gradient(to right, #ffffff 1px, transparent 1px),
            linear-gradient(to bottom, #ffffff 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px'
        }}
      />
    </div>
  );
}

export default LoginMapAnimation;
