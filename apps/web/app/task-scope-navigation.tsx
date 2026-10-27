"use client";

import { ClipboardList, Folder, FolderKanban } from "lucide-react";
import type { ReactNode } from "react";

type Scope = { id: string; name: string; icon?: string; color?: string };
type Project = Scope & { areaId?: string };

type Props = {
  areas: Scope[];
  projects: Project[];
  areaCounts: Map<string, number>;
  projectCounts: Map<string, number>;
  itemCount: number;
  unassignedCount: number;
  areaFilter: string;
  projectFilter: string;
  showEmptyProjects: boolean;
  onSelect: (areaId: string, projectId: string) => void;
  onShowEmptyProjects: (show: boolean) => void;
  renderAreaIcon: (area: Scope) => ReactNode;
};

function NavigationButton({ label, accessibleLabel, icon, count, selected, nested, onClick }: {
  label: string;
  accessibleLabel?: string;
  icon: ReactNode;
  count?: number;
  selected: boolean;
  nested?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md pr-2 text-left transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${
        nested ? "min-h-8 py-1 pl-7 text-xs" : "min-h-9 pl-2 text-sm"
      } ${selected ? "bg-sky-100 font-medium text-sky-900" : "text-stone-700"}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="text-xs text-stone-500 tabular-nums">{count}</span> : null}
    </button>
  );
}

export function TaskScopeNavigation(props: Props) {
  const visibleProject = (project: Project) =>
    props.showEmptyProjects || (props.projectCounts.get(project.id) ?? 0) > 0 || props.projectFilter === project.id;

  return (
    <aside className="hidden min-w-0 lg:block">
      <nav aria-label="Task areas and projects" className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-3 text-sm">
        <h2 className="mb-2 flex items-center gap-2 px-2 text-sm font-semibold text-stone-900">
          <Folder className="h-4 w-4 text-sky-700" aria-hidden="true" />Areas
        </h2>
        <NavigationButton
          label="All items" count={props.itemCount}
          icon={<ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />}
          selected={!props.areaFilter && !props.projectFilter}
          onClick={() => props.onSelect("", "")}
        />
        {props.areas.map((area) => (
          <div key={area.id}>
            <NavigationButton
              label={area.name} accessibleLabel={`Filter area: ${area.name}`}
              icon={props.renderAreaIcon(area)} count={props.areaCounts.get(area.id) ?? 0}
              selected={props.areaFilter === area.id && !props.projectFilter}
              onClick={() => props.onSelect(area.id, "")}
            />
            {props.projects.filter((project) => project.areaId === area.id && visibleProject(project)).map((project) => (
              <NavigationButton
                key={project.id} label={project.name} nested
                accessibleLabel={`Filter project: ${project.name} in ${area.name}`}
                icon={<FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                count={props.projectCounts.get(project.id) ?? 0}
                selected={props.projectFilter === project.id}
                onClick={() => props.onSelect(area.id, project.id)}
              />
            ))}
          </div>
        ))}
        <NavigationButton
          label="No area" count={props.unassignedCount}
          icon={<Folder className="h-4 w-4 shrink-0" aria-hidden="true" />}
          selected={props.areaFilter === "unassigned"}
          onClick={() => props.onSelect("unassigned", "")}
        />
        <div className="mt-3 border-t border-stone-200 pt-3">
          <h2 className="mb-1 flex items-center gap-2 px-2 text-sm font-semibold text-stone-900">
            <FolderKanban className="h-4 w-4 text-sky-700" aria-hidden="true" />Projects
          </h2>
          <NavigationButton
            label="All projects" icon={<Folder className="h-4 w-4 shrink-0" aria-hidden="true" />}
            selected={!props.projectFilter && !!props.areaFilter} onClick={() => props.onSelect(props.areaFilter, "")}
          />
          {props.projects.filter((project) => project.areaId === undefined && visibleProject(project)).map((project) => (
            <NavigationButton
              key={project.id} label={project.name} accessibleLabel={`Filter project: ${project.name}`}
              icon={<FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              count={props.projectCounts.get(project.id) ?? 0} selected={props.projectFilter === project.id}
              onClick={() => props.onSelect("", project.id)}
            />
          ))}
          <NavigationButton
            label="No project" icon={<FolderKanban className="h-4 w-4 shrink-0" aria-hidden="true" />}
            selected={props.projectFilter === "unassigned"}
            onClick={() => props.onSelect(props.areaFilter, "unassigned")}
          />
          <label className="mt-2 flex min-h-8 cursor-pointer items-center gap-2 px-2 text-xs text-stone-600">
            <input type="checkbox" checked={props.showEmptyProjects} onChange={(event) => props.onShowEmptyProjects(event.target.checked)} className="accent-sky-700" />
            Show empty projects
          </label>
        </div>
      </nav>
    </aside>
  );
}
