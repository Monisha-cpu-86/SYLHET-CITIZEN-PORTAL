const adminClients = new Set();

export function addAdminClient(response) {
  adminClients.add(response);
  response.on('close', () => adminClients.delete(response));
}

export function publishReportEvent(event) {
  const message = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of adminClients) {
    if (client.writableEnded || client.destroyed) {
      adminClients.delete(client);
      continue;
    }
    client.write(message);
  }
}
