import { useCallback, useEffect, useMemo, useState } from "react";
import { SCC_PRIORITIES, SCC_REPORT_CATEGORIES, SCC_WARDS, SYLHET_MAP_DEFAULTS, isWithinSccBounds } from "../../shared/sylhet.js";
import { LocationMap } from "./components/LocationMap.jsx";
import AdminDashboard from "./components/AdminDashboard.jsx";
import "leaflet/dist/leaflet.css";

const demoAccounts = [
  { name: "Demo User", email: "demo@example.com", password: "demo123" },
  { name: "Ayesha Rahman", email: "ayesha@example.com", password: "ayesha123" },
  { name: "Tanvir Hasan", email: "tanvir@example.com", password: "tanvir123" },
];

async function request(path, options = {}) {
  let response;
  try {
    const headers = { ...options.headers };
    if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    response = await fetch(path, {
      credentials: "include",
      ...options,
      headers,
    });
  } catch {
    throw new Error("Cannot reach the CivicPulse Sylhet API. Check that the backend and MySQL database are running.");
  }

  const responseText = await response.text();
  let body = {};
  if (responseText) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = { message: responseText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) };
    }
  }
  if (!response.ok) {
    const fallback = response.status >= 500
      ? `CivicPulse Sylhet API returned ${response.status}. Check the backend logs and MySQL connection.`
      : `Request failed (${response.status})`;
    throw new Error(body.message || body.error || fallback);
  }
  return body;
}

function formatDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function getStatusLabel(status) {
  if (status === "open" || status === "in_progress") return "In progress";
  if (status === "submitted") return "Submitted";
  if (status === "confirmed_resolved") return "Confirmed resolved";
  if (status === "resolved") return "Awaiting your confirmation";
  return status || "Unknown";
}

async function compressImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP photo.");
  }
  if (file.size > 20 * 1024 * 1024) throw new Error("Select an image smaller than 20 MB before compression.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) {
    if (file.size <= 5 * 1024 * 1024) return file;
    throw new Error("This browser could not compress the photo. Choose a smaller image.");
  }
  if (blob.size > 5 * 1024 * 1024) throw new Error("The compressed photo is still larger than 5 MB.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" });
}

function focusFirstInvalid(form) {
  requestAnimationFrame(() => form.querySelector('[aria-invalid="true"]')?.focus());
}

function readSavedDraft() {
  const empty = {
    complaintForm: { type: "", description: "", ward: "", priority: "normal", locationText: "" },
    location: null,
    locationNotShared: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem("civicpulse-report-draft") || "null");
    if (!saved || typeof saved !== "object") return empty;
    return {
      complaintForm: { ...empty.complaintForm, ...saved.complaintForm },
      location: saved.location && Number.isFinite(saved.location.latitude) && Number.isFinite(saved.location.longitude)
        ? saved.location
        : null,
      locationNotShared: saved.locationNotShared === true,
    };
  } catch (error) {
    console.error("Could not restore the saved report draft.", error);
    return empty;
  }
}

export default function App() {
  const [savedDraft] = useState(readSavedDraft);
  const [user, setUser] = useState(null);
  const [complaints, setComplaints] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [reportFiles, setReportFiles] = useState([]);
  const [location, setLocation] = useState(savedDraft.location);
  const [locationNotShared, setLocationNotShared] = useState(savedDraft.locationNotShared);
  const [reportKey, setReportKey] = useState(() => crypto.randomUUID());
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authErrors, setAuthErrors] = useState({});
  const [complaintForm, setComplaintForm] = useState(savedDraft.complaintForm);
  const [complaintErrors, setComplaintErrors] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadComplaints = useCallback(async () => {
    const response = await request("/api/complaints");
    setComplaints(response.items || []);
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotifications(await request("/api/complaints/notifications"));
  }, []);

  useEffect(() => {
    request("/api/auth/me")
      .then(async (currentUser) => {
        setUser(currentUser);
        await Promise.all([loadComplaints(), loadNotifications()]);
      })
      .catch((loadError) => {
        if (loadError.message !== "Not authenticated") setError(loadError.message);
      })
      .finally(() => setLoading(false));
  }, [loadComplaints, loadNotifications]);

  useEffect(() => {
    const previews = reportFiles.map((file) => URL.createObjectURL(file));
    setPhotoPreviews(previews);
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview));
  }, [reportFiles]);

  useEffect(() => {
    const hasDraft = Object.values(complaintForm).some(Boolean) || location || locationNotShared;
    try {
      if (hasDraft) {
        localStorage.setItem("civicpulse-report-draft", JSON.stringify({ complaintForm, location, locationNotShared }));
      } else {
        localStorage.removeItem("civicpulse-report-draft");
      }
    } catch (storageError) {
      console.error("Could not save the report draft on this device.", storageError);
    }
  }, [complaintForm, location, locationNotShared]);

  const stats = useMemo(() => ({
    total: complaints.length,
    inProgress: complaints.filter((item) => ["open", "submitted", "acknowledged", "in_progress", "reopened"].includes(item.status)).length,
    resolved: complaints.filter((item) => ["resolved", "confirmed_resolved"].includes(item.status)).length,
  }), [complaints]);

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setNotice("");
    const nextErrors = {};
    if (authMode === "register" && !authForm.name.trim()) {
      nextErrors.name = "Enter your name.";
    }
    if (!authForm.email.trim()) {
      nextErrors.email = "Enter your email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authForm.email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (!authForm.password) {
      nextErrors.password = "Enter your password.";
    } else if (authMode === "register" && authForm.password.length < 8) {
      nextErrors.password = "Password must be at least 8 characters.";
    }
    setAuthErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(form);
      return;
    }

    setAuthSubmitting(true);
    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload = authMode === "login"
        ? { email: authForm.email.trim(), password: authForm.password }
        : { ...authForm, name: authForm.name.trim(), email: authForm.email.trim() };
      const signedInUser = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUser(signedInUser);
      setAuthForm({ name: "", email: "", password: "" });
      setAuthErrors({});
      await Promise.all([loadComplaints(), loadNotifications()]);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleComplaintSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setNotice("");
    const nextErrors = {};
    if (!complaintForm.type) nextErrors.type = "Choose an issue category.";
    if (!complaintForm.ward) nextErrors.ward = "Choose your Sylhet City Corporation ward.";
    if (!location && !locationNotShared) nextErrors.location = "Pin the issue on the map or choose not to share your location.";
    if (!complaintForm.description.trim()) {
      nextErrors.description = "Describe the issue.";
    } else if (complaintForm.description.trim().length < 8) {
      nextErrors.description = "Add at least 8 characters so we can understand the issue.";
    }
    setComplaintErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstInvalid(form);
      return;
    }

    setComplaintSubmitting(true);
    try {
      const compressedPhotos = await Promise.all(reportFiles.map(compressImage));
      const body = new FormData();
      for (const [key, value] of Object.entries(complaintForm)) body.append(key, value);
      if (location && !locationNotShared) {
        body.append("latitude", String(location.latitude));
        body.append("longitude", String(location.longitude));
      }
      body.append("locationNotShared", String(locationNotShared));
      compressedPhotos.forEach((photo) => body.append("photos", photo));
      const created = await request("/api/complaints", {
        method: "POST",
        headers: { "Idempotency-Key": reportKey },
        body,
      });
      setComplaints((current) => [created, ...current]);
      setComplaintForm({ type: "", description: "", ward: "", priority: "normal", locationText: "" });
      setLocation(null);
      setLocationNotShared(false);
      setReportFiles([]);
      setReportKey(crypto.randomUUID());
      setComplaintErrors({});
      setNotice("Your complaint has been submitted.");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setComplaintSubmitting(false);
    }
  }

  async function updateCitizenStatus(id, action, body = {}) {
    if (resolvingId !== null) return;
    setError("");
    setNotice("");
    setResolvingId(id);
    try {
      const updated = await request(`/api/complaints/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setComplaints((current) => current.map((item) => item.id === id ? updated : item));
      setNotice(action === "reopen" ? "Your report has been reopened." : "Thank you for confirming the resolution.");
      await loadNotifications();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setResolvingId(null);
    }
  }

  async function markNotificationRead(notification) {
    try {
      await request(`/api/complaints/notifications/${notification.id}/read`, { method: "PATCH" });
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (notificationError) {
      setError(notificationError.message);
    }
  }

  async function choosePhotos(fileList) {
    const selected = Array.from(fileList);
    if (selected.length + reportFiles.length > 3) {
      setError("Choose no more than 3 photos.");
      return;
    }
    try {
      const compressed = await Promise.all(selected.map(compressImage));
      setReportFiles((current) => [...current, ...compressed]);
      setError("");
    } catch (photoError) {
      setError(photoError.message);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError("Location sharing is not available in this browser. Pin a location on the map instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocationNotShared(false);
        setError("");
      },
      () => setError("Could not access your location. Pin the issue on the map or choose not to share it."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleLogout() {
    setError("");
    setLoggingOut(true);
    try {
      await request("/api/auth/logout", { method: "POST" });
      setUser(null);
      setComplaints([]);
      setNotifications([]);
      setAuthMode("login");
      setAuthForm({ name: "", email: "", password: "" });
      setAuthErrors({});
      setNotice("");
    } catch (logoutError) {
      setError(logoutError.message);
    } finally {
      setLoggingOut(false);
    }
  }

  if (loading) {
    return <main className="loading-screen"><span className="loader" />Loading CivicPulse...</main>;
  }

  if (user && window.location.pathname === "/admin") {
    if (!["super_admin", "scc_officer", "viewer"].includes(user.role)) {
      return <main className="loading-screen"><p>You do not have permission to access SCC administration.</p><a href="/">Return to your reports</a></main>;
    }
    return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  if (!user) {
    const isStaffLogin = window.location.pathname === "/admin";
    return (
      <main className="auth-layout">
        <section className="auth-intro" aria-label="About CivicPulse">
          <a className="brand brand-light" href="/" aria-label="CivicPulse Sylhet home">
            <span className="brand-mark">C</span>
            <span>CivicPulse <b>Sylhet</b></span>
          </a>
          <div className="intro-copy">
            <span className="eyebrow">YOUR CITY. YOUR VOICE.</span>
            <h2>Better streets start with being heard.</h2>
            <p>Report local issues, follow their progress, and help make Sylhet City a better place to live.</p>
          </div>
          <div className="intro-footer">A smarter way to connect citizens and communities.</div>
        </section>
        <section className="auth-panel">
          <div className="auth-card" aria-labelledby="auth-title">
            <div className="mobile-brand brand">
              <span className="brand-mark">C</span><span>CivicPulse <b>Sylhet</b></span>
            </div>
            <span className="eyebrow">{isStaffLogin ? "SCC STAFF PORTAL" : "CITIZEN PORTAL"}</span>
            <h1 id="auth-title">{isStaffLogin ? "Staff sign in" : authMode === "login" ? "Welcome back" : "Create your account"}</h1>
            <p className="muted">{isStaffLogin ? "Sign in with your City Corporation staff account to manage reports." : authMode === "login" ? "Sign in to manage your civic reports." : "Join your community and make a difference."}</p>
            <form className="form-stack" onSubmit={handleAuthSubmit} noValidate>
              {authMode === "register" && (
                <label>
                  <span className="field-label">Full name <span className="required-mark">Required</span></span>
                  <input
                    id="auth-name"
                    autoComplete="name"
                    required
                    aria-required="true"
                    aria-invalid={Boolean(authErrors.name)}
                    aria-describedby={authErrors.name ? "auth-name-error" : undefined}
                    value={authForm.name}
                    onChange={(event) => {
                      setAuthForm({ ...authForm, name: event.target.value });
                      setAuthErrors((current) => ({ ...current, name: "" }));
                    }}
                    placeholder="Your name"
                  />
                  {authErrors.name && <span className="field-error" id="auth-name-error" role="alert">{authErrors.name}</span>}
                </label>
              )}
              <label>
                <span className="field-label">Email address <span className="required-mark">Required</span></span>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(authErrors.email)}
                  aria-describedby={authErrors.email ? "auth-email-error" : undefined}
                  value={authForm.email}
                  onChange={(event) => {
                    setAuthForm({ ...authForm, email: event.target.value });
                    setAuthErrors((current) => ({ ...current, email: "" }));
                  }}
                  placeholder="you@example.com"
                />
                {authErrors.email && <span className="field-error" id="auth-email-error" role="alert">{authErrors.email}</span>}
              </label>
              <label>
                <span className="field-label">Password <span className="required-mark">Required</span></span>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  minLength={authMode === "register" ? 8 : 1}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(authErrors.password)}
                  aria-describedby={authErrors.password ? "auth-password-error" : undefined}
                  value={authForm.password}
                  onChange={(event) => {
                    setAuthForm({ ...authForm, password: event.target.value });
                    setAuthErrors((current) => ({ ...current, password: "" }));
                  }}
                  placeholder={authMode === "register" ? "At least 8 characters" : "Your password"}
                />
                {authErrors.password && <span className="field-error" id="auth-password-error" role="alert">{authErrors.password}</span>}
              </label>
              {error && <p className="message error" role="alert">{error}</p>}
              <button className="button button-primary button-full" disabled={authSubmitting} aria-busy={authSubmitting}>
                {authSubmitting ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account"}
                {!authSubmitting && <span aria-hidden="true">→</span>}
              </button>
            </form>
            {!isStaffLogin && <p className="switch-auth">
              {authMode === "login" ? "New to CivicPulse?" : "Already have an account?"}{" "}
              <button type="button" onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setError("");
                setAuthErrors({});
              }}>
                {authMode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>}
            {authMode === "login" && !isStaffLogin && import.meta.env.DEV && (
              <div className="demo-accounts">
                <p className="demo-heading">Explore with a demo account</p>
                {demoAccounts.map((account) => (
                  <button
                    className="demo-account"
                    key={account.email}
                    type="button"
                    onClick={() => setAuthForm({ name: "", email: account.email, password: account.password })}
                  >
                    <span className="demo-account-avatar" aria-hidden="true">{account.name.charAt(0)}</span>
                    <span className="demo-account-info">
                      <b>{account.name}</b>
                      <span>{account.email} · {account.password}</span>
                    </span>
                    <span className="demo-use">Use →</span>
                  </button>
                ))}
              </div>
            )}
            {authMode === "login" && isStaffLogin && (
              <p className="staff-login-back"><a href="/">← Return to citizen sign in</a></p>
            )}
            {authMode === "login" && !isStaffLogin && (
              <section className="staff-login" aria-label="SCC staff sign in">
                <div>
                  <strong>City Corporation staff?</strong>
                  <p>Use your SCC account to review and manage community reports.</p>
                </div>
                <a className="button button-quiet button-full" href="/admin">SCC staff sign in <span aria-hidden="true">→</span></a>
              </section>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="CivicPulse Sylhet home">
          <span className="brand-mark">C</span><span>CivicPulse <b>Sylhet</b></span>
        </a>
        <div className="user-menu">
          {["super_admin", "scc_officer", "viewer"].includes(user.role) && <a className="button button-quiet" href="/admin">SCC Admin</a>}
          <div className="notification-control">
            <button className="button button-quiet notification-button" type="button" aria-expanded={showNotifications} onClick={() => setShowNotifications((visible) => !visible)}>
              Notifications{notifications.filter((item) => !item.read_at).length > 0 && <span className="notification-count">{notifications.filter((item) => !item.read_at).length}</span>}
            </button>
            {showNotifications && <div className="notification-popover">
              <strong>Updates</strong>
              {notifications.length === 0 ? <p className="field-hint">No notifications yet.</p> : notifications.slice(0, 8).map((notification) => (
                <button type="button" className={`notification-item ${notification.read_at ? "" : "notification-unread"}`} key={notification.id} onClick={() => markNotificationRead(notification)}>
                  <span>{notification.message}</span><small>{formatDate(notification.created_at)}{!notification.read_at ? " · Mark read" : ""}</small>
                </button>
              ))}
            </div>}
          </div>
          <div className="avatar" aria-hidden="true">{user.name?.charAt(0)?.toUpperCase() || "C"}</div>
          <span className="user-name">{user.name}</span>
          <button className="button button-quiet" onClick={handleLogout} disabled={loggingOut} aria-busy={loggingOut}>
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </header>

      <main className="dashboard">
        <section className="welcome-row">
          <div>
            <span className="eyebrow">CITIZEN DASHBOARD</span>
            <h1>Good to see you, {user.name?.split(" ")[0]}.</h1>
            <p className="muted">Your reports help make Sylhet City a better place to live.</p>
          </div>
          <div className="welcome-badge"><span aria-hidden="true">✦</span> Community impact starts here</div>
        </section>

        {(error || notice) && (
          <div className={`message-banner ${error ? "banner-error" : "banner-success"}`} role={error ? "alert" : "status"}>
            <span>{error || notice}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}>×</button>
          </div>
        )}

        <section className="stats-grid" aria-label="Complaint summary">
          <article className="stat-card"><span className="stat-icon icon-blue" aria-hidden="true">↗</span><div><span className="stat-label">Total reports</span><strong>{stats.total}</strong></div></article>
          <article className="stat-card"><span className="stat-icon icon-amber" aria-hidden="true">◷</span><div><span className="stat-label">In progress</span><strong>{stats.inProgress}</strong></div></article>
          <article className="stat-card"><span className="stat-icon icon-green" aria-hidden="true">✓</span><div><span className="stat-label">Resolved</span><strong>{stats.resolved}</strong></div></article>
        </section>

        <div className="content-grid">
          <section className="panel report-panel">
            <div className="panel-heading">
              <div><span className="eyebrow">MAKE A DIFFERENCE</span><h2>Report an issue</h2></div>
              <span className="heading-icon" aria-hidden="true">＋</span>
            </div>
            <p className="panel-description">Tell us what needs attention in your neighborhood.</p>
            <form className="form-stack" onSubmit={handleComplaintSubmit} noValidate aria-busy={complaintSubmitting}>
              <label>
                <span className="field-label">Issue category <span className="required-mark">Required</span></span>
                <select
                  id="complaint-type"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(complaintErrors.type)}
                  aria-describedby={complaintErrors.type ? "complaint-type-error" : undefined}
                  value={complaintForm.type}
                  onChange={(event) => {
                    setComplaintForm({ ...complaintForm, type: event.target.value });
                    setComplaintErrors((current) => ({ ...current, type: "" }));
                  }}
                >
                  <option value="">Select a category</option>
                  {SCC_REPORT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                </select>
                {complaintErrors.type && <span className="field-error" id="complaint-type-error" role="alert">{complaintErrors.type}</span>}
              </label>
              <label>
                <span className="field-label">Ward / Area <span className="required-mark">Required</span></span>
                <select
                  id="complaint-ward"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(complaintErrors.ward)}
                  aria-describedby={complaintErrors.ward ? "complaint-ward-error" : "complaint-ward-hint"}
                  value={complaintForm.ward}
                  onChange={(event) => {
                    setComplaintForm({ ...complaintForm, ward: event.target.value });
                    setComplaintErrors((current) => ({ ...current, ward: "" }));
                  }}
                >
                  <option value="">Select your SCC ward</option>
                  {SCC_WARDS.map((ward) => <option key={ward} value={ward}>{ward}</option>)}
                </select>
                {complaintErrors.ward
                  ? <span className="field-error" id="complaint-ward-error" role="alert">{complaintErrors.ward}</span>
                  : <span className="field-hint" id="complaint-ward-hint">Select the ward where the issue is located.</span>}
              </label>
              <label>
                <span className="field-label">Priority</span>
                <select value={complaintForm.priority} onChange={(event) => setComplaintForm({ ...complaintForm, priority: event.target.value })}>
                  {SCC_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority === "safety_hazard" ? "Safety hazard" : priority[0].toUpperCase() + priority.slice(1)}</option>)}
                </select>
                <span className="field-hint">Choose a safety hazard only when there is an immediate risk to people.</span>
              </label>
              <div className="location-field">
                <div className="field-label">Pin the issue location <span className="required-mark">Required unless skipped</span></div>
                <div className="location-actions">
                  <button className="button button-quiet" type="button" onClick={useCurrentLocation}>Use my current location</button>
                  {location && <button className="button button-quiet" type="button" onClick={() => setLocation(null)}>Clear pin</button>}
                </div>
                <LocationMap location={location} onChange={(nextLocation) => { setLocation(nextLocation); setLocationNotShared(false); }} interactive height={240} />
                {location && <span className="field-hint">Pinned at {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}. {isWithinSccBounds(location.latitude, location.longitude) ? "Within the approximate SCC map area." : "This pin is outside the approximate SCC area. Please check it before submitting."}</span>}
                {complaintErrors.location && <span className="field-error" role="alert">{complaintErrors.location}</span>}
                <label className="checkbox-label">
                  <input type="checkbox" checked={locationNotShared} onChange={(event) => { setLocationNotShared(event.target.checked); if (event.target.checked) setLocation(null); setComplaintErrors((current) => ({ ...current, location: "" })); }} />
                  <span>I prefer not to share a map location; I will describe the area instead.</span>
                </label>
                <label>
                  <span className="field-label">Location details (optional)</span>
                  <input maxLength="500" value={complaintForm.locationText} onChange={(event) => setComplaintForm({ ...complaintForm, locationText: event.target.value })} placeholder="Street, landmark, or nearby building" />
                </label>
              </div>
              <label>
                <span className="field-label">Photos (up to 3)</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { choosePhotos(event.target.files); event.target.value = ""; }} />
                <span className="field-hint">JPG, PNG, or WebP. Photos are compressed and metadata is removed before storage.</span>
              </label>
              {photoPreviews.length > 0 && <div className="photo-preview-list">{photoPreviews.map((preview, index) => <div className="photo-preview" key={preview}><img src={preview} alt={`Selected report photo ${index + 1}`} /><button type="button" onClick={() => setReportFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>Remove</button></div>)}</div>}
              <label>
                <span className="field-label">Describe the issue <span className="required-mark">Required</span></span>
                <textarea
                  id="complaint-description"
                  required
                  minLength={8}
                  aria-required="true"
                  aria-invalid={Boolean(complaintErrors.description)}
                  aria-describedby={complaintErrors.description ? "complaint-description-error" : "complaint-description-hint"}
                  rows="5"
                  value={complaintForm.description}
                  onChange={(event) => {
                    setComplaintForm({ ...complaintForm, description: event.target.value });
                    setComplaintErrors((current) => ({ ...current, description: "" }));
                  }}
                  placeholder="Share the location and details that will help us understand the issue..."
                />
                {complaintErrors.description
                  ? <span className="field-error" id="complaint-description-error" role="alert">{complaintErrors.description}</span>
                  : <span className="field-hint" id="complaint-description-hint">Include a location and a few details (at least 8 characters).</span>}
              </label>
              <button className="button button-primary button-full" disabled={complaintSubmitting} aria-busy={complaintSubmitting}>
                {complaintSubmitting ? "Submitting..." : "Submit report"} {!complaintSubmitting && <span aria-hidden="true">→</span>}
              </button>
              <p className="form-footnote">Your reports and photos are visible only to you and authorized SCC staff.</p>
              <p className="field-hint">Your text and selected pin are saved as a draft on this device. Selected photos are not saved in offline drafts.</p>
            </form>
          </section>

          <section className="panel reports-panel">
            <div className="panel-heading report-list-heading">
              <div><span className="eyebrow">YOUR ACTIVITY</span><h2>My reports <span className="count-pill">{complaints.length}</span></h2></div>
            </div>
            {complaints.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">▤</span>
                <h3>No reports yet</h3>
                <p>When you report a community issue, it will appear here.</p>
              </div>
            ) : (
              <div className="complaint-list">
                {complaints.map((complaint) => (
                  <article className="complaint-card" key={complaint.id}>
                    <div className="complaint-card-top">
                      <span className="category-label">{complaint.report_code || complaint.type}</span>
                      <span className={`status-pill ${complaint.status === "resolved" || complaint.status === "confirmed_resolved" ? "status-resolved" : complaint.status === "open" || complaint.status === "in_progress" ? "status-open" : "status-unknown"}`}>
                        <span aria-hidden="true" />{getStatusLabel(complaint.status)}
                      </span>
                    </div>
                    <p className="complaint-ward">{complaint.type}{complaint.ward ? ` · ${complaint.ward}, Sylhet City` : ""} · {complaint.priority?.replaceAll("_", " ")}</p>
                    <p className="complaint-description">{complaint.description}</p>
                    {complaint.public_response && <div className="public-response"><b>SCC update</b><p>{complaint.public_response}</p></div>}
                    {complaint.due_at && <p className="field-hint">Estimated response by {formatDate(complaint.due_at)}</p>}
                    {complaint.photos?.length > 0 && <div className="citizen-photo-list">{complaint.photos.map((photo) => <img key={photo.id} src={`/api/complaints/photos/${photo.id}`} alt={`Photo for ${complaint.report_code}`} />)}</div>}
                    {complaint.history?.length > 0 && <ol className="citizen-timeline">{complaint.history.map((entry) => <li key={`${entry.created_at}-${entry.to_status}`}><b>{getStatusLabel(entry.to_status)}</b><time>{formatDate(entry.created_at)}</time>{entry.public_note && <p>{entry.public_note}</p>}</li>)}</ol>}
                    <div className="complaint-card-bottom">
                      <time dateTime={complaint.created_at}>{formatDate(complaint.created_at)}</time>
                      {complaint.status === "resolved" && (
                        <button
                          className="resolve-button"
                          type="button"
                          onClick={() => updateCitizenStatus(complaint.id, "confirm-resolution")}
                          disabled={resolvingId !== null}
                          aria-busy={resolvingId === complaint.id}
                        >
                          {resolvingId === complaint.id ? "Updating..." : "Confirm resolved"}
                        </button>
                      )}
                      {["resolved", "confirmed_resolved"].includes(complaint.status) && <button className="resolve-button reopen-button" type="button" onClick={() => { const reason = window.prompt("Why does this issue need more work? (8–1,000 characters)"); if (reason) updateCitizenStatus(complaint.id, "reopen", { reason }); }} disabled={resolvingId !== null}>Reopen report</button>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
        <footer className="page-footer"><span>CivicPulse Sylhet</span><span>Small actions. Better communities.</span></footer>
      </main>
    </div>
  );
}
