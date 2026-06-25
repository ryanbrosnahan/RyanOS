package com.ryanos.android.data

import java.time.ZoneId

data class RyanOsSettings(
  val apiBaseUrl: String = "",
  val userId: String = "local-owner",
  val sessionCookie: String = "",
  val timezone: String = defaultTimezone(),
  val recurrenceLeadDaysBeforeDue: Int = DEFAULT_RECURRENCE_LEAD_DAYS,
  val showTaskDetails: Boolean = true,
  val colorCodeByArea: Boolean = true
) {
  val isConfigured: Boolean
    get() = apiBaseUrl.isNotBlank()

  val hasSession: Boolean
    get() = sessionCookie.isNotBlank()

  val normalizedBaseUrl: String
    get() = apiBaseUrl.trim().trimEnd('/')
}

data class WidgetSnapshot(
  val date: String = "",
  val timezone: String = defaultTimezone(),
  val generatedAt: String = "",
  val lastSyncedAt: String? = null,
  val configured: Boolean = false,
  val readOnly: Boolean = false,
  val error: String? = null,
  val recurrenceLeadDaysBeforeDue: Int = DEFAULT_RECURRENCE_LEAD_DAYS,
  val showTaskDetails: Boolean = true,
  val colorCodeByArea: Boolean = true,
  val expandedRecurrenceItemIds: Set<String> = emptySet(),
  val expandedDetailItemIds: Set<String> = emptySet(),
  val items: List<WidgetItem> = emptyList()
)

data class WidgetItem(
  val id: String,
  val title: String,
  val kind: String,
  val status: String,
  val checked: Boolean,
  val starred: Boolean,
  val priority: String,
  val priorityScore: Int,
  val prioritySignals: List<String>,
  val dueAt: String?,
  val secondaryText: String?,
  val progress: WidgetProgress,
  val checklist: WidgetChecklist,
  val recurrence: WidgetRecurrence?,
  val scope: WidgetScope?,
  val action: WidgetAction
)

data class WidgetAction(
  val type: String,
  val itemId: String,
  val date: String? = null,
  val allowEarly: Boolean = false
)

data class WidgetRecurrence(
  val summary: String,
  val intendedDate: String?,
  val nextDueAt: String?,
  val lastDoneLabel: String?,
  val days: List<WidgetRecurrenceDay>
)

data class WidgetRecurrenceDay(
  val date: String,
  val weekday: String,
  val status: String,
  val allowEarly: Boolean,
  val isToday: Boolean,
  val isIntended: Boolean
)

data class WidgetProgress(
  val count: Int = 0,
  val latest: List<WidgetProgressNote> = emptyList()
)

data class WidgetProgressNote(
  val id: String,
  val body: String,
  val occurredAt: String,
  val createdAt: String,
  val updatedAt: String
)

data class WidgetChecklist(
  val total: Int = 0,
  val completed: Int = 0,
  val moreCount: Int = 0,
  val items: List<WidgetChecklistItem> = emptyList()
)

data class WidgetChecklistItem(
  val id: String,
  val title: String,
  val checked: Boolean,
  val checkedAt: String?,
  val sortOrder: Int,
  val createdAt: String,
  val updatedAt: String
)

data class WidgetScope(
  val area: WidgetScopeLabel? = null,
  val project: WidgetScopeLabel? = null
)

data class WidgetScopeLabel(
  val id: String,
  val name: String,
  val icon: String?,
  val color: String?
)

data class DailyPlanPayloadResult(
  val rawJson: String,
  val snapshot: DailyPlanSnapshot
)

data class DailyPlanSnapshot(
  val date: String = "",
  val timezone: String = defaultTimezone(),
  val lastSyncedAt: String? = null,
  val configured: Boolean = false,
  val readOnly: Boolean = false,
  val error: String? = null,
  val plan: DailyPlanSummary = DailyPlanSummary(),
  val starredItems: List<FocusItem> = emptyList(),
  val suggestedItems: List<FocusItem> = emptyList(),
  val selectedItems: List<FocusItem> = emptyList(),
  val dueItems: List<FocusItem> = emptyList(),
  val items: List<FocusItem> = emptyList()
)

data class DailyPlanSummary(
  val id: String? = null,
  val selectedItemIds: List<String> = emptyList(),
  val suggestedItemIds: List<String> = emptyList(),
  val suggestionSource: String = "heuristic",
  val status: String = "",
  val updatedAt: String? = null
)

data class FocusItem(
  val id: String,
  val title: String,
  val kind: String,
  val status: String,
  val starred: Boolean,
  val starredAt: String?,
  val priority: String,
  val priorityScore: Int,
  val prioritySignals: List<String>,
  val hiddenUntil: String?,
  val dueAt: String?,
  val completedAt: String?,
  val completion: FocusCompletion,
  val progress: WidgetProgress,
  val checklist: WidgetChecklist,
  val recurrence: FocusRecurrence?,
  val scope: WidgetScope?
) {
  fun checkedFor(dateKey: String): Boolean =
    completion.completedToday ||
      recurrence?.week?.days?.any { it.date == dateKey && it.status == "completed" } == true ||
      status == "done"
}

data class FocusCompletion(
  val completedToday: Boolean = false,
  val completedAt: String? = null
)

data class FocusRecurrence(
  val policy: FocusRecurrencePolicy,
  val week: FocusRecurrenceWeek,
  val state: FocusRecurrenceState? = null
)

data class FocusRecurrencePolicy(
  val id: String = "",
  val type: String = "",
  val intervalDays: Int? = null,
  val minimumIntervalDays: Int? = null,
  val cron: String? = null,
  val targetCount: Int? = null,
  val targetWindowDays: Int? = null,
  val preferredDays: List<String> = emptyList()
)

data class FocusRecurrenceWeek(
  val startDate: String = "",
  val endDate: String = "",
  val days: List<FocusRecurrenceDay> = emptyList(),
  val completedCount: Int = 0,
  val targetCount: Int? = null,
  val targetWindowDays: Int = 7
)

data class FocusRecurrenceDay(
  val date: String,
  val weekday: String,
  val status: String,
  val eventId: String? = null,
  val occurredAt: String? = null
)

data class FocusRecurrenceState(
  val lastCompletedAt: String? = null,
  val nextEligibleAt: String? = null,
  val nextDueAt: String? = null,
  val stalenessScore: Int = 0
)

data class ShoppingPayloadResult(
  val rawJson: String,
  val snapshot: ShoppingSnapshot
)

data class ShoppingSnapshot(
  val generatedAt: String = "",
  val lastSyncedAt: String? = null,
  val configured: Boolean = false,
  val readOnly: Boolean = false,
  val error: String? = null,
  val categories: List<String> = emptyList(),
  val items: List<ShoppingItem> = emptyList(),
  val suggestions: List<ShoppingSuggestion> = emptyList()
)

data class ShoppingItem(
  val id: String,
  val name: String,
  val normalizedName: String,
  val category: String,
  val quantity: String?,
  val note: String?,
  val checked: Boolean,
  val checkedAt: String?,
  val source: String,
  val sortOrder: Int,
  val catalogItemId: String?,
  val createdAt: String,
  val updatedAt: String
)

data class ShoppingSuggestion(
  val id: String,
  val name: String,
  val normalizedName: String,
  val category: String,
  val lastPurchasedAt: String?,
  val purchaseCount: Int
)

data class VocabularyPayloadResult(
  val rawJson: String,
  val snapshot: VocabularySnapshot
)

data class VocabularySnapshot(
  val generatedAt: String = "",
  val lastSyncedAt: String? = null,
  val configured: Boolean = false,
  val readOnly: Boolean = false,
  val error: String? = null,
  val categories: List<String> = emptyList(),
  val entries: List<VocabularyEntry> = emptyList(),
  val encountersByEntryId: Map<String, List<VocabularyEncounter>> = emptyMap()
)

data class VocabularyEntry(
  val id: String,
  val term: String,
  val normalizedTerm: String,
  val languageCode: String,
  val category: String,
  val definition: String?,
  val partOfSpeech: String?,
  val pronunciation: String?,
  val translation: String?,
  val notes: String?,
  val tags: List<String>,
  val definitionSource: String,
  val status: String,
  val createdAt: String,
  val updatedAt: String
)

data class VocabularyEncounter(
  val id: String,
  val entryId: String,
  val sourceType: String?,
  val sourceTitle: String?,
  val sourceUrl: String?,
  val context: String?,
  val occurredAt: String,
  val createdAt: String
)

data class MessagePayloadResult(
  val rawJson: String,
  val snapshot: MessageSnapshot
)

data class MessageSnapshot(
  val lastSyncedAt: String? = null,
  val configured: Boolean = false,
  val readOnly: Boolean = false,
  val error: String? = null,
  val messages: List<MessageTurn> = emptyList()
)

data class MessageTurn(
  val id: String,
  val role: String,
  val text: String,
  val occurredAt: String,
  val pending: Boolean = false
)

data class ShoppingItemPatch(
  val name: String? = null,
  val category: String? = null,
  val quantity: String? = null,
  val note: String? = null
)

data class VocabularyEntryPatch(
  val term: String? = null,
  val languageCode: String? = null,
  val category: String? = null,
  val definition: String? = null,
  val partOfSpeech: String? = null,
  val pronunciation: String? = null,
  val translation: String? = null,
  val notes: String? = null,
  val tags: List<String>? = null
)

const val DEFAULT_RECURRENCE_LEAD_DAYS = 1

fun clampRecurrenceLeadDays(value: Int): Int = value.coerceIn(0, 30)

fun defaultTimezone(): String = ZoneId.systemDefault().id
