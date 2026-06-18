package com.ryanos.android.data

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

data class WidgetPayloadResult(
  val rawJson: String,
  val snapshot: WidgetSnapshot
)

object RyanOsApi {
  private const val WIDGET_ITEM_LIMIT = 100

  fun todayDateKey(timezone: String): String {
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    return LocalDate.now(zone).toString()
  }

  @Throws(IOException::class)
  fun fetchWidgetPayload(settings: RyanOsSettings, limit: Int = WIDGET_ITEM_LIMIT): WidgetPayloadResult {
    val date = todayDateKey(settings.timezone)
    val query = mapOf(
      "userId" to settings.userId,
      "timezone" to settings.timezone,
      "date" to date,
      "limit" to limit.toString(),
      "recurrenceLeadDays" to clampRecurrenceLeadDays(settings.recurrenceLeadDaysBeforeDue).toString()
    ).toQueryString()
    val rawJson = request(
      method = "GET",
      url = "${settings.normalizedBaseUrl}/v1/mobile/widget-items?$query"
    )
    val syncedAt = Instant.now().toString()
    return WidgetPayloadResult(
      rawJson = rawJson,
      snapshot = parseSnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun createItem(settings: RyanOsSettings, title: String) {
    val body = JSONObject()
      .put("userId", settings.userId)
      .put("timezone", settings.timezone)
      .put("date", todayDateKey(settings.timezone))
      .put("title", title)
      .put("kind", "task")
      .put("priority", "normal")
    request(
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/items",
      body = body
    )
  }

  @Throws(IOException::class)
  fun toggleItem(
    settings: RyanOsSettings,
    itemId: String,
    completed: Boolean,
    date: String?,
    allowEarly: Boolean,
    toggleExisting: Boolean = false
  ) {
    val body = JSONObject()
      .put("userId", settings.userId)
      .put("completed", completed)
      .put("timezone", settings.timezone)
      .put("date", date ?: todayDateKey(settings.timezone))
      .put("allowEarly", allowEarly)
      .put("toggle", toggleExisting)
    request(
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/items/${itemId.urlEncode()}/toggle",
      body = body
    )
  }

  fun optimisticallyToggleWidgetPayload(
    rawJson: String?,
    itemId: String,
    completed: Boolean,
    date: String?,
    timezone: String,
    toggleExisting: Boolean
  ): String? {
    if (rawJson.isNullOrBlank()) return rawJson
    return runCatching {
      val root = JSONObject(rawJson)
      val items = root.optJSONArray("items") ?: return rawJson
      val item = items.findItem(itemId) ?: return rawJson
      val recurrence = item.optJSONObject("recurrence")
      val actionDate = item.optJSONObject("action")?.optStringOrNull("date")
      val dateKey = date ?: actionDate ?: root.optStringOrNull("date") ?: todayDateKey(timezone)
      val targetCompleted =
        if (toggleExisting) !item.isLocallyCompleteForDate(dateKey) else completed

      item.put("checked", targetCompleted)
      if (recurrence == null) {
        item.put("status", if (targetCompleted) "done" else "open")
      } else {
        item.put("status", "open")
        recurrence.updateDayStatus(dateKey, targetCompleted)
        recurrence.updateCountSummary()
      }

      root.toString()
    }.getOrElse { rawJson }
  }

  fun parseSnapshot(
    rawJson: String?,
    lastSyncedAt: String? = null,
    configured: Boolean = true,
    error: String? = null,
    recurrenceLeadDaysBeforeDue: Int = DEFAULT_RECURRENCE_LEAD_DAYS,
    showTaskDetails: Boolean = true,
    colorCodeByArea: Boolean = true,
    expandedRecurrenceItemIds: Set<String> = emptySet()
  ): WidgetSnapshot {
    if (!configured) {
      return WidgetSnapshot(
        configured = false,
        readOnly = true,
        error = error,
        recurrenceLeadDaysBeforeDue = recurrenceLeadDaysBeforeDue,
        showTaskDetails = showTaskDetails,
        colorCodeByArea = colorCodeByArea,
        expandedRecurrenceItemIds = expandedRecurrenceItemIds
      )
    }
    if (rawJson.isNullOrBlank()) {
      return WidgetSnapshot(
        configured = true,
        readOnly = error != null,
        error = error,
        recurrenceLeadDaysBeforeDue = recurrenceLeadDaysBeforeDue,
        showTaskDetails = showTaskDetails,
        colorCodeByArea = colorCodeByArea,
        expandedRecurrenceItemIds = expandedRecurrenceItemIds
      )
    }

    return runCatching {
      val root = JSONObject(rawJson)
      val items = root.optJSONArray("items")
      val parsedItems = buildList {
        if (items != null) {
          for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val id = item.optString("id")
            val title = item.optString("title")
            if (id.isBlank() || title.isBlank()) continue
            val actionObject = item.optJSONObject("action")
            val action = WidgetAction(
              type = actionObject.optStringOrNull("type") ?: "item_complete",
              itemId = actionObject.optStringOrNull("itemId") ?: id,
              date = actionObject.optStringOrNull("date"),
              allowEarly = actionObject?.optBoolean("allowEarly", false) ?: false
            )
            val signals = item.optJSONArray("prioritySignals")
            add(
              WidgetItem(
                id = id,
                title = title,
                kind = item.optString("kind", "task"),
                status = item.optString("status", "open"),
                checked = item.optBoolean("checked", false),
                priority = item.optString("priority", "normal"),
                priorityScore = item.optInt("priorityScore", 0),
                prioritySignals = buildList {
                  if (signals != null) {
                    for (signalIndex in 0 until signals.length()) {
                      val signal = signals.optString(signalIndex)
                      if (signal.isNotBlank()) add(signal)
                    }
                  }
                },
                dueAt = item.optStringOrNull("dueAt"),
                secondaryText = item.optStringOrNull("secondaryText"),
                recurrence = parseRecurrence(item.optJSONObject("recurrence")),
                scope = parseScope(item.optJSONObject("scope")),
                action = action
              )
            )
          }
        }
      }
      WidgetSnapshot(
        date = root.optStringOrNull("date") ?: "",
        timezone = root.optStringOrNull("timezone") ?: defaultTimezone(),
        generatedAt = root.optStringOrNull("generatedAt") ?: "",
        lastSyncedAt = lastSyncedAt,
        configured = true,
        readOnly = error != null,
        error = error,
        recurrenceLeadDaysBeforeDue = recurrenceLeadDaysBeforeDue,
        showTaskDetails = showTaskDetails,
        colorCodeByArea = colorCodeByArea,
        expandedRecurrenceItemIds = expandedRecurrenceItemIds,
        items = parsedItems
      )
    }.getOrElse { parseError ->
      WidgetSnapshot(
        configured = true,
        readOnly = true,
        lastSyncedAt = lastSyncedAt,
        error = error ?: "Could not read widget data: ${parseError.message ?: parseError.javaClass.simpleName}",
        recurrenceLeadDaysBeforeDue = recurrenceLeadDaysBeforeDue,
        showTaskDetails = showTaskDetails,
        colorCodeByArea = colorCodeByArea,
        expandedRecurrenceItemIds = expandedRecurrenceItemIds
      )
    }
  }

  private fun parseRecurrence(recurrence: JSONObject?): WidgetRecurrence? {
    if (recurrence == null) return null
    val days = recurrence.optJSONArray("days")
    return WidgetRecurrence(
      summary = recurrence.optStringOrNull("summary") ?: "",
      intendedDate = recurrence.optStringOrNull("intendedDate"),
      nextDueAt = recurrence.optStringOrNull("nextDueAt"),
      lastDoneLabel = recurrence.optStringOrNull("lastDoneLabel"),
      days = buildList {
        if (days != null) {
          for (index in 0 until days.length()) {
            val day = days.optJSONObject(index) ?: continue
            val date = day.optString("date")
            if (date.isBlank()) continue
            add(
              WidgetRecurrenceDay(
                date = date,
                weekday = day.optStringOrNull("weekday") ?: "",
                status = day.optStringOrNull("status") ?: "none",
                allowEarly = day.optBoolean("allowEarly", false),
                isToday = day.optBoolean("isToday", false),
                isIntended = day.optBoolean("isIntended", false)
              )
            )
          }
        }
      }
    )
  }

  private fun parseScope(scope: JSONObject?): WidgetScope? {
    if (scope == null) return null
    val area = parseScopeLabel(scope.optJSONObject("area"))
    val project = parseScopeLabel(scope.optJSONObject("project"))
    if (area == null && project == null) return null
    return WidgetScope(area = area, project = project)
  }

  private fun parseScopeLabel(scope: JSONObject?): WidgetScopeLabel? {
    if (scope == null) return null
    val id = scope.optString("id")
    val name = scope.optString("name")
    if (id.isBlank() || name.isBlank()) return null
    return WidgetScopeLabel(
      id = id,
      name = name,
      icon = scope.optStringOrNull("icon"),
      color = scope.optStringOrNull("color")
    )
  }

  private fun request(method: String, url: String, body: JSONObject? = null): String {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 8_000
      readTimeout = 12_000
      setRequestProperty("Accept", "application/json")
      if (body != null) {
        doOutput = true
        setRequestProperty("Content-Type", "application/json; charset=utf-8")
      }
    }

    try {
      if (body != null) {
        connection.outputStream.bufferedWriter(StandardCharsets.UTF_8).use { writer ->
          writer.write(body.toString())
        }
      }
      val statusCode = connection.responseCode
      val stream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
      val responseText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
      if (statusCode !in 200..299) {
        throw IOException("RyanOS API $statusCode: ${responseText.take(240)}")
      }
      return responseText
    } finally {
      connection.disconnect()
    }
  }

  private fun Map<String, String>.toQueryString(): String =
    entries.joinToString("&") { (key, value) -> "${key.urlEncode()}=${value.urlEncode()}" }

  private fun String.urlEncode(): String =
    URLEncoder.encode(this, StandardCharsets.UTF_8.name())

  private fun JSONArray.findItem(itemId: String): JSONObject? {
    for (index in 0 until length()) {
      val item = optJSONObject(index) ?: continue
      if (item.optString("id") == itemId) return item
    }
    return null
  }

  private fun JSONObject.isLocallyCompleteForDate(dateKey: String): Boolean {
    val recurrence = optJSONObject("recurrence") ?: return optBoolean("checked", false)
    val days = recurrence.optJSONArray("days") ?: return optBoolean("checked", false)
    val day = days.findDay(dateKey) ?: return optBoolean("checked", false)
    return day.optString("status") == "completed"
  }

  private fun JSONArray.findDay(dateKey: String): JSONObject? {
    for (index in 0 until length()) {
      val day = optJSONObject(index) ?: continue
      if (day.optString("date") == dateKey) return day
    }
    return null
  }

  private fun JSONObject.updateDayStatus(dateKey: String, completed: Boolean) {
    val days = optJSONArray("days") ?: return
    val day = days.findDay(dateKey) ?: return
    day.put("status", if (completed) "completed" else "uncompleted")
  }

  private fun JSONObject.updateCountSummary() {
    val currentSummary = optStringOrNull("summary") ?: return
    val match = Regex("""^\d+/(\d+)$""").find(currentSummary) ?: return
    val days = optJSONArray("days") ?: return
    var completedCount = 0
    for (index in 0 until days.length()) {
      if (days.optJSONObject(index)?.optString("status") == "completed") completedCount += 1
    }
    put("summary", "$completedCount/${match.groupValues[1]}")
  }

  private fun JSONObject?.optStringOrNull(name: String): String? {
    if (this == null || isNull(name)) return null
    return optString(name).takeIf { it.isNotBlank() }
  }
}
