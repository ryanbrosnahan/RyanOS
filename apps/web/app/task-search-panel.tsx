"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { TaskSearchRecord } from "@ryanos/core";
import { apiFetch, apiPath } from "./api-client";

export function TaskRecord({ record }: { record: TaskSearchRecord }) {
  const { item, project, area } = record;
  return <article className="rounded border p-4 space-y-2">
    <h2 className="font-semibold"><a className="underline" href={record.href}>{item.title}</a></h2>
    <p>{item.status}{item.deletedAt ? " · Deleted" : ""} · {item.priority} · Project: {project?.name ?? "No project"}{project ? ` (${project.status})` : ""} · Area: {area?.name ?? "No area"}</p>
    <p className="text-xs">ID: {item.id} · Revision: {item.revision}</p>
    <p>Due: {item.dueAt ?? "None"} · Marked done: {item.completedAt ?? "No"}</p>
    <p className="whitespace-pre-wrap">{item.body ?? "No description"}</p>
  </article>;
}
export default function TaskSearchPanel({ id }: { id?: string }) {
  const [query,setQuery] = useState("");
  const [status,setStatus] = useState("");
  const [deleted,setDeleted] = useState(false);
  const [projectStatus,setProjectStatus] = useState("");
  const [records,setRecords] = useState<TaskSearchRecord[]>([]);
  const [error,setError] = useState("");
  const [offset,setOffset] = useState(0);
  const [busy,setBusy] = useState(true);
  async function load(nextOffset = 0) {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ query, includeDeleted: String(deleted), limit: "20", offset: String(nextOffset) });
      if(status) params.set("statuses",status);
      if(projectStatus) params.set("projectStatus",projectStatus);
      const response = await apiFetch(apiPath(id ? `/v1/task-search/${encodeURIComponent(id)}` : `/v1/task-search?${params}`));
      if(!response.ok) throw new Error(`Search returned ${response.status}`);
      const payload = await response.json() as { records?: TaskSearchRecord[]; record?: TaskSearchRecord };
      setRecords(payload.records ?? (payload.record ? [payload.record] : [])); setOffset(nextOffset);
    } catch(e) { setError(e instanceof Error ? e.message : "Search failed"); setRecords([]); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [id]);
  function submit(e: FormEvent) { e.preventDefault(); void load(); }
  return <section className="space-y-4">
    {!id && <form onSubmit={submit} className="flex flex-wrap gap-3">
      <label>Search title, description, project, area or ID<input className="block border p-2" value={query} onChange={e=>setQuery(e.target.value)} maxLength={500}/></label>
      <label>Status<select className="block border p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{["open","active","waiting","done","cancelled"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Project status<select className="block border p-2" value={projectStatus} onChange={e=>setProjectStatus(e.target.value)}><option value="">All projects</option><option>active</option><option>archived</option></select></label>
      <label><input type="checkbox" checked={deleted} onChange={e=>setDeleted(e.target.checked)}/> Include deleted items</label>
      <button className="border p-2" disabled={busy}>Search</button>
    </form>}
    <p>RyanOS status records what Ryan marked done. External observations do not independently verify completion.</p>
    {error && <p role="alert">{error}</p>}
    {busy ? <p>Loading…</p> : records.map(record=><TaskRecord key={record.item.id} record={record}/>)}
    {!busy && !error && !records.length && <p>No matching items.</p>}
    {!id && <nav aria-label="Search pages"><button disabled={busy || offset===0} onClick={()=>void load(Math.max(offset-20,0))}>Previous</button> · <button disabled={busy || records.length<20} onClick={()=>void load(offset+20)}>Next</button></nav>}
  </section>;
}
