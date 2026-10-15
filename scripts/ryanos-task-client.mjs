// Secrets belong only in a trusted runtime's secret store; never in chat, source or command arguments.
export class RyanOSTaskClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    const base = new URL(baseUrl);
    if (base.username || base.password || base.search || base.hash ||
        !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))) {
      throw new Error('Use HTTPS or loopback HTTP without embedded credentials');
    }
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token ?? '')) throw new Error('Scoped credential required');
    this.base = base.href.replace(/\/$/, ''); this.token = token; this.fetch = fetchImpl;
  }
  async request(path, body) {
    let response;
    try { response = await this.fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }); } catch { throw new Error('RyanOS connection failed'); }
    if (!response.ok) throw new Error(`RyanOS request failed (${response.status})`);
    return response.json();
  }
  search({ query = '', statuses, includeDeleted = false, projectId, projectStatus, limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams({ query, includeDeleted: String(includeDeleted), limit: String(limit), offset: String(offset) });
    if (statuses) params.set('statuses', statuses.join(','));
    if (projectId) params.set('projectId', projectId);
    if (projectStatus) params.set('projectStatus', projectStatus);
    return this.request('/v1/task-integration/search?' + params);
  }
  readItem(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Item UUID required');
    return this.request('/v1/task-integration/items/' + encodeURIComponent(id));
  }
  readCapture(sourceId) { return this.request('/v1/task-integration/tasks?' + new URLSearchParams({ sourceId })); }
  capture(task) { return this.request('/v1/task-integration/tasks', task); }
  requestCompletion(request) { return this.request('/v1/task-integration/completion-requests', request); }
  // No complete/approve/delete/update method: owner decisions require Ryan's authenticated UI.
}
