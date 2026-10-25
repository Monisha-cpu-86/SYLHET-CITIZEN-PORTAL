export const SCC_WARDS = Array.from({ length: 27 }, (_, index) => `Ward ${index + 1}`);

export const SYLHET_MAP_DEFAULTS = Object.freeze({
  center: Object.freeze({ lat: 24.8949, lng: 91.8687 }),
  zoom: 13,
});

export const SCC_LOCATION_BOUNDS = Object.freeze({
  minLatitude: 24.85,
  maxLatitude: 24.95,
  minLongitude: 91.8,
  maxLongitude: 91.93,
});

export function isWithinSccBounds(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= SCC_LOCATION_BOUNDS.minLatitude
    && latitude <= SCC_LOCATION_BOUNDS.maxLatitude
    && longitude >= SCC_LOCATION_BOUNDS.minLongitude
    && longitude <= SCC_LOCATION_BOUNDS.maxLongitude;
}

export const SCC_REPORT_CATEGORIES = Object.freeze([
  'Water & drainage',
  'Street lighting',
  'Roads',
  'Roads & transport',
  'Waste management',
  'Parks & public spaces',
  'Other',
]);

export const SCC_PRIORITIES = Object.freeze(['normal', 'urgent', 'safety_hazard']);

export const SCC_DEPARTMENTS = Object.freeze([
  'Water & drainage',
  'Street lighting',
  'Roads',
  'Waste management',
  'Parks & public spaces',
  'Others',
]);

export const REPORT_STATUSES = Object.freeze([
  'submitted',
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'confirmed_resolved',
  'reopened',
  'rejected',
]);

export function toReadableReportId(id, year = new Date().getFullYear()) {
  return `SCC-${year}-${String(id).padStart(6, '0')}`;
}
