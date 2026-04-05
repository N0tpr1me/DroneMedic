// Google Maps style configurations for dark/satellite/light map layers

export const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1b2024' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8d90a0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1418' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#434654' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#8d90a0' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c3c6d6' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8d90a0' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#171c20' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#4ade80' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#30353a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#262b2f' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8d90a0' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#434654' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#30353a' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#262b2f' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#c3c6d6' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1418' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#434654' }] },
];

export const LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9c9c9' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
];

export interface MapConfig {
  name: string;
  mapTypeId: string;
  styles: google.maps.MapTypeStyle[];
}

export const MAP_CONFIGS: MapConfig[] = [
  { name: 'Dark', mapTypeId: 'roadmap', styles: DARK_STYLE },
  { name: 'Satellite', mapTypeId: 'hybrid', styles: [] },
  { name: 'Light', mapTypeId: 'roadmap', styles: LIGHT_STYLE },
];
