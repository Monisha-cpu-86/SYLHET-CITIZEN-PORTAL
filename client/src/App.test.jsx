import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

vi.mock('./components/LocationMap.jsx', () => ({
  LocationMap: ({ onChange }) => (
    <button type="button" onClick={() => onChange({ latitude: 24.89, longitude: 91.87 })}>
      Set test pin
    </button>
  ),
}));

vi.mock('./components/AdminDashboard.jsx', () => ({ default: () => null }));

const currentUser = {
  id: 1,
  name: 'Demo User',
  email: 'demo@example.com',
  role: 'citizen',
};

const report = {
  id: 41,
  report_code: 'SCC-2026-000041',
  type: 'Roads',
  ward: 'Ward 1',
  description: 'A large pothole is blocking the street.',
  priority: 'normal',
  status: 'submitted',
  photos: [],
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockAuthenticatedApi({ submitResponse = report, onSubmit } = {}) {
  let reports = [];
  globalThis.fetch = vi.fn(async (path, options = {}) => {
    const url = String(path);
    if (url === '/api/auth/me') return jsonResponse(currentUser);
    if (url === '/api/complaints/notifications') return jsonResponse([]);
    if (url === '/api/complaints' && options.method === 'POST') {
      onSubmit?.(options);
      if (submitResponse instanceof Response) return submitResponse;
      reports = [submitResponse];
      return jsonResponse(submitResponse);
    }
    if (url === '/api/complaints') return jsonResponse({ items: reports });
    return jsonResponse({ message: 'Unexpected request' }, 404);
  });
  return globalThis.fetch;
}

async function renderDashboard() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: 'Report an issue' });
  return user;
}

async function fillValidReport(user) {
  await user.selectOptions(screen.getByLabelText(/Issue category/), 'Roads');
  await user.selectOptions(screen.getByLabelText(/Ward \/ Area/), 'Ward 1');
  await user.type(screen.getByLabelText(/Describe the issue/), report.description);
  await user.click(screen.getByRole('checkbox'));
}

describe('citizen report submission', () => {
  beforeEach(() => {
    mockAuthenticatedApi();
  });

  it('shows missing-location validation beside Submit and focuses the first invalid field', async () => {
    const user = await renderDashboard();
    await user.selectOptions(screen.getByLabelText(/Issue category/), 'Roads');
    await user.selectOptions(screen.getByLabelText(/Ward \/ Area/), 'Ward 1');
    await user.type(screen.getByLabelText(/Describe the issue/), report.description);
    await user.click(screen.getByRole('button', { name: /Submit report/ }));

    const map = screen.getByRole('group', { name: 'Issue map location' });
    const summary = screen.getByText('Please fix these items before submitting:').closest('.field-error-summary');
    const submit = screen.getByRole('button', { name: /Submit report/ });
    expect(map).toHaveAttribute('aria-invalid', 'true');
    expect(summary).toHaveTextContent('Pin the issue on the map or choose not to share your location.');
    expect(summary.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(map).toHaveFocus());
    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/complaints', expect.objectContaining({ method: 'POST' }));
  });

  it('submits a report, resets the form and refreshes the report list and counters', async () => {
    const user = await renderDashboard();
    localStorage.setItem('civicpulse-report-draft', JSON.stringify({ complaintForm: { description: 'Saved draft' } }));
    await fillValidReport(user);
    await user.click(screen.getByRole('button', { name: /Submit report/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('SCC-2026-000041 submitted successfully.');
    expect(await screen.findByText('SCC-2026-000041')).toBeInTheDocument();
    expect(screen.getByText('Total reports').parentElement).toHaveTextContent('1');
    expect(screen.getByLabelText(/Issue category/)).toHaveValue('');
    expect(screen.getByLabelText(/Ward \/ Area/)).toHaveValue('');
    expect(screen.getByLabelText(/Describe the issue/)).toHaveValue('');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(localStorage.getItem('civicpulse-report-draft')).toBeNull();
    expect(screen.getByRole('button', { name: /Submit report/ })).toBeEnabled();
    expect(globalThis.fetch.mock.calls.filter(([url, options]) => url === '/api/complaints' && options?.method !== 'POST')).toHaveLength(2);
  });

  it('shows server errors and re-enables Submit', async () => {
    mockAuthenticatedApi({ submitResponse: jsonResponse({ message: 'Database is temporarily unavailable.' }, 500) });
    const user = await renderDashboard();
    await fillValidReport(user);
    await user.click(screen.getByRole('button', { name: /Submit report/ }));

    expect(await screen.findByText('Database is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit report/ })).toBeEnabled();
  });

  it('includes a selected compressed photo in the multipart report request', async () => {
    const submittedOptions = vi.fn();
    mockAuthenticatedApi({ onSubmit: submittedOptions });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 20, height: 20, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['compressed image'], { type: 'image/webp' }));
    });
    const user = await renderDashboard();
    await fillValidReport(user);
    const photo = new File(['source image'], 'issue.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/Photos/), photo);
    await screen.findByAltText('Selected report photo 1');
    await user.click(screen.getByRole('button', { name: /Submit report/ }));

    await screen.findByText('Report SCC-2026-000041 submitted successfully.');
    const body = submittedOptions.mock.calls[0][0].body;
    expect(body.getAll('photos')).toHaveLength(1);
    expect(body.get('photos').type).toBe('image/webp');
  });

  it('clears auth state and shows an expiry message when an authenticated request returns 401', async () => {
    localStorage.setItem('civicpulse-session-active', 'true');
    globalThis.fetch = vi.fn(async (path) => {
      if (path === '/api/auth/me') return jsonResponse(currentUser);
      if (path === '/api/complaints') return jsonResponse({ message: 'Unauthorized' }, 401);
      if (path === '/api/complaints/notifications') return jsonResponse([]);
      return jsonResponse({});
    });
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session expired. Please sign in again.');
    expect(localStorage.getItem('civicpulse-session-active')).toBeNull();
  });
});
