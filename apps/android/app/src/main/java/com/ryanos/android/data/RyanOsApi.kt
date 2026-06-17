package com.ryanos.android.data

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject

data class WidgetPayloadResult(
  val rawJson: String,
  val snapshot: WidgetSnapshot
)

object RyanOsApi {
  fun todayDateKey(timezone: String): String {
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    return LocalDate.now(zone).toString()
  }

  @Throws(IOException::class)
  fun fetchWidgetPayload(settings: RyanOsSettings, limit: Int = 8): WidgetPayloadResult {
    val date = todayDateKey(settings.timezone)
    val query = mapOf(
      "userId" to settings.userId,
      "timezone" to settings.timezone,
      "date" to date,
      "limit" to limit.toString()
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
    allowEarly: Boolean
  ) {
    val body = JSONObject()
      .put("userId", settings.userId)
      .put("completed", completed)
      .put("timezone", settings.timezone)
      .put("date", date ?: todayDateKey(settings.timezone))
      .put("allowEarly", allowEarly)
    request(
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/items/${itemId.urlEncode()}/toggle",
      body = body
    )
  }

  fun parseSnapshot(
    rawJson: String?,
    lastSyncedAt: String? = null,
    configured: Boolean = true,
    error: String? = null
  ): WidgetSnapshot {
    if (!configured) {
      return WidgetSnapshot(
        configured = false,
        readOnly = true,
        error = error
      )
    }
    if (rawJson.isNullOrBlank()) {
      return WidgetSnapshot(
        configured = true,
        readOnly = error != null,
        error = error
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
        items = parsedItems
      )
    }.getOrElse { parseError ->
      WidgetSnapshot(
        configured = true,
        readOnly = true,
        lastSyncedAt = lastSyncedAt,
        error = error ?: "Could not read widget data: ${parseError.message ?: parseError.javaClass.simpleName}"
      )
    }
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

  private fun JSONObject?.optStringOrNull(name: String): String? {
    if (this == null || isNull(name)) return null
    return optString(name).takeIf { it.isNotBlank() }
  }
}
