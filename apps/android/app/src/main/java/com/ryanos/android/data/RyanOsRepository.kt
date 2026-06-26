package com.ryanos.android.data

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ryanos.android.util.WidgetTiming
import com.ryanos.android.widget.RyanOsShoppingWidgetReceiver
import com.ryanos.android.widget.RyanOsVocabularyWidgetReceiver
import com.ryanos.android.widget.RyanOsWidgetReceiver
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

private val Context.ryanOsDataStore: DataStore<Preferences> by preferencesDataStore(name = "ryanos_widget")

class RyanOsRepository private constructor(context: Context) {
  private val appContext = context.applicationContext
  private val dataStore = appContext.ryanOsDataStore

  val settingsFlow: Flow<RyanOsSettings> = dataStore.data
    .map { preferences -> preferences.toSettings() }
    .catch { emit(RyanOsSettings()) }

  val snapshotFlow: Flow<WidgetSnapshot> = dataStore.data
    .map { preferences ->
      val parseStart = WidgetTiming.now()
      val settings = preferences.toSettings()
      val error = preferences[LAST_ERROR]
      val snapshot = RyanOsApi.parseSnapshot(
        rawJson = preferences[CACHED_WIDGET_PAYLOAD],
        lastSyncedAt = preferences[LAST_SYNCED_AT],
        configured = settings.isConfigured,
        error = error,
        recurrenceLeadDaysBeforeDue = settings.recurrenceLeadDaysBeforeDue,
        showTaskDetails = settings.showTaskDetails,
        colorCodeByArea = settings.colorCodeByArea,
        expandedRecurrenceItemIds = preferences[EXPANDED_RECURRENCE_IDS] ?: emptySet(),
        expandedDetailItemIds = preferences[EXPANDED_DETAIL_IDS] ?: emptySet()
      )
      WidgetTiming.mark(
        operation = "repository.snapshotFlow",
        stage = "parse",
        startedAt = parseStart,
        details = "items=${snapshot.items.size} expanded=${snapshot.expandedRecurrenceItemIds.size}/${snapshot.expandedDetailItemIds.size} payloadChars=${preferences[CACHED_WIDGET_PAYLOAD]?.length ?: 0} error=${snapshot.error != null}"
      )
      snapshot
    }
    .catch {
      emit(
        WidgetSnapshot(
          configured = false,
          readOnly = true,
          error = it.message ?: "Could not read widget settings."
        )
      )
    }

  val shoppingSnapshotFlow: Flow<ShoppingSnapshot> = dataStore.data
    .map { preferences ->
      val settings = preferences.toSettings()
      RyanOsApi.parseShoppingSnapshot(
        rawJson = preferences[CACHED_SHOPPING_PAYLOAD],
        lastSyncedAt = preferences[SHOPPING_LAST_SYNCED_AT],
        configured = settings.isConfigured,
        error = preferences[SHOPPING_LAST_ERROR]
      )
    }
    .catch {
      emit(
        ShoppingSnapshot(
          configured = false,
          readOnly = true,
          error = it.message ?: "Could not read shopping settings."
        )
      )
    }

  val vocabularySnapshotFlow: Flow<VocabularySnapshot> = dataStore.data
    .map { preferences ->
      val settings = preferences.toSettings()
      RyanOsApi.parseVocabularySnapshot(
        rawJson = preferences[CACHED_VOCABULARY_PAYLOAD],
        lastSyncedAt = preferences[VOCABULARY_LAST_SYNCED_AT],
        configured = settings.isConfigured,
        error = preferences[VOCABULARY_LAST_ERROR]
      )
    }
    .catch {
      emit(
        VocabularySnapshot(
          configured = false,
          readOnly = true,
          error = it.message ?: "Could not read vocabulary settings."
        )
      )
    }

  val dailyPlanSnapshotFlow: Flow<DailyPlanSnapshot> = dataStore.data
    .map { preferences ->
      val settings = preferences.toSettings()
      RyanOsApi.parseDailyPlanSnapshot(
        rawJson = preferences[CACHED_DAILY_PLAN_PAYLOAD],
        lastSyncedAt = preferences[DAILY_PLAN_LAST_SYNCED_AT],
        configured = settings.isConfigured,
        error = preferences[DAILY_PLAN_LAST_ERROR]
      )
    }
    .catch {
      emit(
        DailyPlanSnapshot(
          configured = false,
          readOnly = true,
          error = it.message ?: "Could not read daily plan settings."
        )
      )
    }

  val messageSnapshotFlow: Flow<MessageSnapshot> = dataStore.data
    .map { preferences ->
      val settings = preferences.toSettings()
      RyanOsApi.parseMessageSnapshot(
        rawJson = preferences[CACHED_MESSAGES_PAYLOAD],
        lastSyncedAt = preferences[MESSAGES_LAST_SYNCED_AT],
        configured = settings.isConfigured,
        error = preferences[MESSAGES_LAST_ERROR]
      )
    }
    .catch {
      emit(
        MessageSnapshot(
          configured = false,
          readOnly = true,
          error = it.message ?: "Could not read chat settings."
        )
      )
    }

  suspend fun saveSettings(settings: RyanOsSettings) {
    dataStore.edit { preferences ->
      preferences[API_BASE_URL] = normalizeApiBaseUrl(settings.apiBaseUrl)
      preferences[USER_ID] = settings.userId.trim().ifBlank { "local-owner" }
      preferences[SESSION_COOKIE] = settings.sessionCookie.trim()
      preferences[TIMEZONE] = settings.timezone.trim().ifBlank { defaultTimezone() }
      preferences[RECURRENCE_LEAD_DAYS] = clampRecurrenceLeadDays(settings.recurrenceLeadDaysBeforeDue)
      preferences[SHOW_TASK_DETAILS] = settings.showTaskDetails
      preferences[COLOR_CODE_BY_AREA] = settings.colorCodeByArea
      preferences.remove(LAST_ERROR)
      preferences.remove(SHOPPING_LAST_ERROR)
      preferences.remove(VOCABULARY_LAST_ERROR)
      preferences.remove(DAILY_PLAN_LAST_ERROR)
      preferences.remove(MESSAGES_LAST_ERROR)
    }
  }

  suspend fun signIn(apiBaseUrl: String, email: String, password: String): RyanOsSettings = withContext(Dispatchers.IO) {
    val current = settingsFlow.first()
    val baseUrl = normalizeApiBaseUrl(apiBaseUrl)
    val cookie = RyanOsApi.signIn(
      settings = current.copy(apiBaseUrl = baseUrl),
      email = email.trim(),
      password = password
    )
    val next = current.copy(apiBaseUrl = baseUrl, sessionCookie = cookie)
    saveSettings(next)
    next
  }

  suspend fun signOut(): RyanOsSettings = withContext(Dispatchers.IO) {
    val current = settingsFlow.first()
    val next = current.copy(sessionCookie = "")
    saveSettings(next)
    next
  }

  suspend fun checkAndroidUpdate(): AndroidReleaseManifest = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    RyanOsApi.fetchAndroidReleaseManifest(settings)
  }

  suspend fun toggleRecurrenceExpanded(itemId: String): WidgetSnapshot = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "repository.toggleRecurrenceExpanded",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)}"
    )
    val editStart = WidgetTiming.now()
    dataStore.edit { preferences ->
      val current = preferences[EXPANDED_RECURRENCE_IDS] ?: emptySet()
      preferences[EXPANDED_RECURRENCE_IDS] =
        if (current.contains(itemId)) current - itemId else current + itemId
    }
    WidgetTiming.mark("repository.toggleRecurrenceExpanded", "dataStore.edit", editStart)
    val snapshotStart = WidgetTiming.now()
    val snapshot = snapshotFlow.first()
    WidgetTiming.mark(
      operation = "repository.toggleRecurrenceExpanded",
      stage = "snapshotFlow.first",
      startedAt = snapshotStart,
      details = "items=${snapshot.items.size} expanded=${snapshot.expandedRecurrenceItemIds.size} total=${WidgetTiming.elapsed(operationStart)}ms"
    )
    snapshot
  }

  suspend fun setRecurrenceExpanded(itemId: String, expanded: Boolean): WidgetSnapshot = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "repository.setRecurrenceExpanded",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)} expanded=$expanded"
    )
    val editStart = WidgetTiming.now()
    dataStore.edit { preferences ->
      val current = preferences[EXPANDED_RECURRENCE_IDS] ?: emptySet()
      preferences[EXPANDED_RECURRENCE_IDS] =
        if (expanded) current + itemId else current - itemId
    }
    WidgetTiming.mark("repository.setRecurrenceExpanded", "dataStore.edit", editStart)
    val snapshotStart = WidgetTiming.now()
    val snapshot = snapshotFlow.first()
    WidgetTiming.mark(
      operation = "repository.setRecurrenceExpanded",
      stage = "snapshotFlow.first",
      startedAt = snapshotStart,
      details = "items=${snapshot.items.size} expanded=${snapshot.expandedRecurrenceItemIds.size} total=${WidgetTiming.elapsed(operationStart)}ms"
    )
    snapshot
  }

  suspend fun toggleDetailsExpanded(itemId: String): WidgetSnapshot = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "repository.toggleDetailsExpanded",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)}"
    )
    val editStart = WidgetTiming.now()
    dataStore.edit { preferences ->
      val current = preferences[EXPANDED_DETAIL_IDS] ?: emptySet()
      preferences[EXPANDED_DETAIL_IDS] =
        if (current.contains(itemId)) current - itemId else current + itemId
    }
    WidgetTiming.mark("repository.toggleDetailsExpanded", "dataStore.edit", editStart)
    val snapshotStart = WidgetTiming.now()
    val snapshot = snapshotFlow.first()
    WidgetTiming.mark(
      operation = "repository.toggleDetailsExpanded",
      stage = "snapshotFlow.first",
      startedAt = snapshotStart,
      details = "items=${snapshot.items.size} expanded=${snapshot.expandedDetailItemIds.size} total=${WidgetTiming.elapsed(operationStart)}ms"
    )
    snapshot
  }

  suspend fun refresh(): WidgetSnapshot = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event("repository.refresh", "start")
    val settingsStart = WidgetTiming.now()
    val settings = settingsFlow.first()
    WidgetTiming.mark(
      operation = "repository.refresh",
      stage = "settingsFlow.first",
      startedAt = settingsStart,
      details = "configured=${settings.isConfigured}"
    )
    if (!settings.isConfigured) {
      val editStart = WidgetTiming.now()
      dataStore.edit { preferences ->
        preferences.remove(CACHED_WIDGET_PAYLOAD)
        preferences.remove(LAST_SYNCED_AT)
        preferences[LAST_ERROR] = "Connect the widget to your RyanOS API."
      }
      WidgetTiming.mark("repository.refresh", "dataStore.edit.notConfigured", editStart)
      val snapshotStart = WidgetTiming.now()
      val snapshot = snapshotFlow.first()
      WidgetTiming.mark(
        operation = "repository.refresh",
        stage = "snapshotFlow.first.notConfigured",
        startedAt = snapshotStart,
        details = "total=${WidgetTiming.elapsed(operationStart)}ms"
      )
      return@withContext snapshot
    }

    runCatching {
      val fetchStart = WidgetTiming.now()
      val result = RyanOsApi.fetchWidgetPayload(settings)
      WidgetTiming.mark(
        operation = "repository.refresh",
        stage = "api.fetchWidgetPayload",
        startedAt = fetchStart,
        details = "items=${result.snapshot.items.size} payloadChars=${result.rawJson.length}"
      )
      val editStart = WidgetTiming.now()
      dataStore.edit { preferences ->
        preferences[CACHED_WIDGET_PAYLOAD] = result.rawJson
        preferences[LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(LAST_ERROR)
      }
      WidgetTiming.mark("repository.refresh", "dataStore.edit.success", editStart)
      val snapshotStart = WidgetTiming.now()
      val snapshot = snapshotFlow.first()
      WidgetTiming.mark(
        operation = "repository.refresh",
        stage = "snapshotFlow.first.success",
        startedAt = snapshotStart,
        details = "items=${snapshot.items.size} total=${WidgetTiming.elapsed(operationStart)}ms"
      )
      snapshot
    }.getOrElse { error ->
      WidgetTiming.event(
        operation = "repository.refresh",
        event = "error",
        details = error.userFacingMessage()
      )
      val editStart = WidgetTiming.now()
      dataStore.edit { preferences ->
        preferences[LAST_ERROR] = error.userFacingMessage()
      }
      WidgetTiming.mark("repository.refresh", "dataStore.edit.error", editStart)
      val snapshotStart = WidgetTiming.now()
      val snapshot = snapshotFlow.first()
      WidgetTiming.mark(
        operation = "repository.refresh",
        stage = "snapshotFlow.first.error",
        startedAt = snapshotStart,
        details = "items=${snapshot.items.size} total=${WidgetTiming.elapsed(operationStart)}ms"
      )
      snapshot
    }
  }

  suspend fun refreshShopping(): ShoppingSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) {
      dataStore.edit { preferences ->
        preferences.remove(CACHED_SHOPPING_PAYLOAD)
        preferences.remove(SHOPPING_LAST_SYNCED_AT)
        preferences[SHOPPING_LAST_ERROR] = "Connect the widget to your RyanOS API."
      }
      return@withContext shoppingSnapshotFlow.first()
    }

    runCatching {
      val result = RyanOsApi.fetchShoppingPayload(settings)
      dataStore.edit { preferences ->
        preferences[CACHED_SHOPPING_PAYLOAD] = result.rawJson
        preferences[SHOPPING_LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(SHOPPING_LAST_ERROR)
      }
      shoppingSnapshotFlow.first()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[SHOPPING_LAST_ERROR] = error.userFacingMessage()
      }
      shoppingSnapshotFlow.first()
    }
  }

  suspend fun refreshVocabulary(): VocabularySnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) {
      dataStore.edit { preferences ->
        preferences.remove(CACHED_VOCABULARY_PAYLOAD)
        preferences.remove(VOCABULARY_LAST_SYNCED_AT)
        preferences[VOCABULARY_LAST_ERROR] = "Connect the widget to your RyanOS API."
      }
      return@withContext vocabularySnapshotFlow.first()
    }

    runCatching {
      val result = RyanOsApi.fetchVocabularyPayload(settings)
      dataStore.edit { preferences ->
        preferences[CACHED_VOCABULARY_PAYLOAD] = result.rawJson
        preferences[VOCABULARY_LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(VOCABULARY_LAST_ERROR)
      }
      vocabularySnapshotFlow.first()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[VOCABULARY_LAST_ERROR] = error.userFacingMessage()
      }
      vocabularySnapshotFlow.first()
    }
  }

  suspend fun refreshDailyPlan(): DailyPlanSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) {
      dataStore.edit { preferences ->
        preferences.remove(CACHED_DAILY_PLAN_PAYLOAD)
        preferences.remove(DAILY_PLAN_LAST_SYNCED_AT)
        preferences[DAILY_PLAN_LAST_ERROR] = "Connect RyanOS to load today."
      }
      return@withContext dailyPlanSnapshotFlow.first()
    }

    runCatching {
      val result = RyanOsApi.fetchDailyPlanPayload(settings)
      dataStore.edit { preferences ->
        preferences[CACHED_DAILY_PLAN_PAYLOAD] = result.rawJson
        preferences[DAILY_PLAN_LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(DAILY_PLAN_LAST_ERROR)
      }
      dailyPlanSnapshotFlow.first()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[DAILY_PLAN_LAST_ERROR] = error.userFacingMessage()
      }
      dailyPlanSnapshotFlow.first()
    }
  }

  suspend fun suggestDailyPlan(): DailyPlanSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext refreshDailyPlan()
    runCatching {
      val result = RyanOsApi.suggestDailyPlanPayload(settings)
      dataStore.edit { preferences ->
        preferences[CACHED_DAILY_PLAN_PAYLOAD] = result.rawJson
        preferences[DAILY_PLAN_LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(DAILY_PLAN_LAST_ERROR)
      }
      dailyPlanSnapshotFlow.first()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[DAILY_PLAN_LAST_ERROR] = error.userFacingMessage()
      }
      dailyPlanSnapshotFlow.first()
    }
  }

  suspend fun refreshMessages(): MessageSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) {
      dataStore.edit { preferences ->
        preferences.remove(CACHED_MESSAGES_PAYLOAD)
        preferences.remove(MESSAGES_LAST_SYNCED_AT)
        preferences[MESSAGES_LAST_ERROR] = "Connect RyanOS to load chat."
      }
      return@withContext messageSnapshotFlow.first()
    }

    runCatching {
      val result = RyanOsApi.fetchMessagesPayload(settings)
      dataStore.edit { preferences ->
        preferences[CACHED_MESSAGES_PAYLOAD] = result.rawJson
        preferences[MESSAGES_LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(MESSAGES_LAST_ERROR)
      }
      messageSnapshotFlow.first()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[MESSAGES_LAST_ERROR] = error.userFacingMessage()
      }
      messageSnapshotFlow.first()
    }
  }

  suspend fun createItem(title: String): WidgetSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext refresh()
    runCatching {
      RyanOsApi.createItem(settings, title.trim())
      refresh()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[LAST_ERROR] = error.userFacingMessage()
      }
      snapshotFlow.first()
    }
  }

  suspend fun createItemAndRefreshToday(title: String): DailyPlanSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext refreshDailyPlan()
    runCatching {
      RyanOsApi.createItem(settings, title.trim())
      refresh()
      refreshDailyPlan()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[DAILY_PLAN_LAST_ERROR] = error.userFacingMessage()
      }
      dailyPlanSnapshotFlow.first()
    }
  }

  suspend fun createShoppingItem(name: String, category: String?, quantity: String?): ShoppingSnapshot =
    withContext(Dispatchers.IO) {
      val settings = settingsFlow.first()
      if (!settings.isConfigured) return@withContext refreshShopping()
      runCatching {
        RyanOsApi.createShoppingItem(
          settings = settings,
          name = name.trim(),
          category = category?.trim()?.ifBlank { null },
          quantity = quantity?.trim()?.ifBlank { null }
        )
        refreshShopping()
      }.getOrElse { error ->
        dataStore.edit { preferences ->
          preferences[SHOPPING_LAST_ERROR] = error.userFacingMessage()
        }
        shoppingSnapshotFlow.first()
      }
    }

  suspend fun patchShoppingItem(itemId: String, patch: ShoppingItemPatch): ShoppingSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext refreshShopping()
    runCatching {
      val result = RyanOsApi.patchShoppingItem(settings, itemId, patch)
      dataStore.edit { preferences ->
        preferences[CACHED_SHOPPING_PAYLOAD] = result.rawJson
        preferences[SHOPPING_LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(SHOPPING_LAST_ERROR)
      }
      shoppingSnapshotFlow.first()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[SHOPPING_LAST_ERROR] = error.userFacingMessage()
      }
      shoppingSnapshotFlow.first()
    }
  }

  suspend fun createVocabularyEntry(
    term: String,
    languageCode: String?,
    category: String?,
    context: String?
  ): VocabularySnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext refreshVocabulary()
    runCatching {
      RyanOsApi.createVocabularyEntry(
        settings = settings,
        term = term.trim(),
        languageCode = languageCode?.trim()?.ifBlank { null },
        category = category?.trim()?.ifBlank { null },
        context = context?.trim()?.ifBlank { null }
      )
      refreshVocabulary()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[VOCABULARY_LAST_ERROR] = error.userFacingMessage()
      }
      vocabularySnapshotFlow.first()
    }
  }

  suspend fun patchVocabularyEntry(entryId: String, patch: VocabularyEntryPatch): VocabularySnapshot =
    withContext(Dispatchers.IO) {
      val settings = settingsFlow.first()
      if (!settings.isConfigured) return@withContext refreshVocabulary()
      runCatching {
        val result = RyanOsApi.patchVocabularyEntry(settings, entryId, patch)
        dataStore.edit { preferences ->
          preferences[CACHED_VOCABULARY_PAYLOAD] = result.rawJson
          preferences[VOCABULARY_LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
          preferences.remove(VOCABULARY_LAST_ERROR)
        }
        vocabularySnapshotFlow.first()
      }.getOrElse { error ->
        dataStore.edit { preferences ->
          preferences[VOCABULARY_LAST_ERROR] = error.userFacingMessage()
        }
        vocabularySnapshotFlow.first()
      }
    }

  suspend fun sendChatMessage(text: String): MessageSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext refreshMessages()
    dataStore.edit { preferences ->
      preferences[CACHED_MESSAGES_PAYLOAD] = RyanOsApi.optimisticallyAppendMessagePayload(
        rawJson = preferences[CACHED_MESSAGES_PAYLOAD],
        text = text.trim()
      )
      preferences.remove(MESSAGES_LAST_ERROR)
    }
    runCatching {
      RyanOsApi.sendMessage(settings, text.trim())
      refreshMessages()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[MESSAGES_LAST_ERROR] = error.userFacingMessage()
      }
      messageSnapshotFlow.first()
    }
  }

  suspend fun toggleShoppingItemOptimistically(itemId: String, checked: Boolean): ShoppingSnapshot =
    withContext(Dispatchers.IO) {
      val settings = settingsFlow.first()
      if (!settings.isConfigured) return@withContext shoppingSnapshotFlow.first()
      dataStore.edit { preferences ->
        val updatedPayload = RyanOsApi.optimisticallyToggleShoppingPayload(
          rawJson = preferences[CACHED_SHOPPING_PAYLOAD],
          itemId = itemId,
          checked = checked
        )
        if (!updatedPayload.isNullOrBlank()) {
          preferences[CACHED_SHOPPING_PAYLOAD] = updatedPayload
        }
        preferences.remove(SHOPPING_LAST_ERROR)
      }
      shoppingSnapshotFlow.first()
    }

  suspend fun cachedShoppingCheckedState(itemId: String): Boolean? = withContext(Dispatchers.IO) {
    shoppingSnapshotFlow.first().items.firstOrNull { it.id == itemId }?.checked
  }

  suspend fun sendShoppingToggle(itemId: String, checked: Boolean): Boolean = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext false
    runCatching {
      RyanOsApi.toggleShoppingItem(settings = settings, itemId = itemId, checked = checked)
      true
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[SHOPPING_LAST_ERROR] = error.userFacingMessage()
      }
      false
    }
  }

  suspend fun toggleDailyItemOptimistically(item: FocusItem, completed: Boolean, date: String? = null): DailyPlanSnapshot =
    withContext(Dispatchers.IO) {
      val settings = settingsFlow.first()
      if (!settings.isConfigured) return@withContext dailyPlanSnapshotFlow.first()
      val actionDate = date ?: dailyPlanSnapshotFlow.first().date.takeIf { it.isNotBlank() }
      dataStore.edit { preferences ->
        val updatedPayload = RyanOsApi.optimisticallyToggleDailyPlanPayload(
          rawJson = preferences[CACHED_DAILY_PLAN_PAYLOAD],
          itemId = item.id,
          completed = completed,
          date = actionDate,
          timezone = settings.timezone
        )
        if (!updatedPayload.isNullOrBlank()) preferences[CACHED_DAILY_PLAN_PAYLOAD] = updatedPayload
        preferences.remove(DAILY_PLAN_LAST_ERROR)
      }
      dailyPlanSnapshotFlow.first()
    }

  suspend fun sendToggleDailyItem(item: FocusItem, completed: Boolean, date: String? = null): Boolean =
    withContext(Dispatchers.IO) {
      val settings = settingsFlow.first()
      if (!settings.isConfigured) return@withContext false
      val actionDate = date ?: dailyPlanSnapshotFlow.first().date.takeIf { it.isNotBlank() }
      val allowEarly = item.recurrence?.let { recurrence ->
        val nextEligibleDate = recurrence.state?.nextEligibleAt?.let {
          dateKeyInTimezone(value = it, timezone = settings.timezone)
        }
        recurrence.policy.minimumIntervalDays != null &&
          actionDate != null &&
          nextEligibleDate != null &&
          actionDate < nextEligibleDate
      } ?: false
      runCatching {
        RyanOsApi.toggleItem(
          settings = settings,
          itemId = item.id,
          completed = completed,
          date = actionDate,
          allowEarly = allowEarly,
          toggleExisting = false
        )
        true
      }.getOrElse { error ->
        dataStore.edit { preferences ->
          preferences[DAILY_PLAN_LAST_ERROR] = error.userFacingMessage()
        }
        false
      }
    }

  suspend fun toggleStarOptimistically(itemId: String, starred: Boolean): DailyPlanSnapshot =
    withContext(Dispatchers.IO) {
      val settings = settingsFlow.first()
      if (!settings.isConfigured) return@withContext dailyPlanSnapshotFlow.first()
      dataStore.edit { preferences ->
        val updatedPayload = RyanOsApi.optimisticallyStarDailyPlanPayload(
          rawJson = preferences[CACHED_DAILY_PLAN_PAYLOAD],
          itemId = itemId,
          starred = starred
        )
        if (!updatedPayload.isNullOrBlank()) preferences[CACHED_DAILY_PLAN_PAYLOAD] = updatedPayload
        preferences.remove(DAILY_PLAN_LAST_ERROR)
      }
      dailyPlanSnapshotFlow.first()
    }

  suspend fun sendToggleStar(itemId: String, starred: Boolean): Boolean = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext false
    runCatching {
      RyanOsApi.toggleStar(settings, itemId, starred)
      true
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[DAILY_PLAN_LAST_ERROR] = error.userFacingMessage()
      }
      false
    }
  }

  fun canRequestPinWidgets(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      AppWidgetManager.getInstance(appContext).isRequestPinAppWidgetSupported

  fun requestPinWidget(kind: RyanOsWidgetKind): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "Widget pinning needs Android 8.0 or newer."
    val manager = AppWidgetManager.getInstance(appContext)
    if (!manager.isRequestPinAppWidgetSupported) return "This launcher does not support widget pin requests."
    val receiver = when (kind) {
      RyanOsWidgetKind.TODO -> RyanOsWidgetReceiver::class.java
      RyanOsWidgetKind.SHOPPING -> RyanOsShoppingWidgetReceiver::class.java
      RyanOsWidgetKind.VOCABULARY -> RyanOsVocabularyWidgetReceiver::class.java
    }
    manager.requestPinAppWidget(ComponentName(appContext, receiver), null, null)
    return "Widget pin request sent."
  }

  suspend fun toggleItemOptimistically(
    itemId: String,
    completed: Boolean,
    date: String?,
    allowEarly: Boolean,
    toggleExisting: Boolean = false,
    keepExpanded: Boolean = false
  ): WidgetSnapshot = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "repository.toggleItemOptimistically",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)} completed=$completed date=${date ?: "default"} allowEarly=$allowEarly toggleExisting=$toggleExisting keepExpanded=$keepExpanded"
    )
    val settingsStart = WidgetTiming.now()
    val settings = settingsFlow.first()
    WidgetTiming.mark(
      operation = "repository.toggleItemOptimistically",
      stage = "settingsFlow.first",
      startedAt = settingsStart,
      details = "configured=${settings.isConfigured}"
    )
    if (!settings.isConfigured) return@withContext snapshotFlow.first()
    val editStart = WidgetTiming.now()
    dataStore.edit { preferences ->
      val currentPayload = preferences[CACHED_WIDGET_PAYLOAD]
      val updatedPayload = RyanOsApi.optimisticallyToggleWidgetPayload(
        rawJson = currentPayload,
        itemId = itemId,
        completed = completed,
        date = date,
        timezone = settings.timezone,
        toggleExisting = toggleExisting
      )
      if (!updatedPayload.isNullOrBlank()) {
        preferences[CACHED_WIDGET_PAYLOAD] = updatedPayload
      }
      if (keepExpanded) {
        val current = preferences[EXPANDED_RECURRENCE_IDS] ?: emptySet()
        preferences[EXPANDED_RECURRENCE_IDS] = current + itemId
      }
      preferences.remove(LAST_ERROR)
    }
    WidgetTiming.mark("repository.toggleItemOptimistically", "dataStore.edit", editStart)
    val snapshotStart = WidgetTiming.now()
    val snapshot = snapshotFlow.first()
    WidgetTiming.mark(
      operation = "repository.toggleItemOptimistically",
      stage = "snapshotFlow.first",
      startedAt = snapshotStart,
      details = "items=${snapshot.items.size} total=${WidgetTiming.elapsed(operationStart)}ms"
    )
    snapshot
  }

  suspend fun toggleChecklistItemOptimistically(
    itemId: String,
    checklistItemId: String,
    checked: Boolean
  ): WidgetSnapshot = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "repository.toggleChecklistItemOptimistically",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)} checklist=${WidgetTiming.shortId(checklistItemId)} checked=$checked"
    )
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext snapshotFlow.first()
    dataStore.edit { preferences ->
      val updatedPayload = RyanOsApi.optimisticallyToggleChecklistPayload(
        rawJson = preferences[CACHED_WIDGET_PAYLOAD],
        itemId = itemId,
        checklistItemId = checklistItemId,
        checked = checked
      )
      if (!updatedPayload.isNullOrBlank()) {
        preferences[CACHED_WIDGET_PAYLOAD] = updatedPayload
      }
      preferences[EXPANDED_DETAIL_IDS] = (preferences[EXPANDED_DETAIL_IDS] ?: emptySet()) + itemId
      preferences.remove(LAST_ERROR)
    }
    val snapshot = snapshotFlow.first()
    WidgetTiming.mark(
      operation = "repository.toggleChecklistItemOptimistically",
      stage = "snapshotFlow.first",
      startedAt = operationStart,
      details = "items=${snapshot.items.size} total=${WidgetTiming.elapsed(operationStart)}ms"
    )
    snapshot
  }

  suspend fun cachedChecklistState(itemId: String, checklistItemId: String): Boolean? = withContext(Dispatchers.IO) {
    snapshotFlow.first().items
      .firstOrNull { it.id == itemId }
      ?.checklist
      ?.items
      ?.firstOrNull { it.id == checklistItemId }
      ?.checked
  }

  suspend fun sendToggleChecklistItem(
    itemId: String,
    checklistItemId: String,
    checked: Boolean
  ): Boolean = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext false
    runCatching {
      RyanOsApi.toggleChecklistItem(
        settings = settings,
        itemId = itemId,
        checklistItemId = checklistItemId,
        checked = checked
      )
      true
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[LAST_ERROR] = error.userFacingMessage()
      }
      false
    }
  }

  suspend fun cachedCompletionState(itemId: String, date: String?): Boolean? = withContext(Dispatchers.IO) {
    val snapshot = snapshotFlow.first()
    val item = snapshot.items.firstOrNull { it.id == itemId } ?: return@withContext null
    if (date == null) {
      item.checked
    } else {
      item.recurrence?.days?.firstOrNull { it.date == date }?.status?.let { it == "completed" }
        ?: item.checked
    }
  }

  suspend fun sendToggleItem(
    itemId: String,
    completed: Boolean,
    date: String?,
    allowEarly: Boolean,
    toggleExisting: Boolean = false
  ): Boolean = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "repository.sendToggleItem",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)} completed=$completed date=${date ?: "default"} allowEarly=$allowEarly toggleExisting=$toggleExisting"
    )
    val settingsStart = WidgetTiming.now()
    val settings = settingsFlow.first()
    WidgetTiming.mark(
      operation = "repository.sendToggleItem",
      stage = "settingsFlow.first",
      startedAt = settingsStart,
      details = "configured=${settings.isConfigured}"
    )
    if (!settings.isConfigured) return@withContext false
    runCatching {
      val apiStart = WidgetTiming.now()
      RyanOsApi.toggleItem(
        settings = settings,
        itemId = itemId,
        completed = completed,
        date = date,
        allowEarly = allowEarly,
        toggleExisting = toggleExisting
      )
      WidgetTiming.mark(
        operation = "repository.sendToggleItem",
        stage = "api.toggleItem",
        startedAt = apiStart,
        details = "total=${WidgetTiming.elapsed(operationStart)}ms"
      )
      true
    }.getOrElse { error ->
      WidgetTiming.event(
        operation = "repository.sendToggleItem",
        event = "error",
        details = error.userFacingMessage()
      )
      val editStart = WidgetTiming.now()
      dataStore.edit { preferences ->
        preferences[LAST_ERROR] = error.userFacingMessage()
      }
      WidgetTiming.mark("repository.sendToggleItem", "dataStore.edit.error", editStart)
      false
    }
  }

  suspend fun syncToggleItem(
    itemId: String,
    completed: Boolean,
    date: String?,
    allowEarly: Boolean,
    toggleExisting: Boolean = false
  ): WidgetSnapshot = withContext(Dispatchers.IO) {
    val operationStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "repository.syncToggleItem",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)} completed=$completed date=${date ?: "default"} allowEarly=$allowEarly toggleExisting=$toggleExisting"
    )
    val settingsStart = WidgetTiming.now()
    val settings = settingsFlow.first()
    WidgetTiming.mark(
      operation = "repository.syncToggleItem",
      stage = "settingsFlow.first",
      startedAt = settingsStart,
      details = "configured=${settings.isConfigured}"
    )
    if (!settings.isConfigured) return@withContext refresh()
    runCatching {
      val apiStart = WidgetTiming.now()
      RyanOsApi.toggleItem(
        settings = settings,
        itemId = itemId,
        completed = completed,
        date = date,
        allowEarly = allowEarly,
        toggleExisting = toggleExisting
      )
      WidgetTiming.mark("repository.syncToggleItem", "api.toggleItem", apiStart)
      val refreshStart = WidgetTiming.now()
      val snapshot = refresh()
      WidgetTiming.mark(
        operation = "repository.syncToggleItem",
        stage = "refresh.afterToggle",
        startedAt = refreshStart,
        details = "items=${snapshot.items.size} total=${WidgetTiming.elapsed(operationStart)}ms"
      )
      snapshot
    }.getOrElse { error ->
      WidgetTiming.event(
        operation = "repository.syncToggleItem",
        event = "error",
        details = error.userFacingMessage()
      )
      val editStart = WidgetTiming.now()
      dataStore.edit { preferences ->
        preferences[LAST_ERROR] = error.userFacingMessage()
      }
      WidgetTiming.mark("repository.syncToggleItem", "dataStore.edit.error", editStart)
      val snapshotStart = WidgetTiming.now()
      val snapshot = snapshotFlow.first()
      WidgetTiming.mark(
        operation = "repository.syncToggleItem",
        stage = "snapshotFlow.first.error",
        startedAt = snapshotStart,
        details = "items=${snapshot.items.size} total=${WidgetTiming.elapsed(operationStart)}ms"
      )
      snapshot
    }
  }

  private fun Preferences.toSettings(): RyanOsSettings =
    RyanOsSettings(
      apiBaseUrl = this[API_BASE_URL].orEmpty(),
      userId = this[USER_ID] ?: "local-owner",
      sessionCookie = this[SESSION_COOKIE].orEmpty(),
      timezone = this[TIMEZONE] ?: defaultTimezone(),
      recurrenceLeadDaysBeforeDue = clampRecurrenceLeadDays(
        this[RECURRENCE_LEAD_DAYS] ?: DEFAULT_RECURRENCE_LEAD_DAYS
      ),
      showTaskDetails = this[SHOW_TASK_DETAILS] ?: true,
      colorCodeByArea = this[COLOR_CODE_BY_AREA] ?: true
    )

  private fun Throwable.userFacingMessage(): String =
    message?.take(240)?.ifBlank { null } ?: "RyanOS sync failed."

  private fun dateKeyInTimezone(value: String, timezone: String): String =
    runCatching {
      Instant.parse(value).atZone(ZoneId.of(timezone)).toLocalDate().toString()
    }.getOrDefault(value.take(10))

  companion object {
    private val API_BASE_URL = stringPreferencesKey("api_base_url")
    private val USER_ID = stringPreferencesKey("user_id")
    private val SESSION_COOKIE = stringPreferencesKey("session_cookie")
    private val TIMEZONE = stringPreferencesKey("timezone")
    private val RECURRENCE_LEAD_DAYS = intPreferencesKey("recurrence_lead_days")
    private val SHOW_TASK_DETAILS = booleanPreferencesKey("show_task_details")
    private val COLOR_CODE_BY_AREA = booleanPreferencesKey("color_code_by_area")
    private val EXPANDED_RECURRENCE_IDS = stringSetPreferencesKey("expanded_recurrence_ids")
    private val EXPANDED_DETAIL_IDS = stringSetPreferencesKey("expanded_detail_ids")
    private val CACHED_WIDGET_PAYLOAD = stringPreferencesKey("cached_widget_payload")
    private val LAST_SYNCED_AT = stringPreferencesKey("last_synced_at")
    private val LAST_ERROR = stringPreferencesKey("last_error")
    private val CACHED_SHOPPING_PAYLOAD = stringPreferencesKey("cached_shopping_payload")
    private val SHOPPING_LAST_SYNCED_AT = stringPreferencesKey("shopping_last_synced_at")
    private val SHOPPING_LAST_ERROR = stringPreferencesKey("shopping_last_error")
    private val CACHED_VOCABULARY_PAYLOAD = stringPreferencesKey("cached_vocabulary_payload")
    private val VOCABULARY_LAST_SYNCED_AT = stringPreferencesKey("vocabulary_last_synced_at")
    private val VOCABULARY_LAST_ERROR = stringPreferencesKey("vocabulary_last_error")
    private val CACHED_DAILY_PLAN_PAYLOAD = stringPreferencesKey("cached_daily_plan_payload")
    private val DAILY_PLAN_LAST_SYNCED_AT = stringPreferencesKey("daily_plan_last_synced_at")
    private val DAILY_PLAN_LAST_ERROR = stringPreferencesKey("daily_plan_last_error")
    private val CACHED_MESSAGES_PAYLOAD = stringPreferencesKey("cached_messages_payload")
    private val MESSAGES_LAST_SYNCED_AT = stringPreferencesKey("messages_last_synced_at")
    private val MESSAGES_LAST_ERROR = stringPreferencesKey("messages_last_error")

    @Volatile
    private var instance: RyanOsRepository? = null

    fun getInstance(context: Context): RyanOsRepository =
      instance ?: synchronized(this) {
        instance ?: RyanOsRepository(context).also { instance = it }
      }
  }
}

enum class RyanOsWidgetKind {
  TODO,
  SHOPPING,
  VOCABULARY
}
