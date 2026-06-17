package com.ryanos.android.data

import java.time.ZoneId

data class RyanOsSettings(
  val apiBaseUrl: String = "",
  val userId: String = "local-owner",
  val timezone: String = defaultTimezone()
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
  val action: WidgetAction
)

data class WidgetAction(
  val type: String,
  val itemId: String,
  val date: String? = null,
  val allowEarly: Boolean = false
)

fun defaultTimezone(): String = ZoneId.systemDefault().id
