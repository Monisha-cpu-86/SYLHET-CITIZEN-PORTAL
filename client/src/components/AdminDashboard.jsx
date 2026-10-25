import { useCallback, useEffect, useState } from "react";
import { SCC_DEPARTMENTS, SCC_PRIORITIES, REPORT_STATUSES } from "../../../shared/sylhet.js";
import { LocationMap } from "./LocationMap.jsx";
import "./admin.css";

async function adminRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 200) };
    }
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("civicpulse:auth-expired"));
    throw new Error(body.message || `Request failed (${response.status}).`);
  }
  return body;
}

const statusLabels = {
  submitted: "Submitted",
  open: "In progress",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  confirmed_resolved: "Confirmed resolved",
  reopened: "Reopened",
  rejected: "Rejected",
};

function Metric({ label, value, detail }) {
  return <article className="admin-metric"><span>{label}</span><strong>{value ?? "—"}</strong>{detail && <small>{detail}</small>}</article>;
}

export default function AdminDashboard({ user, onLogout }) {
  const [overview, setOverview] = useState(null);
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [staff, setStaff] = useState([]);
  const [audit, setAudit] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("acknowledged");
  const [filters, setFilters] = useState({ status: "", ward: "", priority: "", search: "" });
  const [draft, setDraft] = useState({});
  const [staffForm, setStaffForm] = useState({ name: "", email: "", password: "", role: "scc_officer", department: SCC_DEPARTMENTS[0] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dialogMessage, setDialogMessage] = useState("");
  const [dialogError, setDialogError] = useState("");

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ page: "1", limit: "100" });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const [nextOverview, nextReports] = await Promise.all([
      adminRequest("/api/admin/overview"),
      adminRequest(`/api/admin/reports?${params}`),
    ]);
    setOverview(nextOverview);
    setReports(nextReports.items);
  }, [filters]);

  useEffect(() => {
    setError("");
    Promise.all([
      refresh(),
      adminRequest("/api/admin/audit-log?limit=12").then(setAudit),
      adminRequest("/api/admin/duplicate-candidates").then(setDuplicates),
      user.role === "super_admin" ? adminRequest("/api/admin/staff").then(setStaff) : Promise.resolve(),
    ]).catch((loadError) => setError(loadError.message));
  }, [refresh, user.role]);

  useEffect(() => {
    const events = new EventSource("/api/admin/events", { withCredentials: true });
    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "report.created" || data.type === "report.updated") refresh().catch((refreshError) => setError(refreshError.message));
      } catch (parseError) {
        setError(`Could not read a live update: ${parseError.message}`);
      }
    };
    return () => events.close();
  }, [refresh]);

  async function openReport(id) {
    try {
      const report = await adminRequest(`/api/admin/reports/${id}`);
      setSelected(report);
      setDraft({
        status: report.status,
        priority: report.priority,
        assigned_department: report.assigned_department || "",
        assigned_to: report.assigned_to || "",
        public_response: report.public_response || "",
        internal_notes: report.internal_notes || "",
        dueAt: report.due_at ? new Date(report.due_at).toISOString().slice(0, 10) : "",
      });
      setDialogError("");
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function saveReport(event) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setDialogError("");
    setDialogMessage("");
    try {
      const body = { ...draft, assigned_to: draft.assigned_to || null, dueAt: draft.dueAt || null };
      const updated = await adminRequest(`/api/admin/reports/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSelected({ ...selected, ...updated });
      await refresh();
      await openReport(selected.id);
      setDialogMessage("Report updates saved.");
    } catch (saveError) {
      setDialogError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeReport() {
    if (!selected || selected.status !== "submitted") return;
    setBusy(true);
    setDialogError("");
    setDialogMessage("");
    try {
      await adminRequest(`/api/admin/reports/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "acknowledged" }),
      });
      await refresh();
      await openReport(selected.id);
      setDialogMessage(`${selected.report_code} accepted and acknowledged.`);
    } catch (acknowledgeError) {
      setDialogError(acknowledgeError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createStaff(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminRequest("/api/admin/staff", { method: "POST", body: JSON.stringify(staffForm) });
      setStaff(await adminRequest("/api/admin/staff"));
      setStaffForm({ name: "", email: "", password: "", role: "scc_officer", department: SCC_DEPARTMENTS[0] });
      setMessage("Staff account created.");
    } catch (staffError) {
      setError(staffError.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyBulkStatus() {
    setBusy(true);
    setError("");
    try {
      await adminRequest("/api/admin/reports/bulk/status", {
        method: "PATCH",
        body: JSON.stringify({ ids: selectedIds, status: bulkStatus }),
      });
      setSelectedIds([]);
      setMessage("Selected reports updated.");
      await refresh();
    } catch (bulkError) {
      setError(bulkError.message);
    } finally {
      setBusy(false);
    }
  }

  const filtersQuery = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="brand" href="/"><span className="brand-mark">C</span><span>CivicPulse <b>Sylhet</b></span></a>
        <div className="admin-identity"><span>{user.name} · {user.role.replaceAll("_", " ")}</span><button className="button button-quiet" onClick={onLogout}>Sign out</button></div>
      </header>
      <main className="admin-content">
        <div className="admin-title-row">
          <div><span className="eyebrow">SYLHET CITY CORPORATION</span><h1>Operations dashboard</h1><p className="muted">Review reports, coordinate departments, and keep citizens updated.</p></div>
          <a className="button button-quiet" href="/">Citizen portal</a>
        </div>
        {user.role === "viewer" && (
          <div className="admin-readonly-notice" role="note">
            <div><strong>Read-only demo account</strong><p>Report editing and acceptance are disabled. Sign out, then sign in with the SCC staff email and password configured in Render to manage reports.</p></div>
            <button className="button button-quiet" type="button" onClick={onLogout}>Sign out to switch account</button>
          </div>
        )}
        {error && <div className="message-banner banner-error" role="alert">{error}</div>}
        {message && <div className="message-banner banner-success" role="status">{message}</div>}
        <section className="admin-metrics" aria-label="Report metrics">
          <Metric label="All reports" value={overview?.total} />
          <Metric label="New today" value={overview?.newToday} />
          <Metric label="Awaiting action" value={overview?.newReports} />
          <Metric label="In progress" value={overview?.inProgress} />
          <Metric label="Resolved" value={overview?.resolved} />
          <Metric label="Overdue" value={overview?.overdue} />
          <Metric label="Avg. resolution time" value={overview?.avgResolutionHours == null ? "—" : `${Math.round(overview.avgResolutionHours)}h`} />
        </section>
        <section className="admin-panel">
          <div className="admin-section-heading"><div><span className="eyebrow">LIVE INBOX</span><h2>Report map</h2></div></div>
          <LocationMap reports={reports} height={320} />
          <p className="field-hint">Markers are approximate user-selected locations; map boundaries are guidance, not an enforcement boundary.</p>
        </section>
        <section className="admin-panel admin-chart-grid" aria-label="Report trends and breakdowns">
          <div><span className="eyebrow">CATEGORY LOAD</span><h2>Reports by category</h2>
            {(overview?.byCategory || []).slice(0, 6).map((item) => {
              const maximum = Math.max(...overview.byCategory.map((row) => Number(row.value)), 1);
              return <div className="chart-row" key={item.name}><span>{item.name}</span><div className="chart-track"><span style={{ width: `${Math.max(4, item.value / maximum * 100)}%` }} /></div><b>{item.value}</b></div>;
            })}
          </div>
          <div><span className="eyebrow">RECENT VOLUME</span><h2>Daily submissions</h2>
            <div className="daily-bars">{(overview?.dailyTrend || []).map((item) => {
              const maximum = Math.max(...overview.dailyTrend.map((row) => Number(row.value)), 1);
              return <div className="daily-bar" key={item.day} title={`${item.day}: ${item.value}`}><span style={{ height: `${Math.max(5, item.value / maximum * 100)}%` }} /><small>{new Date(item.day).toLocaleDateString(undefined, { day: "numeric" })}</small></div>;
            })}</div>
          </div>
          <div><span className="eyebrow">WARD DISTRIBUTION</span><h2>Top wards</h2>
            {(overview?.byWard || []).filter((item) => item.name !== "Unassigned").slice(0, 8).map((item) => {
              const wards = overview.byWard.filter((row) => row.name !== "Unassigned");
              const maximum = Math.max(...wards.map((row) => Number(row.value)), 1);
              return <div className="chart-row" key={item.name}><span>{item.name}</span><div className="chart-track"><span style={{ width: `${Math.max(4, item.value / maximum * 100)}%` }} /></div><b>{item.value}</b></div>;
            })}
          </div>
        </section>
        <section className="admin-panel">
          <div className="admin-section-heading">
            <div><span className="eyebrow">SERVICE REQUESTS</span><h2>Report inbox <span className="count-pill">{reports.length}</span></h2></div>
            <a className="button button-quiet" href={`/api/admin/reports/export.csv?${filtersQuery}`}>Export CSV</a>
          </div>
          <div className="admin-filters">
            <input aria-label="Search reports" placeholder="Search report or citizen" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
            <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">All statuses</option>{REPORT_STATUSES.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select>
            <select aria-label="Filter by priority" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
              <option value="">All priorities</option>{SCC_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority.replaceAll("_", " ")}</option>)}
            </select>
            <select aria-label="Filter by ward" value={filters.ward} onChange={(event) => setFilters({ ...filters, ward: event.target.value })}>
              <option value="">All wards</option>{Array.from({ length: 27 }, (_, index) => `Ward ${index + 1}`).map((ward) => <option key={ward}>{ward}</option>)}
            </select>
          </div>
          {user.role !== "viewer" && selectedIds.length > 0 && <div className="bulk-actions"><span>{selectedIds.length} selected</span><select aria-label="Bulk status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>{REPORT_STATUSES.filter((status) => status !== "confirmed_resolved").map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select><button className="button button-primary" type="button" onClick={applyBulkStatus} disabled={busy}>Apply status</button></div>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr>{user.role !== "viewer" && <th><input type="checkbox" aria-label="Select all visible reports" checked={reports.length > 0 && selectedIds.length === reports.length} onChange={(event) => setSelectedIds(event.target.checked ? reports.map((report) => report.id) : [])} /></th>}<th>Report</th><th>Category / ward</th><th>Status</th><th>Priority</th><th>Department</th><th>Submitted</th></tr></thead>
              <tbody>{reports.map((report) => (
                <tr key={report.id} onClick={() => openReport(report.id)} tabIndex="0" onKeyDown={(event) => event.key === "Enter" && openReport(report.id)}>
                  {user.role !== "viewer" && <td><input type="checkbox" aria-label={`Select ${report.report_code}`} checked={selectedIds.includes(report.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, report.id] : current.filter((id) => id !== report.id))} /></td>}
                  <td><b>{report.report_code}</b><small>{report.citizen_name}</small></td>
                  <td>{report.type}<small>{report.ward || "Ward unassigned"}</small></td>
                  <td><span className={`status-pill status-${report.status}`}>{statusLabels[report.status] || report.status}</span>{Boolean(report.is_overdue) && <small className="overdue-label">Overdue</small>}</td>
                  <td>{report.priority?.replaceAll("_", " ")}</td><td>{report.assigned_department || "Unassigned"}</td><td>{new Date(report.created_at).toLocaleDateString()}</td>
                </tr>
              ))}</tbody>
            </table>
            {reports.length === 0 && <p className="empty-state">No reports match these filters.</p>}
          </div>
        </section>
        <div className="admin-lower-grid">
          <section className="admin-panel"><div className="admin-section-heading"><div><span className="eyebrow">POTENTIAL MATCHES</span><h2>Nearby duplicates</h2></div></div>
            {duplicates.length ? <ul className="admin-compact-list">{duplicates.slice(0, 8).map((pair) => <li key={`${pair.first.id}-${pair.second.id}`}><button type="button" onClick={() => openReport(pair.first.id)}>{pair.first.report_code} + {pair.second.report_code}<small>{pair.first.type} · {pair.distanceMeters}m apart</small></button></li>)}</ul> : <p className="field-hint">No likely duplicates detected in the last 7 days.</p>}
          </section>
          <section className="admin-panel"><div className="admin-section-heading"><div><span className="eyebrow">ACCOUNTABILITY</span><h2>Recent audit activity</h2></div></div>
            <ul className="admin-compact-list">{audit.map((entry) => <li key={entry.id}><span><b>{entry.action}</b><small>{entry.actor_name || "System"} · {entry.report_code || "Staff action"}</small></span></li>)}</ul>
          </section>
        </div>
        {user.role === "super_admin" && (
          <section className="admin-panel">
            <div className="admin-section-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h2>SCC staff</h2></div></div>
            <ul className="staff-list">{staff.map((member) => <li key={member.id}><span><b>{member.name}</b><small>{member.email} · {member.department || "All departments"}</small></span><span className="staff-role">{member.role.replaceAll("_", " ")}</span></li>)}</ul>
            <form className="staff-create-form" onSubmit={createStaff}>
              <input required maxLength="120" placeholder="Staff name" aria-label="Staff name" value={staffForm.name} onChange={(event) => setStaffForm({ ...staffForm, name: event.target.value })} />
              <input required type="email" placeholder="Staff email" aria-label="Staff email" value={staffForm.email} onChange={(event) => setStaffForm({ ...staffForm, email: event.target.value })} />
              <input required type="password" minLength="12" placeholder="Temporary password (12+ chars)" aria-label="Temporary password" value={staffForm.password} onChange={(event) => setStaffForm({ ...staffForm, password: event.target.value })} />
              <select aria-label="New staff role" value={staffForm.role} onChange={(event) => setStaffForm({ ...staffForm, role: event.target.value })}><option value="scc_officer">SCC officer</option><option value="viewer">Viewer</option></select>
              <select aria-label="New staff department" value={staffForm.department} onChange={(event) => setStaffForm({ ...staffForm, department: event.target.value })}>{SCC_DEPARTMENTS.map((department) => <option key={department}>{department}</option>)}</select>
              <button className="button button-primary" disabled={busy}>Create staff account</button>
            </form>
          </section>
        )}
      </main>
      {selected && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">
            <button className="dialog-close" type="button" onClick={() => setSelected(null)} aria-label="Close report details">×</button>
            <span className="eyebrow">{selected.report_code}</span><h2 id="report-dialog-title">{selected.type} · {selected.ward}</h2>
            <p>{selected.description}</p><p className="field-hint">{selected.citizen_name} · {selected.citizen_email} · {selected.location_text || "No location description"}</p>
            {selected.status === "submitted" && user.role !== "viewer" && (
              <button className="button button-primary acknowledge-report-button" type="button" onClick={acknowledgeReport} disabled={busy}>
                {busy ? "Accepting..." : "Accept / acknowledge report"}
              </button>
            )}
            {dialogError && <p className="admin-dialog-message admin-dialog-error" role="alert">{dialogError}</p>}
            {dialogMessage && <p className="admin-dialog-message admin-dialog-success" role="status">{dialogMessage}</p>}
            {user.role === "viewer" && (
              <div className="admin-readonly-inline" role="note">
                <p>This demo account is view-only. Sign in with the SCC staff email and password configured in Render to accept reports or edit these fields.</p>
                <button className="button button-quiet" type="button" onClick={onLogout}>Sign out and switch to SCC staff</button>
              </div>
            )}
            {selected.photos?.map((photo) => <img className="admin-report-photo" key={photo.id} src={`/api/complaints/photos/${photo.id}`} alt={`Citizen photo for ${selected.report_code}`} />)}
            {selected.latitude != null && <LocationMap location={selected} height={220} />}
            {selected.history?.length > 0 && <ol className="report-timeline">{selected.history.map((event) => <li key={event.id}><b>{statusLabels[event.to_status] || event.to_status}</b><small>{new Date(event.created_at).toLocaleString()} · {event.changed_by_name || "Citizen"}</small>{event.public_note && <p>{event.public_note}</p>}</li>)}</ol>}
            <form className="form-stack admin-edit-form" onSubmit={saveReport}>
              <label>Status<select disabled={user.role === "viewer"} value={draft.status || ""} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{REPORT_STATUSES.filter((status) => status !== "confirmed_resolved").map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
              <label>Priority<select disabled={user.role === "viewer"} value={draft.priority || ""} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>{SCC_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority.replaceAll("_", " ")}</option>)}</select></label>
              <label>Department<select disabled={user.role === "viewer"} value={draft.assigned_department || ""} onChange={(event) => setDraft({ ...draft, assigned_department: event.target.value })}><option value="">Unassigned</option>{SCC_DEPARTMENTS.map((department) => <option key={department}>{department}</option>)}</select></label>
              {user.role === "super_admin" && <label>Assigned officer<select value={draft.assigned_to || ""} onChange={(event) => setDraft({ ...draft, assigned_to: event.target.value })}><option value="">Unassigned</option>{staff.filter((member) => ["scc_officer", "super_admin"].includes(member.role)).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
              <label>Estimated due date<input disabled={user.role === "viewer"} type="date" value={draft.dueAt || ""} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label>Public response<textarea disabled={user.role === "viewer"} rows="3" maxLength="4000" value={draft.public_response || ""} onChange={(event) => setDraft({ ...draft, public_response: event.target.value })} /></label>
              {user.role !== "viewer" && <label>Internal staff note<textarea rows="3" maxLength="10000" value={draft.internal_notes || ""} onChange={(event) => setDraft({ ...draft, internal_notes: event.target.value })} /></label>}
              {user.role !== "viewer" && <button className="button button-primary" disabled={busy}>{busy ? "Saving..." : "Save report updates"}</button>}
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
