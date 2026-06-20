package com.ryanos.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ryanos.android.util.WidgetTiming
import java.time.Instant
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
        expandedRecurrenceItemIds = preferences[EXPANDED_RECURRENCE_IDS] ?: emptySet()
      )
      WidgetTiming.mark(
        operation = "repository.snapshotFlow",
        stage = "parse",
        startedAt = parseStart,
        details = "items=${snapshot.items.size} expanded=${snapshot.expandedRecurrenceItemIds.size} payloadChars=${preferences[CACHED_WIDGET_PAYLOAD]?.length ?: 0} error=${snapshot.error != null}"
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

  suspend fun saveSettings(settings: RyanOsSettings) {
    dataStore.edit { preferences ->
      preferences[API_BASE_URL] = settings.apiBaseUrl.trim()
      preferences[USER_ID] = settings.userId.trim().ifBlank { "local-owner" }
      preferences[TIMEZONE] = settings.timezone.trim().ifBlank { defaultTimezone() }
      preferences[RECURRENCE_LEAD_DAYS] = clampRecurrenceLeadDays(settings.recurrenceLeadDaysBeforeDue)
      preferences[SHOW_TASK_DETAILS] = settings.showTaskDetails
      preferences[COLOR_CODE_BY_AREA] = settings.colorCodeByArea
      preferences.remove(LAST_ERROR)
      preferences.remove(SHOPPING_LAST_ERROR)
    }
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
      timezone = this[TIMEZONE] ?: defaultTimezone(),
      recurrenceLeadDaysBeforeDue = clampRecurrenceLeadDays(
        this[RECURRENCE_LEAD_DAYS] ?: DEFAULT_RECURRENCE_LEAD_DAYS
      ),
      showTaskDetails = this[SHOW_TASK_DETAILS] ?: true,
      colorCodeByArea = this[COLOR_CODE_BY_AREA] ?: true
    )

  private fun Throwable.userFacingMessage(): String =
    message?.take(240)?.ifBlank { null } ?: "RyanOS sync failed."

  companion object {
    private val API_BASE_URL = stringPreferencesKey("api_base_url")
    private val USER_ID = stringPreferencesKey("user_id")
    private val TIMEZONE = stringPreferencesKey("timezone")
    private val RECURRENCE_LEAD_DAYS = intPreferencesKey("recurrence_lead_days")
    private val SHOW_TASK_DETAILS = booleanPreferencesKey("show_task_details")
    private val COLOR_CODE_BY_AREA = booleanPreferencesKey("color_code_by_area")
    private val EXPANDED_RECURRENCE_IDS = stringSetPreferencesKey("expanded_recurrence_ids")
    private val CACHED_WIDGET_PAYLOAD = stringPreferencesKey("cached_widget_payload")
    private val LAST_SYNCED_AT = stringPreferencesKey("last_synced_at")
    private val LAST_ERROR = stringPreferencesKey("last_error")
    private val CACHED_SHOPPING_PAYLOAD = stringPreferencesKey("cached_shopping_payload")
    private val SHOPPING_LAST_SYNCED_AT = stringPreferencesKey("shopping_last_synced_at")
    private val SHOPPING_LAST_ERROR = stringPreferencesKey("shopping_last_error")

    @Volatile
    private var instance: RyanOsRepository? = null

    fun getInstance(context: Context): RyanOsRepository =
      instance ?: synchronized(this) {
        instance ?: RyanOsRepository(context).also { instance = it }
      }
  }
}
