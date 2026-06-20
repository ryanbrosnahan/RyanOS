package com.ryanos.android.data

import java.time.ZoneId

data class RyanOsSettings(
  val apiBaseUrl: String = "",
  val userId: String = "local-owner",
  val timezone: String = defaultTimezone(),
  val recurrenceLeadDaysBeforeDue: Int = DEFAULT_RECURRENCE_LEAD_DAYS,
  val showTaskDetails: Boolean = true,
  val colorCodeByArea: Boolean = true
) {
  val isConfigured: Boolean
    get() = apiBaseUrl.isNotBlank()

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
  val items: List<WidgetItem> = emptyList()
)

data class WidgetItem(
  val id: String,
  val title: String,
  val kind: String,
  val status: String,
  val checked: Boolean,
  val priority: String,
  val priorityScore: Int,
  val prioritySignals: List<String>,
  val dueAt: String?,
  val secondaryText: String?,
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

const val DEFAULT_RECURRENCE_LEAD_DAYS = 1

fun clampRecurrenceLeadDays(value: Int): Int = value.coerceIn(0, 30)

fun defaultTimezone(): String = ZoneId.systemDefault().id
