import { createId, nowIso } from "@ryanos/shared";
import type { JsonObject, UUID } from "@ryanos/shared";
import type {
  EmailActionProposalListFilters,
  EmailActionProposalPatch,
  EmailActionProposalUpsertData,
  ExternalSourceUpsertData,
  AreaUpsertData,
  DailyPlanUpsertData,
  ItemCreateData,
  ItemListFilters,
  ItemPatch,
  PolicyUpsertData,
  ProviderAccountPatch,
  ProviderAccountUpsertData,
  ProjectUpsertData,
  RyanStore,
  SearchMatch,
  ShoppingCatalogListFilters,
  ShoppingCatalogUpsertData,
  ShoppingItemCreateData,
  ShoppingItemListFilters,
  ShoppingItemPatch
} from "./store.js";
import type {
  AuditLog,
  Area,
  DailyPlan,
  EmailActionProposal,
  ExternalSource,
  Item,
  ItemEvent,
  Policy,
  ProviderAccount,
  Project,
  RecurrenceEvent,
  RecurrencePolicy,
  RecurrenceState,
  ShoppingCatalogItem,
  ShoppingList,
  ShoppingListItem,
  SourceLink
} from "./types.js";

function cleanQuery(value: string): string {
  return value.trim().toLowerCase();
}

export class InMemoryRyanStore implements RyanStore {
  readonly areas = new Map<UUID, Area>();
  readonly projects = new Map<UUID, Project>();
  readonly items = new Map<UUID, Item>();
  readonly itemEvents: ItemEvent[] = [];
  readonly recurrencePolicies = new Map<UUID, RecurrencePolicy>();
  readonly recurrenceEvents: RecurrenceEvent[] = [];
  readonly recurrenceStates = new Map<UUID, RecurrenceState>();
  readonly policies = new Map<UUID, Policy>();
  readonly dailyPlans = new Map<UUID, DailyPlan>();
  readonly providerAccounts = new Map<UUID, ProviderAccount>();
  readonly externalSources = new Map<UUID, ExternalSource>();
  readonly sourceLinks: SourceLink[] = [];
  readonly emailActionProposals = new Map<UUID, EmailActionProposal>();
  readonly shoppingLists = new Map<UUID, ShoppingList>();
  readonly shoppingListItems = new Map<UUID, ShoppingListItem>();
  readonly shoppingCatalogItems = new Map<UUID, ShoppingCatalogItem>();
  readonly auditLogs: AuditLog[] = [];

  async upsertArea(data: AreaUpsertData): Promise<Area> {
    const timestamp = nowIso();
    const existing = [...this.areas.values()].find(
      (area) =>
        area.userId === data.userId &&
        cleanQuery(area.name) === cleanQuery(data.name) &&
        !area.deletedAt
    );
    const area: Area = {
      ...existing,
      id: existing?.id ?? createId("area"),
      userId: data.userId,
      name: data.name,
      status: data.status ?? existing?.status ?? "active",
      sortOrder: data.sortOrder ?? existing?.sortOrder ?? 0,
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.description !== undefined) area.description = data.description;
    else if (existing?.description !== undefined) area.description = existing.description;
    this.areas.set(area.id, area);
    return area;
  }

  async listAreas(userId: UUID): Promise<Area[]> {
    return [...this.areas.values()]
      .filter((area) => area.userId === userId && !area.deletedAt)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
  }

  async searchAreas(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Area>>> {
    const needle = cleanQuery(query);
    return [...this.areas.values()]
      .filter((area) => area.userId === userId && !area.deletedAt)
      .map((area) => {
        const name = cleanQuery(area.name);
        let confidence = 0;
        let reason = "No match";
        if (area.id === query) {
          confidence = 1;
          reason = "Exact id match";
        } else if (name === needle) {
          confidence = 0.98;
          reason = "Exact name match";
        } else if (name.includes(needle) || needle.includes(name)) {
          confidence = 0.82;
          reason = "Name contains query";
        }
        return { record: area, confidence, reason };
      })
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getArea(areaId: UUID): Promise<Area | undefined> {
    return this.areas.get(areaId);
  }

  async upsertProject(data: ProjectUpsertData): Promise<Project> {
    const timestamp = nowIso();
    const existing = [...this.projects.values()].find(
      (project) =>
        project.userId === data.userId &&
        cleanQuery(project.name) === cleanQuery(data.name) &&
        (data.areaId === undefined || project.areaId === undefined || project.areaId === data.areaId) &&
        !project.deletedAt
    );
    const project: Project = {
      ...existing,
      id: existing?.id ?? createId("project"),
      userId: data.userId,
      name: data.name,
      status: data.status ?? existing?.status ?? "active",
      priority: data.priority ?? existing?.priority ?? "normal",
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.areaId !== undefined) project.areaId = data.areaId;
    else if (existing?.areaId !== undefined) project.areaId = existing.areaId;
    if (data.description !== undefined) project.description = data.description;
    else if (existing?.description !== undefined) project.description = existing.description;
    if (data.dueAt !== undefined) project.dueAt = data.dueAt;
    else if (existing?.dueAt !== undefined) project.dueAt = existing.dueAt;
    if (data.reviewAfter !== undefined) project.reviewAfter = data.reviewAfter;
    else if (existing?.reviewAfter !== undefined) project.reviewAfter = existing.reviewAfter;
    this.projects.set(project.id, project);
    return project;
  }

  async listProjects(filters: { userId: UUID; areaId?: UUID; limit?: number }): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((project) => {
        if (project.userId !== filters.userId || project.deletedAt) return false;
        return filters.areaId === undefined || project.areaId === filters.areaId;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, Math.min(Math.max(filters.limit ?? 100, 1), 200));
  }

  async searchProjects(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Project>>> {
    const needle = cleanQuery(query);
    return [...this.projects.values()]
      .filter((project) => project.userId === userId && !project.deletedAt)
      .map((project) => {
        const name = cleanQuery(project.name);
        let confidence = 0;
        let reason = "No match";
        if (project.id === query) {
          confidence = 1;
          reason = "Exact id match";
        } else if (name === needle) {
          confidence = 0.98;
          reason = "Exact name match";
        } else if (name.includes(needle) || needle.includes(name)) {
          confidence = 0.82;
          reason = "Name contains query";
        }
        return { record: project, confidence, reason };
      })
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  async getProject(projectId: UUID): Promise<Project | undefined> {
    return this.projects.get(projectId);
  }

  async createItem(data: ItemCreateData): Promise<Item> {
    const timestamp = nowIso();
    const item: Item = {
      id: createId("item"),
      userId: data.userId,
      kind: data.kind,
      title: data.title,
      status: "open",
      priority: data.priority ?? "normal",
      revision: 1,
      metadata: data.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (data.body !== undefined) item.body = data.body;
    if (data.areaId !== undefined) item.areaId = data.areaId;
    if (data.projectId !== undefined) item.projectId = data.projectId;
    if (data.dueAt !== undefined) item.dueAt = data.dueAt;
    if (data.startAt !== undefined) item.startAt = data.startAt;
    if (data.estimateMinutes !== undefined) item.estimateMinutes = data.estimateMinutes;
    this.items.set(item.id, item);
    return item;
  }

  async updateItem(itemId: UUID, patch: ItemPatch): Promise<Item> {
    const item = this.items.get(itemId);
    if (!item) {
      throw new Error(`Item not found: ${itemId}`);
    }
    const updated: Item = {
      ...item,
      revision: item.revision + 1,
      updatedAt: nowIso()
    };
    if (patch.kind !== undefined) updated.kind = patch.kind;
    if (patch.title !== undefined) updated.title = patch.title;
    if (patch.body !== undefined) updated.body = patch.body;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.priority !== undefined) updated.priority = patch.priority;
    if (patch.metadata !== undefined) updated.metadata = patch.metadata;
    if (patch.estimateMinutes !== undefined) updated.estimateMinutes = patch.estimateMinutes;
    if (patch.areaId !== undefined) {
      if (patch.areaId === null) delete updated.areaId;
      else updated.areaId = patch.areaId;
    }
    if (patch.projectId !== undefined) {
      if (patch.projectId === null) delete updated.projectId;
      else updated.projectId = patch.projectId;
    }
    if (patch.dueAt !== undefined) {
      if (patch.dueAt === null) delete updated.dueAt;
      else updated.dueAt = patch.dueAt;
    }
    if (patch.startAt !== undefined) {
      if (patch.startAt === null) delete updated.startAt;
      else updated.startAt = patch.startAt;
    }
    if (patch.snoozedUntil !== undefined) {
      if (patch.snoozedUntil === null) delete updated.snoozedUntil;
      else updated.snoozedUntil = patch.snoozedUntil;
    }
    if (patch.starredAt !== undefined) {
      if (patch.starredAt === null) delete updated.starredAt;
      else updated.starredAt = patch.starredAt;
    }
    if (patch.completedAt !== undefined) {
      if (patch.completedAt === null) delete updated.completedAt;
      else updated.completedAt = patch.completedAt;
    }
    if (patch.cancelledAt !== undefined) {
      if (patch.cancelledAt === null) delete updated.cancelledAt;
      else updated.cancelledAt = patch.cancelledAt;
    }
    this.items.set(itemId, updated);
    return updated;
  }

  async listItems(filters: ItemListFilters): Promise<Item[]> {
    const statuses = filters.statuses ?? ["open", "active", "waiting"];
    return [...this.items.values()]
      .filter(
        (item) => {
          if (item.userId !== filters.userId || item.deletedAt) return false;
          if (statuses.includes(item.status)) return true;
          if (item.status !== "done" || !item.completedAt || !filters.completedAfter) return false;
          if (item.completedAt < filters.completedAfter) return false;
          return filters.completedBefore === undefined || item.completedAt < filters.completedBefore;
        }
      )
      .sort((a, b) => {
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        if (a.starredAt !== undefined && b.starredAt === undefined) return -1;
        if (a.starredAt === undefined && b.starredAt !== undefined) return 1;
        if (a.starredAt !== undefined && b.starredAt !== undefined && a.starredAt !== b.starredAt) {
          return b.starredAt.localeCompare(a.starredAt);
        }
        const aDue = a.dueAt ?? "9999-12-31T23:59:59.999Z";
        const bDue = b.dueAt ?? "9999-12-31T23:59:59.999Z";
        if (aDue !== bDue) return aDue.localeCompare(bDue);
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, Math.min(Math.max(filters.limit ?? 30, 1), 100));
  }

  async searchItems(
    userId: UUID,
    query: string,
    limit = 5
  ): Promise<Array<SearchMatch<Item>>> {
    const needle = cleanQuery(query);
    const matches = [...this.items.values()]
      .filter((item) => item.userId === userId && !item.deletedAt)
      .map((item) => {
        const title = cleanQuery(item.title);
        let confidence = 0;
        let reason = "No match";
        if (item.id === query) {
          confidence = 1;
          reason = "Exact id match";
        } else if (title === needle) {
          confidence = 0.98;
          reason = "Exact title match";
        } else if (title.includes(needle) || needle.includes(title)) {
          confidence = 0.82;
          reason = "Title contains query";
        }
        return { record: item, confidence, reason };
      })
      .filter((match) => match.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    return matches;
  }

  async getItem(itemId: UUID): Promise<Item | undefined> {
    return this.items.get(itemId);
  }

  async addItemEvent(event: Omit<ItemEvent, "id" | "createdAt">): Promise<ItemEvent> {
    const created: ItemEvent = {
      ...event,
      id: createId("item_event"),
      createdAt: nowIso()
    };
    this.itemEvents.push(created);
    return created;
  }

  async findItemEventByIdempotencyKey(
    userId: UUID,
    key: string
  ): Promise<ItemEvent | undefined> {
    return this.itemEvents.find(
      (event) => event.userId === userId && event.idempotencyKey === key
    );
  }

  async upsertRecurrencePolicy(
    policy: Omit<RecurrencePolicy, "id" | "createdAt" | "updatedAt">
  ): Promise<RecurrencePolicy> {
    const existing = [...this.recurrencePolicies.values()].find(
      (candidate) => candidate.itemId === policy.itemId && candidate.userId === policy.userId
    );
    const timestamp = nowIso();
    const stored: RecurrencePolicy = {
      ...existing,
      ...policy,
      id: existing?.id ?? createId("recurrence"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.recurrencePolicies.set(stored.id, stored);
    return stored;
  }

  async findRecurrencePolicyForItem(itemId: UUID): Promise<RecurrencePolicy | undefined> {
    return [...this.recurrencePolicies.values()].find(
      (policy) => policy.itemId === itemId && policy.status === "active"
    );
  }

  async addRecurrenceEvent(
    event: Omit<RecurrenceEvent, "id" | "createdAt">
  ): Promise<RecurrenceEvent> {
    const created: RecurrenceEvent = {
      ...event,
      id: createId("recurrence_event"),
      createdAt: nowIso()
    };
    this.recurrenceEvents.push(created);
    return created;
  }

  async listRecurrenceEvents(policyId: UUID): Promise<RecurrenceEvent[]> {
    return this.recurrenceEvents.filter((event) => event.recurrencePolicyId === policyId);
  }

  async updateRecurrenceState(state: RecurrenceState): Promise<RecurrenceState> {
    this.recurrenceStates.set(state.recurrencePolicyId, state);
    return state;
  }

  async getRecurrenceState(policyId: UUID): Promise<RecurrenceState | undefined> {
    return this.recurrenceStates.get(policyId);
  }

  async upsertPolicy(policy: PolicyUpsertData): Promise<Policy> {
    const existing = [...this.policies.values()].find(
      (candidate) =>
        candidate.userId === policy.userId &&
        candidate.type === policy.type &&
        candidate.scope === policy.scope &&
        candidate.scopeRef === policy.scopeRef &&
        !candidate.deletedAt
    );
    const timestamp = nowIso();
    const stored: Policy = {
      ...existing,
      ...policy,
      id: existing?.id ?? createId("policy"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.policies.set(stored.id, stored);
    return stored;
  }

  async getDailyPlan(userId: UUID, dateKey: string): Promise<DailyPlan | undefined> {
    return [...this.dailyPlans.values()].find(
      (plan) => plan.userId === userId && plan.dateKey === dateKey && !plan.deletedAt
    );
  }

  async listDailyPlans(filters: { userId: UUID; beforeDateKey?: string; limit?: number }): Promise<DailyPlan[]> {
    return [...this.dailyPlans.values()]
      .filter((plan) => {
        if (plan.userId !== filters.userId || plan.deletedAt) return false;
        return filters.beforeDateKey === undefined || plan.dateKey < filters.beforeDateKey;
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      .slice(0, Math.min(Math.max(filters.limit ?? 7, 1), 30));
  }

  async upsertDailyPlan(plan: DailyPlanUpsertData): Promise<DailyPlan> {
    const existing = await this.getDailyPlan(plan.userId, plan.dateKey);
    const timestamp = nowIso();
    const stored: DailyPlan = {
      ...existing,
      ...plan,
      id: existing?.id ?? createId("daily_plan"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.dailyPlans.set(stored.id, stored);
    return stored;
  }

  async upsertProviderAccount(data: ProviderAccountUpsertData): Promise<ProviderAccount> {
    const timestamp = nowIso();
    const existing = [...this.providerAccounts.values()].find(
      (account) =>
        account.provider === data.provider &&
        account.externalAccountId === data.externalAccountId &&
        !account.deletedAt
    );
    const account: ProviderAccount = {
      ...existing,
      id: existing?.id ?? createId("provider_account"),
      userId: data.userId,
      provider: data.provider,
      status: data.status ?? existing?.status ?? "active",
      scopes: data.scopes ?? existing?.scopes ?? [],
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.externalAccountId !== undefined) account.externalAccountId = data.externalAccountId;
    else if (existing?.externalAccountId !== undefined) account.externalAccountId = existing.externalAccountId;
    if (data.displayName !== undefined) account.displayName = data.displayName;
    else if (existing?.displayName !== undefined) account.displayName = existing.displayName;
    if (data.email !== undefined) account.email = data.email;
    else if (existing?.email !== undefined) account.email = existing.email;
    this.providerAccounts.set(account.id, account);
    return account;
  }

  async listProviderAccounts(filters: { userId: UUID; provider?: string; limit?: number }): Promise<ProviderAccount[]> {
    return [...this.providerAccounts.values()]
      .filter((account) => {
        if (account.userId !== filters.userId || account.deletedAt) return false;
        return filters.provider === undefined || account.provider === filters.provider;
      })
      .sort((a, b) => {
        const aName = a.displayName ?? a.email ?? a.externalAccountId ?? a.id;
        const bName = b.displayName ?? b.email ?? b.externalAccountId ?? b.id;
        return aName.localeCompare(bName);
      })
      .slice(0, Math.min(Math.max(filters.limit ?? 100, 1), 200));
  }

  async getProviderAccount(accountId: UUID): Promise<ProviderAccount | undefined> {
    return this.providerAccounts.get(accountId);
  }

  async updateProviderAccount(accountId: UUID, patch: ProviderAccountPatch): Promise<ProviderAccount> {
    const existing = this.providerAccounts.get(accountId);
    if (!existing) throw new Error(`Provider account not found: ${accountId}`);
    const updated: ProviderAccount = {
      ...existing,
      updatedAt: nowIso()
    };
    if (patch.externalAccountId !== undefined) {
      if (patch.externalAccountId === null) delete updated.externalAccountId;
      else updated.externalAccountId = patch.externalAccountId;
    }
    if (patch.displayName !== undefined) updated.displayName = patch.displayName;
    if (patch.email !== undefined) updated.email = patch.email;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.scopes !== undefined) updated.scopes = patch.scopes;
    if (patch.metadata !== undefined) updated.metadata = patch.metadata;
    this.providerAccounts.set(accountId, updated);
    return updated;
  }

  async upsertExternalSource(data: ExternalSourceUpsertData): Promise<ExternalSource> {
    const timestamp = nowIso();
    const existing = [...this.externalSources.values()].find(
      (source) =>
        source.provider === data.provider &&
        source.providerAccountId === data.providerAccountId &&
        source.externalId === data.externalId &&
        !source.deletedAt
    );
    const source: ExternalSource = {
      ...existing,
      id: existing?.id ?? createId("external_source"),
      userId: data.userId,
      provider: data.provider,
      retentionClass: data.retentionClass ?? existing?.retentionClass ?? "summary",
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.providerAccountId !== undefined) source.providerAccountId = data.providerAccountId;
    else if (existing?.providerAccountId !== undefined) source.providerAccountId = existing.providerAccountId;
    if (data.externalId !== undefined) source.externalId = data.externalId;
    else if (existing?.externalId !== undefined) source.externalId = existing.externalId;
    if (data.url !== undefined) source.url = data.url;
    else if (existing?.url !== undefined) source.url = existing.url;
    if (data.title !== undefined) source.title = data.title;
    else if (existing?.title !== undefined) source.title = existing.title;
    if (data.summary !== undefined) source.summary = data.summary;
    else if (existing?.summary !== undefined) source.summary = existing.summary;
    if (data.occurredAt !== undefined) source.occurredAt = data.occurredAt;
    else if (existing?.occurredAt !== undefined) source.occurredAt = existing.occurredAt;
    if (data.rawPayloadExpiresAt !== undefined) source.rawPayloadExpiresAt = data.rawPayloadExpiresAt;
    else if (existing?.rawPayloadExpiresAt !== undefined) source.rawPayloadExpiresAt = existing.rawPayloadExpiresAt;
    this.externalSources.set(source.id, source);
    return source;
  }

  async getExternalSource(sourceId: UUID): Promise<ExternalSource | undefined> {
    return this.externalSources.get(sourceId);
  }

  async addSourceLink(link: Omit<SourceLink, "id" | "createdAt">): Promise<SourceLink> {
    const existing = this.sourceLinks.find(
      (candidate) =>
        candidate.userId === link.userId &&
        candidate.sourceId === link.sourceId &&
        candidate.targetType === link.targetType &&
        candidate.targetId === link.targetId &&
        candidate.relation === link.relation
    );
    if (existing) return existing;
    const created: SourceLink = {
      ...link,
      id: createId("source_link"),
      createdAt: nowIso()
    };
    this.sourceLinks.push(created);
    return created;
  }

  async upsertEmailActionProposal(data: EmailActionProposalUpsertData): Promise<EmailActionProposal> {
    const timestamp = nowIso();
    const existing = [...this.emailActionProposals.values()].find(
      (proposal) => proposal.idempotencyKey === data.idempotencyKey && !proposal.deletedAt
    );
    const proposal: EmailActionProposal = {
      ...existing,
      id: existing?.id ?? createId("email_proposal"),
      userId: data.userId,
      sourceId: data.sourceId,
      idempotencyKey: data.idempotencyKey,
      actionType: data.actionType,
      status: data.status ?? existing?.status ?? "proposed",
      title: data.title,
      priority: data.priority ?? existing?.priority ?? "normal",
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.providerAccountId !== undefined) proposal.providerAccountId = data.providerAccountId;
    else if (existing?.providerAccountId !== undefined) proposal.providerAccountId = existing.providerAccountId;
    if (data.body !== undefined) proposal.body = data.body;
    else if (existing?.body !== undefined) proposal.body = existing.body;
    if (data.dueAt !== undefined) proposal.dueAt = data.dueAt;
    else if (existing?.dueAt !== undefined) proposal.dueAt = existing.dueAt;
    if (data.draftReplyText !== undefined) proposal.draftReplyText = data.draftReplyText;
    else if (existing?.draftReplyText !== undefined) proposal.draftReplyText = existing.draftReplyText;
    if (data.rationale !== undefined) proposal.rationale = data.rationale;
    else if (existing?.rationale !== undefined) proposal.rationale = existing.rationale;
    if (data.confidence !== undefined) proposal.confidence = data.confidence;
    else if (existing?.confidence !== undefined) proposal.confidence = existing.confidence;
    if (data.acceptedItemId !== undefined) proposal.acceptedItemId = data.acceptedItemId;
    else if (existing?.acceptedItemId !== undefined) proposal.acceptedItemId = existing.acceptedItemId;
    if (data.acceptedAt !== undefined) proposal.acceptedAt = data.acceptedAt;
    else if (existing?.acceptedAt !== undefined) proposal.acceptedAt = existing.acceptedAt;
    if (data.rejectedAt !== undefined) proposal.rejectedAt = data.rejectedAt;
    else if (existing?.rejectedAt !== undefined) proposal.rejectedAt = existing.rejectedAt;
    this.emailActionProposals.set(proposal.id, proposal);
    return proposal;
  }

  async listEmailActionProposals(filters: EmailActionProposalListFilters): Promise<EmailActionProposal[]> {
    return [...this.emailActionProposals.values()]
      .filter((proposal) => {
        if (proposal.userId !== filters.userId || proposal.deletedAt) return false;
        if (filters.status !== undefined && proposal.status !== filters.status) return false;
        return filters.providerAccountId === undefined || proposal.providerAccountId === filters.providerAccountId;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(filters.limit ?? 50, 1), 200));
  }

  async getEmailActionProposal(proposalId: UUID): Promise<EmailActionProposal | undefined> {
    return this.emailActionProposals.get(proposalId);
  }

  async updateEmailActionProposal(proposalId: UUID, patch: EmailActionProposalPatch): Promise<EmailActionProposal> {
    const existing = this.emailActionProposals.get(proposalId);
    if (!existing) throw new Error(`Email action proposal not found: ${proposalId}`);
    const updated: EmailActionProposal = {
      ...existing,
      updatedAt: nowIso()
    };
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.title !== undefined) updated.title = patch.title;
    if (patch.body !== undefined) updated.body = patch.body;
    if (patch.priority !== undefined) updated.priority = patch.priority;
    if (patch.draftReplyText !== undefined) updated.draftReplyText = patch.draftReplyText;
    if (patch.rationale !== undefined) updated.rationale = patch.rationale;
    if (patch.confidence !== undefined) updated.confidence = patch.confidence;
    if (patch.acceptedItemId !== undefined) updated.acceptedItemId = patch.acceptedItemId;
    if (patch.metadata !== undefined) updated.metadata = patch.metadata;
    if (patch.dueAt !== undefined) {
      if (patch.dueAt === null) delete updated.dueAt;
      else updated.dueAt = patch.dueAt;
    }
    if (patch.acceptedAt !== undefined) {
      if (patch.acceptedAt === null) delete updated.acceptedAt;
      else updated.acceptedAt = patch.acceptedAt;
    }
    if (patch.rejectedAt !== undefined) {
      if (patch.rejectedAt === null) delete updated.rejectedAt;
      else updated.rejectedAt = patch.rejectedAt;
    }
    this.emailActionProposals.set(proposalId, updated);
    return updated;
  }

  async getDefaultShoppingList(userId: UUID): Promise<ShoppingList> {
    const existing = [...this.shoppingLists.values()].find(
      (list) => list.userId === userId && cleanQuery(list.name) === "shopping" && !list.deletedAt
    );
    if (existing) return existing;
    const timestamp = nowIso();
    const list: ShoppingList = {
      id: createId("shopping_list"),
      userId,
      name: "Shopping",
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.shoppingLists.set(list.id, list);
    return list;
  }

  async createShoppingItem(data: ShoppingItemCreateData): Promise<ShoppingListItem> {
    const timestamp = nowIso();
    const item: ShoppingListItem = {
      id: createId("shopping_item"),
      userId: data.userId,
      listId: data.listId,
      name: data.name,
      normalizedName: data.normalizedName,
      category: data.category ?? "miscellaneous",
      source: data.source ?? "manual",
      sortOrder: data.sortOrder ?? 0,
      metadata: data.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (data.catalogItemId !== undefined) item.catalogItemId = data.catalogItemId;
    if (data.quantity !== undefined) item.quantity = data.quantity;
    if (data.note !== undefined) item.note = data.note;
    if (data.checkedAt !== undefined) item.checkedAt = data.checkedAt;
    this.shoppingListItems.set(item.id, item);
    return item;
  }

  async updateShoppingItem(itemId: UUID, patch: ShoppingItemPatch): Promise<ShoppingListItem> {
    const existing = this.shoppingListItems.get(itemId);
    if (!existing) throw new Error(`Shopping item not found: ${itemId}`);
    const updated: ShoppingListItem = {
      ...existing,
      updatedAt: nowIso()
    };
    if (patch.name !== undefined) updated.name = patch.name;
    if (patch.normalizedName !== undefined) updated.normalizedName = patch.normalizedName;
    if (patch.category !== undefined) updated.category = patch.category;
    if (patch.quantity !== undefined) {
      if (patch.quantity === null) delete updated.quantity;
      else updated.quantity = patch.quantity;
    }
    if (patch.note !== undefined) {
      if (patch.note === null) delete updated.note;
      else updated.note = patch.note;
    }
    if (patch.source !== undefined) updated.source = patch.source;
    if (patch.sortOrder !== undefined) updated.sortOrder = patch.sortOrder;
    if (patch.metadata !== undefined) updated.metadata = patch.metadata;
    if (patch.catalogItemId !== undefined) {
      if (patch.catalogItemId === null) delete updated.catalogItemId;
      else updated.catalogItemId = patch.catalogItemId;
    }
    if (patch.checkedAt !== undefined) {
      if (patch.checkedAt === null) delete updated.checkedAt;
      else updated.checkedAt = patch.checkedAt;
    }
    if (patch.deletedAt !== undefined) {
      if (patch.deletedAt === null) delete updated.deletedAt;
      else updated.deletedAt = patch.deletedAt;
    }
    this.shoppingListItems.set(itemId, updated);
    return updated;
  }

  async listShoppingItems(filters: ShoppingItemListFilters): Promise<ShoppingListItem[]> {
    return [...this.shoppingListItems.values()]
      .filter((item) => {
        if (item.userId !== filters.userId || item.deletedAt) return false;
        if (filters.listId !== undefined && item.listId !== filters.listId) return false;
        if (item.checkedAt === undefined) return filters.includeActive ?? true;
        return filters.checkedAfter !== undefined && item.checkedAt >= filters.checkedAfter;
      })
      .sort((a, b) => {
        const aChecked = a.checkedAt !== undefined;
        const bChecked = b.checkedAt !== undefined;
        if (aChecked !== bChecked) return aChecked ? 1 : -1;
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.createdAt.localeCompare(b.createdAt);
      })
      .slice(0, Math.min(Math.max(filters.limit ?? 100, 1), 200));
  }

  async getShoppingItem(itemId: UUID): Promise<ShoppingListItem | undefined> {
    return this.shoppingListItems.get(itemId);
  }

  async upsertShoppingCatalogItem(data: ShoppingCatalogUpsertData): Promise<ShoppingCatalogItem> {
    const timestamp = nowIso();
    const existing = [...this.shoppingCatalogItems.values()].find(
      (item) => item.userId === data.userId && item.normalizedName === data.normalizedName && !item.deletedAt
    );
    const item: ShoppingCatalogItem = {
      ...existing,
      id: existing?.id ?? createId("shopping_catalog"),
      userId: data.userId,
      name: data.name,
      normalizedName: data.normalizedName,
      defaultCategory: data.defaultCategory ?? existing?.defaultCategory ?? "miscellaneous",
      purchaseCount: data.purchaseCount ?? existing?.purchaseCount ?? 0,
      metadata: data.metadata ?? existing?.metadata ?? {},
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (data.lastPurchasedAt !== undefined) item.lastPurchasedAt = data.lastPurchasedAt;
    else if (existing?.lastPurchasedAt !== undefined) item.lastPurchasedAt = existing.lastPurchasedAt;
    this.shoppingCatalogItems.set(item.id, item);
    return item;
  }

  async listShoppingCatalogItems(filters: ShoppingCatalogListFilters): Promise<ShoppingCatalogItem[]> {
    return [...this.shoppingCatalogItems.values()]
      .filter((item) => item.userId === filters.userId && !item.deletedAt)
      .sort((a, b) => {
        const recency = (b.lastPurchasedAt ?? "").localeCompare(a.lastPurchasedAt ?? "");
        if (recency !== 0) return recency;
        return b.purchaseCount - a.purchaseCount;
      })
      .slice(0, Math.min(Math.max(filters.limit ?? 50, 1), 100));
  }

  async addAuditLog(log: Omit<AuditLog, "id" | "occurredAt">): Promise<AuditLog> {
    const created: AuditLog = {
      ...log,
      id: createId("audit"),
      occurredAt: nowIso()
    };
    this.auditLogs.push(created);
    return created;
  }

  snapshot(): JsonObject {
    return {
      areaCount: this.areas.size,
      projectCount: this.projects.size,
      itemCount: this.items.size,
      itemEventCount: this.itemEvents.length,
      recurrencePolicyCount: this.recurrencePolicies.size,
      recurrenceEventCount: this.recurrenceEvents.length,
      policyCount: this.policies.size,
      dailyPlanCount: this.dailyPlans.size,
      providerAccountCount: this.providerAccounts.size,
      externalSourceCount: this.externalSources.size,
      emailActionProposalCount: this.emailActionProposals.size,
      shoppingListCount: this.shoppingLists.size,
      shoppingListItemCount: this.shoppingListItems.size,
      shoppingCatalogItemCount: this.shoppingCatalogItems.size,
      auditLogCount: this.auditLogs.length
    };
  }
}
