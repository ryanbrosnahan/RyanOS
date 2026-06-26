package com.ryanos.android.data

import java.io.IOException
import java.time.Duration
import java.net.HttpURLConnection
import java.net.URI
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.net.UnknownHostException
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

private data class ApiResponse(
  val body: String,
  val headers: Map<String, List<String>>
)

object RyanOsApi {
  private const val WIDGET_ITEM_LIMIT = 100
  private const val SHOPPING_SUGGESTION_LIMIT = 12
  private const val VOCABULARY_ENTRY_LIMIT = 100
  private const val REQUEST_RETRY_DELAY_MS = 500L
  private val SHOPPING_CHECKED_LINGER_DURATION: Duration = Duration.ofHours(24)

  fun todayDateKey(timezone: String): String {
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    return LocalDate.now(zone).toString()
  }

  @Throws(IOException::class)
  fun signIn(settings: RyanOsSettings, email: String, password: String): String {
    if (settings.normalizedBaseUrl.isBlank()) {
      throw IOException("Enter the RyanOS API base URL before signing in.")
    }
    val response = requestWithHeaders(
      method = "POST",
      url = "${settings.normalizedBaseUrl}/auth/sign-in/email",
      body = JSONObject()
        .put("email", email)
        .put("password", password)
    )
    return response.sessionCookie()
      ?: throw IOException("RyanOS sign-in succeeded but no session cookie was returned.")
  }

  @Throws(IOException::class)
  fun fetchAndroidReleaseManifest(settings: RyanOsSettings): AndroidReleaseManifest {
    val manifestUrl = androidReleaseManifestUrl(settings.normalizedBaseUrl)
    val rawJson = request(method = "GET", url = manifestUrl)
    return parseAndroidReleaseManifest(rawJson, manifestUrl)
  }

  @Throws(IOException::class)
  fun fetchWidgetPayload(settings: RyanOsSettings, limit: Int = WIDGET_ITEM_LIMIT): WidgetPayloadResult {
    val date = todayDateKey(settings.timezone)
    val query = mapOf(
      "timezone" to settings.timezone,
      "date" to date,
      "limit" to limit.toString(),
      "recurrenceLeadDays" to clampRecurrenceLeadDays(settings.recurrenceLeadDaysBeforeDue).toString()
    ).toQueryString()
    val rawJson = request(
      settings = settings,
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
  fun fetchShoppingPayload(settings: RyanOsSettings, suggestions: Int = SHOPPING_SUGGESTION_LIMIT): ShoppingPayloadResult {
    val query = mapOf(
      "lingerHours" to "24",
      "suggestions" to suggestions.toString()
    ).toQueryString()
    val rawJson = request(
      settings = settings,
      method = "GET",
      url = "${settings.normalizedBaseUrl}/v1/mobile/shopping/list?$query"
    )
    val syncedAt = Instant.now().toString()
    return ShoppingPayloadResult(
      rawJson = rawJson,
      snapshot = parseShoppingSnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun fetchVocabularyPayload(settings: RyanOsSettings, limit: Int = VOCABULARY_ENTRY_LIMIT): VocabularyPayloadResult {
    val query = mapOf(
      "limit" to limit.toString()
    ).toQueryString()
    val rawJson = request(
      settings = settings,
      method = "GET",
      url = "${settings.normalizedBaseUrl}/v1/mobile/vocabulary/entries?$query"
    )
    val syncedAt = Instant.now().toString()
    return VocabularyPayloadResult(
      rawJson = rawJson,
      snapshot = parseVocabularySnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun fetchDailyPlanPayload(settings: RyanOsSettings): DailyPlanPayloadResult {
    val query = mapOf(
      "timezone" to settings.timezone
    ).toQueryString()
    val rawJson = request(
      settings = settings,
      method = "GET",
      url = "${settings.normalizedBaseUrl}/v1/daily-plan?$query"
    )
    val syncedAt = Instant.now().toString()
    return DailyPlanPayloadResult(
      rawJson = rawJson,
      snapshot = parseDailyPlanSnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun suggestDailyPlanPayload(settings: RyanOsSettings): DailyPlanPayloadResult {
    val body = JSONObject()
      .put("timezone", settings.timezone)
    val rawJson = request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/daily-plan/suggest",
      body = body
    )
    val syncedAt = Instant.now().toString()
    return DailyPlanPayloadResult(
      rawJson = rawJson,
      snapshot = parseDailyPlanSnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun fetchMessagesPayload(settings: RyanOsSettings, limit: Int = 30): MessagePayloadResult {
    val query = mapOf(
      "provider" to "web",
      "chatId" to "dashboard",
      "limit" to limit.toString()
    ).toQueryString()
    val rawJson = request(
      settings = settings,
      method = "GET",
      url = "${settings.normalizedBaseUrl}/v1/messages?$query"
    )
    val syncedAt = Instant.now().toString()
    return MessagePayloadResult(
      rawJson = rawJson,
      snapshot = parseMessageSnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun createItem(settings: RyanOsSettings, title: String) {
    val body = JSONObject()
      .put("timezone", settings.timezone)
      .put("date", todayDateKey(settings.timezone))
      .put("title", title)
      .put("kind", "task")
      .put("priority", "normal")
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/items",
      body = body
    )
  }

  @Throws(IOException::class)
  fun sendMessage(settings: RyanOsSettings, text: String) {
    val body = JSONObject()
      .put("provider", "web")
      .put("chatId", "dashboard")
      .put("text", text)
      .put("metadata", JSONObject().put("source", "android"))
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/messages",
      body = body
    )
  }

  @Throws(IOException::class)
  fun toggleStar(settings: RyanOsSettings, itemId: String, starred: Boolean) {
    val body = JSONObject()
      .put("timezone", settings.timezone)
      .put("starred", starred)
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/items/${itemId.urlEncode()}/star",
      body = body
    )
  }

  @Throws(IOException::class)
  fun createShoppingItem(
    settings: RyanOsSettings,
    name: String,
    category: String?,
    quantity: String?
  ) {
    val body = JSONObject()
      .put("name", name)
      .put("source", "android")
    if (!category.isNullOrBlank()) body.put("category", category)
    if (!quantity.isNullOrBlank()) body.put("quantity", quantity)
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/shopping/items",
      body = body
    )
  }

  @Throws(IOException::class)
  fun patchShoppingItem(settings: RyanOsSettings, itemId: String, patch: ShoppingItemPatch): ShoppingPayloadResult {
    val body = JSONObject()
    patch.name?.let { body.put("name", it) }
    patch.category?.let { body.put("category", it) }
    if (patch.quantity != null) body.put("quantity", patch.quantity)
    if (patch.note != null) body.put("note", patch.note)
    val rawJson = request(
      settings = settings,
      method = "PATCH",
      url = "${settings.normalizedBaseUrl}/v1/shopping/items/${itemId.urlEncode()}",
      body = body
    )
    val syncedAt = Instant.now().toString()
    return ShoppingPayloadResult(
      rawJson = rawJson,
      snapshot = parseShoppingSnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun createVocabularyEntry(
    settings: RyanOsSettings,
    term: String,
    languageCode: String?,
    category: String?,
    context: String?
  ) {
    val body = JSONObject()
      .put("term", term)
    if (!languageCode.isNullOrBlank()) body.put("languageCode", languageCode)
    if (!category.isNullOrBlank()) body.put("category", category)
    if (!context.isNullOrBlank()) body.put("context", context)
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/vocabulary/entries",
      body = body
    )
  }

  @Throws(IOException::class)
  fun patchVocabularyEntry(settings: RyanOsSettings, entryId: String, patch: VocabularyEntryPatch): VocabularyPayloadResult {
    val body = JSONObject()
    patch.term?.let { body.put("term", it) }
    patch.languageCode?.let { body.put("languageCode", it) }
    patch.category?.let { body.put("category", it) }
    if (patch.definition != null) body.put("definition", patch.definition)
    if (patch.partOfSpeech != null) body.put("partOfSpeech", patch.partOfSpeech)
    if (patch.pronunciation != null) body.put("pronunciation", patch.pronunciation)
    if (patch.translation != null) body.put("translation", patch.translation)
    if (patch.notes != null) body.put("notes", patch.notes)
    patch.tags?.let { tags ->
      body.put("tags", JSONArray().apply { tags.forEach { put(it) } })
    }
    val rawJson = request(
      settings = settings,
      method = "PATCH",
      url = "${settings.normalizedBaseUrl}/v1/vocabulary/entries/${entryId.urlEncode()}",
      body = body
    )
    val syncedAt = Instant.now().toString()
    return VocabularyPayloadResult(
      rawJson = rawJson,
      snapshot = parseVocabularySnapshot(
        rawJson = rawJson,
        lastSyncedAt = syncedAt,
        configured = true
      )
    )
  }

  @Throws(IOException::class)
  fun toggleShoppingItem(settings: RyanOsSettings, itemId: String, checked: Boolean) {
    val body = JSONObject()
      .put("checked", checked)
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/shopping/items/${itemId.urlEncode()}/check",
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
      .put("completed", completed)
      .put("timezone", settings.timezone)
      .put("date", date ?: todayDateKey(settings.timezone))
      .put("allowEarly", allowEarly)
      .put("toggle", toggleExisting)
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/items/${itemId.urlEncode()}/toggle",
      body = body
    )
  }

  @Throws(IOException::class)
  fun toggleChecklistItem(
    settings: RyanOsSettings,
    itemId: String,
    checklistItemId: String,
    checked: Boolean
  ) {
    val body = JSONObject()
      .put("checked", checked)
      .put("timezone", settings.timezone)
      .put("date", todayDateKey(settings.timezone))
      .put("toggle", false)
    request(
      settings = settings,
      method = "POST",
      url = "${settings.normalizedBaseUrl}/v1/mobile/items/${itemId.urlEncode()}/checklist-items/${checklistItemId.urlEncode()}/toggle",
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
      if (targetCompleted) {
        item.put("starred", false)
        item.remove("starredAt")
      }
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

  fun optimisticallyToggleChecklistPayload(
    rawJson: String?,
    itemId: String,
    checklistItemId: String,
    checked: Boolean
  ): String? {
    if (rawJson.isNullOrBlank()) return rawJson
    return runCatching {
      val root = JSONObject(rawJson)
      val items = root.optJSONArray("items") ?: return rawJson
      val item = items.findItem(itemId) ?: return rawJson
      val checklist = item.optJSONObject("checklist") ?: return rawJson
      val checklistItems = checklist.optJSONArray("items") ?: return rawJson
      val checklistItem = checklistItems.findItem(checklistItemId) ?: return rawJson
      val wasChecked = checklistItem.optBoolean("checked", false)
      checklistItem.put("checked", checked)
      if (checked) {
        checklistItem.put("checkedAt", Instant.now().toString())
      } else {
        checklistItem.remove("checkedAt")
      }
      if (wasChecked != checked) {
        val currentCompleted = checklist.optInt("completed", 0)
        checklist.put("completed", (currentCompleted + if (checked) 1 else -1).coerceAtLeast(0))
      }
      root.toString()
    }.getOrElse { rawJson }
  }

  fun optimisticallyToggleShoppingPayload(
    rawJson: String?,
    itemId: String,
    checked: Boolean
  ): String? {
    if (rawJson.isNullOrBlank()) return rawJson
    return runCatching {
      val root = JSONObject(rawJson)
      val items = root.optJSONArray("items") ?: return rawJson
      val item = items.findItem(itemId) ?: return rawJson
      item.put("checked", checked)
      if (checked) {
        item.put("checkedAt", Instant.now().toString())
      } else {
        item.remove("checkedAt")
      }
      root.toString()
    }.getOrElse { rawJson }
  }

  fun optimisticallyToggleDailyPlanPayload(
    rawJson: String?,
    itemId: String,
    completed: Boolean,
    date: String?,
    timezone: String
  ): String? {
    if (rawJson.isNullOrBlank()) return rawJson
    return runCatching {
      val root = JSONObject(rawJson)
      val dateKey = date ?: root.optStringOrNull("date") ?: todayDateKey(timezone)
      root.updateDailyItem(itemId) { item ->
        val recurrence = item.optJSONObject("recurrence")
        if (completed) {
          item.put("starred", false)
          item.remove("starredAt")
        }
        if (recurrence == null) {
          item.put("status", if (completed) "done" else "open")
          val completion = item.optJSONObject("completion") ?: JSONObject().also { item.put("completion", it) }
          completion.put("completedToday", completed)
          if (completed) {
            completion.put("completedAt", Instant.now().toString())
            item.put("completedAt", completion.optString("completedAt"))
          } else {
            completion.remove("completedAt")
            item.remove("completedAt")
          }
        } else {
          item.put("status", "open")
          recurrence.optJSONObject("week")?.updateWeekDayStatus(dateKey, completed)
          val completion = item.optJSONObject("completion") ?: JSONObject().also { item.put("completion", it) }
          if (dateKey == root.optStringOrNull("date")) completion.put("completedToday", completed)
        }
      }
      root.toString()
    }.getOrElse { rawJson }
  }

  fun optimisticallyStarDailyPlanPayload(rawJson: String?, itemId: String, starred: Boolean): String? {
    if (rawJson.isNullOrBlank()) return rawJson
    return runCatching {
      val root = JSONObject(rawJson)
      root.updateDailyItem(itemId) { item ->
        item.put("starred", starred)
        if (starred) item.put("starredAt", Instant.now().toString()) else item.remove("starredAt")
      }
      root.toString()
    }.getOrElse { rawJson }
  }

  fun optimisticallyAppendMessagePayload(rawJson: String?, text: String, now: Instant = Instant.now()): String {
    val root = if (rawJson.isNullOrBlank()) JSONObject() else runCatching { JSONObject(rawJson) }.getOrElse { JSONObject() }
    val messages = root.optJSONArray("messages") ?: JSONArray().also { root.put("messages", it) }
    messages.put(
      JSONObject()
        .put("id", "local-${now.toEpochMilli()}")
        .put("direction", "inbound")
        .put("text", text)
        .put("occurredAt", now.toString())
        .put("pending", true)
    )
    return root.toString()
  }

  fun parseSnapshot(
    rawJson: String?,
    lastSyncedAt: String? = null,
    configured: Boolean = true,
    error: String? = null,
    recurrenceLeadDaysBeforeDue: Int = DEFAULT_RECURRENCE_LEAD_DAYS,
    showTaskDetails: Boolean = true,
    colorCodeByArea: Boolean = true,
    expandedRecurrenceItemIds: Set<String> = emptySet(),
    expandedDetailItemIds: Set<String> = emptySet()
  ): WidgetSnapshot {
    if (!configured) {
      return WidgetSnapshot(
        configured = false,
        readOnly = true,
        error = error,
        recurrenceLeadDaysBeforeDue = recurrenceLeadDaysBeforeDue,
        showTaskDetails = showTaskDetails,
        colorCodeByArea = colorCodeByArea,
        expandedRecurrenceItemIds = expandedRecurrenceItemIds,
        expandedDetailItemIds = expandedDetailItemIds
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
        expandedRecurrenceItemIds = expandedRecurrenceItemIds,
        expandedDetailItemIds = expandedDetailItemIds
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
                starred = item.optBoolean("starred", false),
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
                progress = parseProgress(item.optJSONObject("progress")),
                checklist = parseChecklist(item.optJSONObject("checklist")),
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
        expandedDetailItemIds = expandedDetailItemIds,
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
        expandedRecurrenceItemIds = expandedRecurrenceItemIds,
        expandedDetailItemIds = expandedDetailItemIds
      )
    }
  }

  fun parseShoppingSnapshot(
    rawJson: String?,
    lastSyncedAt: String? = null,
    configured: Boolean = true,
    error: String? = null,
    now: Instant = Instant.now()
  ): ShoppingSnapshot {
    if (!configured) {
      return ShoppingSnapshot(
        configured = false,
        readOnly = true,
        error = error
      )
    }
    if (rawJson.isNullOrBlank()) {
      return ShoppingSnapshot(
        configured = true,
        readOnly = error != null,
        lastSyncedAt = lastSyncedAt,
        error = error
      )
    }

    return runCatching {
      val root = JSONObject(rawJson)
      ShoppingSnapshot(
        generatedAt = root.optStringOrNull("generatedAt") ?: "",
        lastSyncedAt = lastSyncedAt,
        configured = true,
        readOnly = error != null,
        error = error,
        categories = parseStringArray(root.optJSONArray("categories")),
        items = parseShoppingItems(root.optJSONArray("items"), now),
        suggestions = parseShoppingSuggestions(root.optJSONArray("suggestions"))
      )
    }.getOrElse { parseError ->
      ShoppingSnapshot(
        configured = true,
        readOnly = true,
        lastSyncedAt = lastSyncedAt,
        error = error ?: "Could not read shopping data: ${parseError.message ?: parseError.javaClass.simpleName}"
      )
    }
  }

  fun parseDailyPlanSnapshot(
    rawJson: String?,
    lastSyncedAt: String? = null,
    configured: Boolean = true,
    error: String? = null
  ): DailyPlanSnapshot {
    if (!configured) {
      return DailyPlanSnapshot(
        configured = false,
        readOnly = true,
        error = error
      )
    }
    if (rawJson.isNullOrBlank()) {
      return DailyPlanSnapshot(
        configured = true,
        readOnly = error != null,
        lastSyncedAt = lastSyncedAt,
        error = error
      )
    }

    return runCatching {
      val root = JSONObject(rawJson)
      DailyPlanSnapshot(
        date = root.optStringOrNull("date") ?: "",
        timezone = root.optStringOrNull("timezone") ?: defaultTimezone(),
        lastSyncedAt = lastSyncedAt,
        configured = true,
        readOnly = error != null,
        error = error,
        plan = parseDailyPlanSummary(root.optJSONObject("plan")),
        starredItems = parseFocusItems(root.optJSONArray("starredItems")),
        suggestedItems = parseFocusItems(root.optJSONArray("suggestedItems")),
        selectedItems = parseFocusItems(root.optJSONArray("selectedItems")),
        dueItems = parseFocusItems(root.optJSONArray("dueItems")),
        items = parseFocusItems(root.optJSONArray("items"))
      )
    }.getOrElse { parseError ->
      DailyPlanSnapshot(
        configured = true,
        readOnly = true,
        lastSyncedAt = lastSyncedAt,
        error = error ?: "Could not read daily plan: ${parseError.message ?: parseError.javaClass.simpleName}"
      )
    }
  }

  fun parseVocabularySnapshot(
    rawJson: String?,
    lastSyncedAt: String? = null,
    configured: Boolean = true,
    error: String? = null
  ): VocabularySnapshot {
    if (!configured) {
      return VocabularySnapshot(
        configured = false,
        readOnly = true,
        error = error
      )
    }
    if (rawJson.isNullOrBlank()) {
      return VocabularySnapshot(
        configured = true,
        readOnly = error != null,
        lastSyncedAt = lastSyncedAt,
        error = error
      )
    }

    return runCatching {
      val root = JSONObject(rawJson)
      val entries = parseVocabularyEntries(root.optJSONArray("entries"))
      VocabularySnapshot(
        generatedAt = root.optStringOrNull("generatedAt") ?: "",
        lastSyncedAt = lastSyncedAt,
        configured = true,
        readOnly = error != null,
        error = error,
        categories = parseStringArray(root.optJSONArray("categories")),
        entries = entries,
        encountersByEntryId = parseVocabularyEncounters(root.optJSONObject("encountersByEntryId"))
      )
    }.getOrElse { parseError ->
      VocabularySnapshot(
        configured = true,
        readOnly = true,
        lastSyncedAt = lastSyncedAt,
        error = error ?: "Could not read vocabulary data: ${parseError.message ?: parseError.javaClass.simpleName}"
      )
    }
  }

  fun parseMessageSnapshot(
    rawJson: String?,
    lastSyncedAt: String? = null,
    configured: Boolean = true,
    error: String? = null
  ): MessageSnapshot {
    if (!configured) {
      return MessageSnapshot(
        configured = false,
        readOnly = true,
        error = error
      )
    }
    if (rawJson.isNullOrBlank()) {
      return MessageSnapshot(
        configured = true,
        readOnly = error != null,
        lastSyncedAt = lastSyncedAt,
        error = error
      )
    }
    return runCatching {
      val root = JSONObject(rawJson)
      val messages = root.optJSONArray("messages")
      MessageSnapshot(
        configured = true,
        readOnly = error != null,
        error = error,
        lastSyncedAt = lastSyncedAt,
        messages = buildList {
          if (messages != null) {
            for (index in 0 until messages.length()) {
              val message = messages.optJSONObject(index) ?: continue
              val id = message.optString("id")
              val text = message.optString("text")
              if (id.isBlank() || text.isBlank()) continue
              val direction = message.optStringOrNull("direction") ?: "inbound"
              add(
                MessageTurn(
                  id = id,
                  role = if (direction == "outbound") "assistant" else "user",
                  text = text,
                  occurredAt = message.optStringOrNull("occurredAt") ?: "",
                  pending = message.optBoolean("pending", false)
                )
              )
            }
          }
        }
      )
    }.getOrElse { parseError ->
      MessageSnapshot(
        configured = true,
        readOnly = true,
        lastSyncedAt = lastSyncedAt,
        error = error ?: "Could not read messages: ${parseError.message ?: parseError.javaClass.simpleName}"
      )
    }
  }

  private fun parseDailyPlanSummary(plan: JSONObject?): DailyPlanSummary {
    if (plan == null) return DailyPlanSummary()
    return DailyPlanSummary(
      id = plan.optStringOrNull("id"),
      selectedItemIds = parseStringArray(plan.optJSONArray("selectedItemIds")),
      suggestedItemIds = parseStringArray(plan.optJSONArray("suggestedItemIds")),
      suggestionSource = plan.optStringOrNull("suggestionSource") ?: "heuristic",
      status = plan.optStringOrNull("status") ?: "",
      updatedAt = plan.optStringOrNull("updatedAt")
    )
  }

  private fun parseFocusItems(items: JSONArray?): List<FocusItem> =
    buildList {
      if (items == null) return@buildList
      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val id = item.optString("id")
        val title = item.optString("title")
        if (id.isBlank() || title.isBlank()) continue
        val signals = item.optJSONArray("prioritySignals")
        add(
          FocusItem(
            id = id,
            title = title,
            kind = item.optString("kind", "task"),
            status = item.optString("status", "open"),
            starred = item.optBoolean("starred", false),
            starredAt = item.optStringOrNull("starredAt"),
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
            hiddenUntil = item.optStringOrNull("hiddenUntil"),
            dueAt = item.optStringOrNull("dueAt"),
            completedAt = item.optStringOrNull("completedAt"),
            completion = parseFocusCompletion(item.optJSONObject("completion")),
            progress = parseProgress(item.optJSONObject("progress")),
            checklist = parseChecklist(item.optJSONObject("checklist")),
            recurrence = parseFocusRecurrence(item.optJSONObject("recurrence")),
            scope = parseScope(item.optJSONObject("scope"))
          )
        )
      }
    }

  private fun parseFocusCompletion(completion: JSONObject?): FocusCompletion =
    FocusCompletion(
      completedToday = completion?.optBoolean("completedToday", false) ?: false,
      completedAt = completion?.optStringOrNull("completedAt")
    )

  private fun parseFocusRecurrence(recurrence: JSONObject?): FocusRecurrence? {
    if (recurrence == null) return null
    return FocusRecurrence(
      policy = parseFocusRecurrencePolicy(recurrence.optJSONObject("policy")),
      week = parseFocusRecurrenceWeek(recurrence.optJSONObject("week")),
      state = parseFocusRecurrenceState(recurrence.optJSONObject("state"))
    )
  }

  private fun parseFocusRecurrencePolicy(policy: JSONObject?): FocusRecurrencePolicy =
    FocusRecurrencePolicy(
      id = policy?.optStringOrNull("id") ?: "",
      type = policy?.optStringOrNull("type") ?: "",
      intervalDays = policy?.optNullableInt("intervalDays"),
      minimumIntervalDays = policy?.optNullableInt("minimumIntervalDays"),
      cron = policy?.optStringOrNull("cron"),
      targetCount = policy?.optNullableInt("targetCount"),
      targetWindowDays = policy?.optNullableInt("targetWindowDays"),
      preferredDays = parseStringArray(policy?.optJSONArray("preferredDays"))
    )

  private fun parseFocusRecurrenceWeek(week: JSONObject?): FocusRecurrenceWeek {
    val days = week?.optJSONArray("days")
    return FocusRecurrenceWeek(
      startDate = week?.optStringOrNull("startDate") ?: "",
      endDate = week?.optStringOrNull("endDate") ?: "",
      days = buildList {
        if (days != null) {
          for (index in 0 until days.length()) {
            val day = days.optJSONObject(index) ?: continue
            val date = day.optString("date")
            if (date.isBlank()) continue
            add(
              FocusRecurrenceDay(
                date = date,
                weekday = day.optStringOrNull("weekday") ?: "",
                status = day.optStringOrNull("status") ?: "none",
                eventId = day.optStringOrNull("eventId"),
                occurredAt = day.optStringOrNull("occurredAt")
              )
            )
          }
        }
      },
      completedCount = week?.optInt("completedCount", 0) ?: 0,
      targetCount = week?.optNullableInt("targetCount"),
      targetWindowDays = week?.optInt("targetWindowDays", 7) ?: 7
    )
  }

  private fun parseFocusRecurrenceState(state: JSONObject?): FocusRecurrenceState? {
    if (state == null) return null
    return FocusRecurrenceState(
      lastCompletedAt = state.optStringOrNull("lastCompletedAt"),
      nextEligibleAt = state.optStringOrNull("nextEligibleAt"),
      nextDueAt = state.optStringOrNull("nextDueAt"),
      stalenessScore = state.optInt("stalenessScore", 0)
    )
  }

  private fun parseShoppingItems(items: JSONArray?, now: Instant): List<ShoppingItem> =
    buildList {
      if (items == null) return@buildList
      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val id = item.optString("id")
        val name = item.optString("name")
        if (id.isBlank() || name.isBlank()) continue
        val checked = item.optBoolean("checked", false)
        val checkedAt = item.optStringOrNull("checkedAt")
        if (checked && shoppingCheckedExpired(checkedAt, now)) continue
        add(
          ShoppingItem(
            id = id,
            name = name,
            normalizedName = item.optStringOrNull("normalizedName") ?: name.lowercase(),
            category = item.optStringOrNull("category") ?: "miscellaneous",
            quantity = item.optStringOrNull("quantity"),
            note = item.optStringOrNull("note"),
            checked = checked,
            checkedAt = checkedAt,
            source = item.optStringOrNull("source") ?: "manual",
            sortOrder = item.optInt("sortOrder", 0),
            catalogItemId = item.optStringOrNull("catalogItemId"),
            createdAt = item.optStringOrNull("createdAt") ?: "",
            updatedAt = item.optStringOrNull("updatedAt") ?: ""
          )
        )
      }
    }

  private fun shoppingCheckedExpired(checkedAt: String?, now: Instant): Boolean =
    checkedAt
      ?.let { rawCheckedAt ->
        runCatching {
          !Instant.parse(rawCheckedAt).plus(SHOPPING_CHECKED_LINGER_DURATION).isAfter(now)
        }.getOrDefault(false)
      }
      ?: false

  private fun parseShoppingSuggestions(items: JSONArray?): List<ShoppingSuggestion> =
    buildList {
      if (items == null) return@buildList
      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val id = item.optString("id")
        val name = item.optString("name")
        if (id.isBlank() || name.isBlank()) continue
        add(
          ShoppingSuggestion(
            id = id,
            name = name,
            normalizedName = item.optStringOrNull("normalizedName") ?: name.lowercase(),
            category = item.optStringOrNull("category") ?: "miscellaneous",
            lastPurchasedAt = item.optStringOrNull("lastPurchasedAt"),
            purchaseCount = item.optInt("purchaseCount", 0)
          )
        )
      }
    }

  private fun parseVocabularyEntries(items: JSONArray?): List<VocabularyEntry> =
    buildList {
      if (items == null) return@buildList
      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val id = item.optString("id")
        val term = item.optString("term")
        if (id.isBlank() || term.isBlank()) continue
        add(
          VocabularyEntry(
            id = id,
            term = term,
            normalizedTerm = item.optStringOrNull("normalizedTerm") ?: term.lowercase(),
            languageCode = item.optStringOrNull("languageCode") ?: "en",
            category = item.optStringOrNull("category") ?: "general",
            definition = item.optStringOrNull("definition"),
            partOfSpeech = item.optStringOrNull("partOfSpeech"),
            pronunciation = item.optStringOrNull("pronunciation"),
            translation = item.optStringOrNull("translation"),
            notes = item.optStringOrNull("notes"),
            tags = parseStringArray(item.optJSONArray("tags")),
            definitionSource = item.optStringOrNull("definitionSource") ?: "manual",
            status = item.optStringOrNull("status") ?: "active",
            createdAt = item.optStringOrNull("createdAt") ?: "",
            updatedAt = item.optStringOrNull("updatedAt") ?: ""
          )
        )
      }
    }

  private fun parseVocabularyEncounters(root: JSONObject?): Map<String, List<VocabularyEncounter>> {
    if (root == null) return emptyMap()
    val result = mutableMapOf<String, List<VocabularyEncounter>>()
    val keys = root.keys()
    while (keys.hasNext()) {
      val entryId = keys.next()
      val encounters = root.optJSONArray(entryId) ?: continue
      val parsed = buildList {
        for (index in 0 until encounters.length()) {
          val encounter = encounters.optJSONObject(index) ?: continue
          val id = encounter.optString("id")
          if (id.isBlank()) continue
          add(
            VocabularyEncounter(
              id = id,
              entryId = encounter.optStringOrNull("entryId") ?: entryId,
              sourceType = encounter.optStringOrNull("sourceType"),
              sourceTitle = encounter.optStringOrNull("sourceTitle"),
              sourceUrl = encounter.optStringOrNull("sourceUrl"),
              context = encounter.optStringOrNull("context"),
              occurredAt = encounter.optStringOrNull("occurredAt") ?: "",
              createdAt = encounter.optStringOrNull("createdAt") ?: ""
            )
          )
        }
      }
      result[entryId] = parsed
    }
    return result
  }

  private fun parseStringArray(items: JSONArray?): List<String> =
    buildList {
      if (items == null) return@buildList
      for (index in 0 until items.length()) {
        val value = items.optString(index)
        if (value.isNotBlank()) add(value)
      }
    }

  private fun parseProgress(progress: JSONObject?): WidgetProgress {
    if (progress == null) return WidgetProgress()
    val latest = progress.optJSONArray("latest")
    return WidgetProgress(
      count = progress.optInt("count", 0),
      latest = buildList {
        if (latest != null) {
          for (index in 0 until latest.length()) {
            val note = latest.optJSONObject(index) ?: continue
            val id = note.optString("id")
            val body = note.optString("body")
            if (id.isBlank() || body.isBlank()) continue
            add(
              WidgetProgressNote(
                id = id,
                body = body,
                occurredAt = note.optStringOrNull("occurredAt") ?: "",
                createdAt = note.optStringOrNull("createdAt") ?: "",
                updatedAt = note.optStringOrNull("updatedAt") ?: ""
              )
            )
          }
        }
      }
    )
  }

  private fun parseChecklist(checklist: JSONObject?): WidgetChecklist {
    if (checklist == null) return WidgetChecklist()
    val items = checklist.optJSONArray("items")
    return WidgetChecklist(
      total = checklist.optInt("total", 0),
      completed = checklist.optInt("completed", 0),
      moreCount = checklist.optInt("moreCount", 0),
      items = buildList {
        if (items != null) {
          for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val id = item.optString("id")
            val title = item.optString("title")
            if (id.isBlank() || title.isBlank()) continue
            add(
              WidgetChecklistItem(
                id = id,
                title = title,
                checked = item.optBoolean("checked", false),
                checkedAt = item.optStringOrNull("checkedAt"),
                sortOrder = item.optInt("sortOrder", index),
                createdAt = item.optStringOrNull("createdAt") ?: "",
                updatedAt = item.optStringOrNull("updatedAt") ?: ""
              )
            )
          }
        }
      }
    )
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

  private fun request(settings: RyanOsSettings, method: String, url: String, body: JSONObject? = null): String =
    request(method = method, url = url, body = body, sessionCookie = settings.sessionCookie)

  private fun request(method: String, url: String, body: JSONObject? = null, sessionCookie: String = ""): String =
    requestWithHeaders(method = method, url = url, body = body, sessionCookie = sessionCookie).body

  private fun requestWithHeaders(
    method: String,
    url: String,
    body: JSONObject? = null,
    sessionCookie: String = ""
  ): ApiResponse {
    val parsedUrl = URL(url)
    var lastError: IOException? = null
    repeat(2) { attempt ->
      try {
        return requestOnce(method = method, url = parsedUrl, body = body, sessionCookie = sessionCookie)
      } catch (error: IOException) {
        lastError = error
        if (!error.isRetryableNetworkError() || attempt == 1) {
          throw error.toUserFacingNetworkError(parsedUrl)
        }
        Thread.sleep(REQUEST_RETRY_DELAY_MS)
      }
    }
    throw (lastError ?: IOException("RyanOS sync failed.")).toUserFacingNetworkError(parsedUrl)
  }

  private fun requestOnce(method: String, url: URL, body: JSONObject? = null, sessionCookie: String = ""): ApiResponse {
    val connection = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 8_000
      readTimeout = 12_000
      setRequestProperty("Accept", "application/json")
      if (sessionCookie.isNotBlank()) {
        setRequestProperty("Cookie", sessionCookie)
      }
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
      return ApiResponse(
        body = responseText,
        headers = connection.headerFields
          .filterKeys { it != null }
          .mapKeys { it.key.orEmpty() }
          .mapValues { it.value.orEmpty() }
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun ApiResponse.sessionCookie(): String? {
    val setCookieValues = headers.entries
      .firstOrNull { (key, _) -> key.equals("Set-Cookie", ignoreCase = true) }
      ?.value
      .orEmpty()
    return setCookieValues
      .map { it.substringBefore(";").trim() }
      .filter { it.contains("=") }
      .joinToString("; ")
      .ifBlank { null }
  }

  private fun IOException.isRetryableNetworkError(): Boolean =
    this is UnknownHostException ||
      this is SocketTimeoutException ||
      cause is UnknownHostException ||
      cause is SocketTimeoutException

  private fun IOException.toUserFacingNetworkError(url: URL): IOException =
    when {
      this is UnknownHostException || cause is UnknownHostException -> IOException(
        "Unable to resolve RyanOS host \"${url.host}\". Check that Tailscale is connected and MagicDNS is enabled, then refresh again.",
        this
      )
      this is SocketTimeoutException || cause is SocketTimeoutException -> IOException(
        "RyanOS API timed out at \"${url.host}\". Check that the Lenovo server and Tailscale connection are reachable, then refresh again.",
        this
      )
      else -> this
    }

  private fun Map<String, String>.toQueryString(): String =
    entries.joinToString("&") { (key, value) -> "${key.urlEncode()}=${value.urlEncode()}" }

  private fun String.urlEncode(): String =
    URLEncoder.encode(this, StandardCharsets.UTF_8.name())

  internal fun androidReleaseManifestUrl(apiBaseUrl: String): String {
    val trimmed = apiBaseUrl.trim().trimEnd('/')
    if (trimmed.isBlank()) throw IOException("Enter the RyanOS API base URL before checking updates.")
    val uri = URI(trimmed)
    val scheme = uri.scheme ?: throw IOException("RyanOS API base URL must include https://")
    val authority = uri.rawAuthority ?: throw IOException("RyanOS API base URL must include a host.")
    val apiPath = uri.rawPath.orEmpty().trimEnd('/')
    val webPath = apiPath.removeSuffix("/api").trimEnd('/')
    return "$scheme://$authority$webPath/downloads/android/manifest.json"
  }

  internal fun parseAndroidReleaseManifest(rawJson: String, manifestUrl: String): AndroidReleaseManifest {
    val json = JSONObject(rawJson)
    val versionCode = json.optInt("versionCode", 0)
    val versionName = json.optString("versionName").ifBlank { "unknown" }
    val apkUrl = json.optString("apkUrl").ifBlank {
      throw IOException("Android update manifest is missing apkUrl.")
    }
    if (versionCode <= 0) throw IOException("Android update manifest is missing versionCode.")
    return AndroidReleaseManifest(
      versionCode = versionCode,
      versionName = versionName,
      apkUrl = URI(manifestUrl).resolve(apkUrl).toString(),
      apkSha256 = json.optStringOrNull("apkSha256"),
      apkSizeBytes = if (json.has("apkSizeBytes")) json.optLong("apkSizeBytes") else null,
      publishedAt = json.optStringOrNull("publishedAt")
    )
  }

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

  private fun JSONObject.updateDailyItem(itemId: String, update: (JSONObject) -> Unit) {
    listOf("items", "starredItems", "suggestedItems", "selectedItems", "dueItems").forEach { key ->
      val items = optJSONArray(key) ?: return@forEach
      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        if (item.optString("id") == itemId) update(item)
      }
    }
  }

  private fun JSONObject.updateWeekDayStatus(dateKey: String, completed: Boolean) {
    val days = optJSONArray("days") ?: return
    for (index in 0 until days.length()) {
      val day = days.optJSONObject(index) ?: continue
      if (day.optString("date") == dateKey) {
        day.put("status", if (completed) "completed" else "uncompleted")
        if (completed) day.put("occurredAt", Instant.now().toString()) else day.remove("occurredAt")
      }
    }
    var completedCount = 0
    for (index in 0 until days.length()) {
      if (days.optJSONObject(index)?.optString("status") == "completed") completedCount += 1
    }
    put("completedCount", completedCount)
  }

  private fun JSONObject?.optNullableInt(name: String): Int? {
    if (this == null || isNull(name)) return null
    return optInt(name)
  }

  private fun JSONObject?.optStringOrNull(name: String): String? {
    if (this == null || isNull(name)) return null
    return optString(name).takeIf { it.isNotBlank() }
  }
}
