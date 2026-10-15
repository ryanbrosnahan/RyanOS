import TaskSearchPanel from "../../task-search-panel";
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <main className="max-w-5xl mx-auto p-6 space-y-4"><a href="/tasks">Search all items</a><TaskSearchPanel id={id}/></main>; }
