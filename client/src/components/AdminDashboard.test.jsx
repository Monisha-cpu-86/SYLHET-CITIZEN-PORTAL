import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from './AdminDashboard.jsx';

vi.mock('./LocationMap.jsx', () => ({ LocationMap: () => null }));

const initialReport = {
  id: 26,
  report_code: 'SCC-2026-000026',
  type: 'Water & drainage',
  ward: 'Ward 1',
  description: 'A water pipe is leaking near the main road.',
  status: 'submitted',
  priority: 'normal',
  assigned_department: null,
  assigned_to: null,
  public_response: null,
  internal_notes: null,
  due_at: null,
  citizen_name: 'Ayesha Rahman',
  citizen_email: 'ayesha@example.com',
  photos: [],
  history: [],
};

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockAdminApi() {
  let report = { ...initialReport };
  globalThis.fetch = vi.fn(async (path, options = {}) => {
    const url = String(path);
    if (url === '/api/admin/overview') {
      return jsonResponse({ total: 1, newToday: 1, newReports: 1, inProgress: 0, resolved: 0, overdue: 0, byCategory: [], dailyTrend: [], byWard: [] });
    }
    if (url.startsWith('/api/admin/reports?')) return jsonResponse({ items: [report], total: 1 });
    if (url === '/api/admin/audit-log?limit=12' || url === '/api/admin/duplicate-candidates') return jsonResponse([]);
    if (url === '/api/admin/staff') return jsonResponse([{ id: 9, name: 'SCC Officer', role: 'scc_officer' }]);
    if (url === `/api/admin/reports/${report.id}` && options.method === 'PATCH') {
      report = { ...report, ...JSON.parse(options.body) };
      return jsonResponse(report);
    }
    if (url === `/api/admin/reports/${report.id}`) return jsonResponse(report);
    return jsonResponse({ message: `Unexpected request: ${url}` });
  });
  return () => report;
}

async function openReport(user) {
  await screen.findByText(initialReport.report_code);
  await user.click(screen.getByText(initialReport.report_code));
  return screen.findByRole('dialog', { name: /Water & drainage/ });
}

describe('admin report management', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', class {
      close() {}
    });
    mockAdminApi();
  });

  it('explains why report controls are unavailable to the read-only demo account', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(<AdminDashboard user={{ name: 'Demo Viewer', role: 'viewer' }} onLogout={onLogout} />);
    await openReport(user);

    expect(screen.getByText('Read-only demo account').closest('.admin-readonly-notice')).toHaveTextContent('sign in with the SCC staff email and password configured in Render');
    expect(screen.getByRole('button', { name: /Sign out to switch account/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept \/ acknowledge report/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Public response')).toBeDisabled();
    expect(screen.getByLabelText('Estimated due date')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Sign out and switch to SCC staff' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('allows staff to enter and save public responses and due dates', async () => {
    const getReport = mockAdminApi();
    const user = userEvent.setup();
    render(<AdminDashboard user={{ name: 'SCC Officer', role: 'scc_officer' }} onLogout={vi.fn()} />);
    await openReport(user);

    const responseInput = screen.getByLabelText('Public response');
    const dueDateInput = screen.getByLabelText('Estimated due date');
    await user.type(responseInput, 'Our water team has been assigned to repair the leak.');
    await user.type(dueDateInput, '2026-11-02');
    expect(responseInput).toHaveValue('Our water team has been assigned to repair the leak.');
    expect(dueDateInput).toHaveValue('2026-11-02');

    await user.click(screen.getByRole('button', { name: 'Save report updates' }));
    await waitFor(() => expect(getReport().public_response).toBe('Our water team has been assigned to repair the leak.'));
    expect(getReport().dueAt).toBe('2026-11-02');
    expect(await screen.findByRole('status')).toHaveTextContent('Report updates saved.');
    expect(screen.getByLabelText('Public response')).toHaveValue('Our water team has been assigned to repair the leak.');
  });

  it('provides an explicit accept action and moves submitted reports to acknowledged', async () => {
    const getReport = mockAdminApi();
    const user = userEvent.setup();
    render(<AdminDashboard user={{ name: 'SCC Officer', role: 'scc_officer' }} onLogout={vi.fn()} />);
    await openReport(user);

    await user.click(screen.getByRole('button', { name: 'Accept / acknowledge report' }));

    await waitFor(() => expect(getReport().status).toBe('acknowledged'));
    expect(await screen.findByRole('status')).toHaveTextContent('SCC-2026-000026 accepted and acknowledged.');
    expect(screen.getByLabelText('Status')).toHaveValue('acknowledged');
    expect(screen.queryByRole('button', { name: 'Accept / acknowledge report' })).not.toBeInTheDocument();
  });
});
