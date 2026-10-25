import { CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import { SYLHET_MAP_DEFAULTS } from "../../../shared/sylhet.js";

function LocationClickHandler({ onChange }) {
  useMapEvents({
    click(event) {
      onChange({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

export function LocationMap({ location, onChange, reports = [], interactive = false, height = 280 }) {
  return (
    <MapContainer
      center={SYLHET_MAP_DEFAULTS.center}
      zoom={SYLHET_MAP_DEFAULTS.zoom}
      scrollWheelZoom={false}
      style={{ height, width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {interactive && <LocationClickHandler onChange={onChange} />}
      {location?.latitude != null && location?.longitude != null && (
        <CircleMarker center={[Number(location.latitude), Number(location.longitude)]} radius={9} pathOptions={{ color: "#1456a0", fillColor: "#3b82f6", fillOpacity: 0.8 }} />
      )}
      {reports.map((report) => report.latitude != null && report.longitude != null && (
        <CircleMarker
          key={report.id}
          center={[Number(report.latitude), Number(report.longitude)]}
          radius={report.priority === "safety_hazard" ? 8 : 6}
          pathOptions={{
            color: report.status === "resolved" || report.status === "confirmed_resolved" ? "#13865c" : "#d77b14",
            fillOpacity: 0.78,
          }}
        />
      ))}
    </MapContainer>
  );
}
