package com.ryanos.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
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
      val settings = preferences.toSettings()
      val error = preferences[LAST_ERROR]
      RyanOsApi.parseSnapshot(
        rawJson = preferences[CACHED_WIDGET_PAYLOAD],
        lastSyncedAt = preferences[LAST_SYNCED_AT],
        configured = settings.isConfigured,
        error = error
      )
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

  suspend fun saveSettings(settings: RyanOsSettings) {
    dataStore.edit { preferences ->
      preferences[API_BASE_URL] = settings.apiBaseUrl.trim()
      preferences[USER_ID] = settings.userId.trim().ifBlank { "local-owner" }
      preferences[TIMEZONE] = settings.timezone.trim().ifBlank { defaultTimezone() }
      preferences.remove(LAST_ERROR)
    }
  }

  suspend fun refresh(): WidgetSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) {
      dataStore.edit { preferences ->
        preferences.remove(CACHED_WIDGET_PAYLOAD)
        preferences.remove(LAST_SYNCED_AT)
        preferences[LAST_ERROR] = "Connect the widget to your RyanOS API."
      }
      return@withContext snapshotFlow.first()
    }

    runCatching {
      val result = RyanOsApi.fetchWidgetPayload(settings)
      dataStore.edit { preferences ->
        preferences[CACHED_WIDGET_PAYLOAD] = result.rawJson
        preferences[LAST_SYNCED_AT] = result.snapshot.lastSyncedAt ?: Instant.now().toString()
        preferences.remove(LAST_ERROR)
      }
      snapshotFlow.first()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[LAST_ERROR] = error.userFacingMessage()
      }
      snapshotFlow.first()
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

  suspend fun toggleItem(
    itemId: String,
    completed: Boolean,
    date: String?,
    allowEarly: Boolean
  ): WidgetSnapshot = withContext(Dispatchers.IO) {
    val settings = settingsFlow.first()
    if (!settings.isConfigured) return@withContext refresh()
    runCatching {
      RyanOsApi.toggleItem(
        settings = settings,
        itemId = itemId,
        completed = completed,
        date = date,
        allowEarly = allowEarly
      )
      refresh()
    }.getOrElse { error ->
      dataStore.edit { preferences ->
        preferences[LAST_ERROR] = error.userFacingMessage()
      }
      snapshotFlow.first()
    }
  }

  private fun Preferences.toSettings(): RyanOsSettings =
    RyanOsSettings(
      apiBaseUrl = this[API_BASE_URL].orEmpty(),
      userId = this[USER_ID] ?: "local-owner",
      timezone = this[TIMEZONE] ?: defaultTimezone()
    )

  private fun Throwable.userFacingMessage(): String =
    message?.take(240)?.ifBlank { null } ?: "RyanOS sync failed."

  companion object {
    private val API_BASE_URL = stringPreferencesKey("api_base_url")
    private val USER_ID = stringPreferencesKey("user_id")
    private val TIMEZONE = stringPreferencesKey("timezone")
    private val CACHED_WIDGET_PAYLOAD = stringPreferencesKey("cached_widget_payload")
    private val LAST_SYNCED_AT = stringPreferencesKey("last_synced_at")
    private val LAST_ERROR = stringPreferencesKey("last_error")

    @Volatile
    private var instance: RyanOsRepository? = null

    fun getInstance(context: Context): RyanOsRepository =
      instance ?: synchronized(this) {
        instance ?: RyanOsRepository(context).also { instance = it }
      }
  }
}
