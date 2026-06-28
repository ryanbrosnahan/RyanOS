package com.ryanos.android.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ryanos.android.BuildConfig
import com.ryanos.android.data.AndroidUpdateStatus
import com.ryanos.android.data.FocusItem
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.data.RyanOsSettings
import com.ryanos.android.data.RyanOsWidgetKind
import com.ryanos.android.data.ShoppingItem
import com.ryanos.android.data.ShoppingItemPatch
import com.ryanos.android.data.VocabularyEntryPatch
import com.ryanos.android.widget.RyanOsShoppingWidgetRenderer
import com.ryanos.android.widget.RyanOsVocabularyWidgetRenderer
import com.ryanos.android.widget.RyanOsWidgetRenderer
import kotlinx.coroutines.launch

class RyanOsViewModel(application: Application) : AndroidViewModel(application) {
  private val appContext = application.applicationContext
  val repository: RyanOsRepository = RyanOsRepository.getInstance(appContext)

  val settingsFlow = repository.settingsFlow
  val todoFlow = repository.snapshotFlow
  val dailyPlanFlow = repository.dailyPlanSnapshotFlow
  val shoppingFlow = repository.shoppingSnapshotFlow
  val vocabularyFlow = repository.vocabularySnapshotFlow
  val messageFlow = repository.messageSnapshotFlow

  var busyLabel by mutableStateOf<String?>(null)
    private set
  var statusText by mutableStateOf("")
    private set
  var androidUpdateStatus by mutableStateOf<AndroidUpdateStatus?>(null)
    private set

  val busy: Boolean
    get() = busyLabel != null

  fun setStatus(message: String) {
    statusText = message
  }

  fun refreshInitial() {
    launchWork("Refreshing") {
      repository.refreshDailyPlan()
      repository.refresh()
      repository.refreshShopping()
      repository.refreshVocabulary()
      repository.refreshMessages()
      updateWidgets()
      statusText = "Refreshed"
    }
  }

  fun refreshToday() {
    launchWork("Refreshing today") {
      repository.refreshDailyPlan()
      repository.refresh()
      updateWidgets()
      statusText = "Today refreshed"
    }
  }

  fun suggestToday() {
    launchWork("Planning today") {
      repository.suggestDailyPlan()
      statusText = "Daily suggestion refreshed"
    }
  }

  fun addTask(title: String) {
    val cleanTitle = title.trim()
    if (cleanTitle.isBlank()) return
    launchWork("Adding task") {
      repository.createItemAndRefreshToday(cleanTitle)
      repository.refresh()
      updateWidgets()
      statusText = "Task added"
    }
  }

  fun toggleFocusItem(item: FocusItem, date: String? = null) {
    val targetCompleted = !item.checkedFor(date ?: "")
    launchWork(if (targetCompleted) "Checking task" else "Undoing task") {
      repository.toggleDailyItemOptimistically(item, targetCompleted, date)
      val sent = repository.sendToggleDailyItem(item, targetCompleted, date)
      if (sent) {
        repository.refreshDailyPlan()
        repository.refresh()
      }
      updateWidgets()
      statusText = if (targetCompleted) "Marked done" else "Restored"
    }
  }

  fun toggleFocusItem(item: FocusItem, dateKey: String, completed: Boolean) {
    launchWork(if (completed) "Checking day" else "Undoing day") {
      repository.toggleDailyItemOptimistically(item, completed, dateKey)
      val sent = repository.sendToggleDailyItem(item, completed, dateKey)
      if (sent) {
        repository.refreshDailyPlan()
        repository.refresh()
      }
      updateWidgets()
      statusText = if (completed) "Day marked done" else "Day restored"
    }
  }

  fun toggleStar(item: FocusItem) {
    val targetStarred = !item.starred
    launchWork(if (targetStarred) "Starring task" else "Unstarring task") {
      repository.toggleStarOptimistically(item.id, targetStarred)
      val sent = repository.sendToggleStar(item.id, targetStarred)
      if (sent) {
        repository.refreshDailyPlan()
        repository.refresh()
      }
      updateWidgets()
      statusText = if (targetStarred) "Starred" else "Unstarred"
    }
  }

  fun deleteTask(item: FocusItem) {
    launchWork("Deleting task") {
      repository.deleteItemAndRefreshToday(item.id)
      repository.refresh()
      updateWidgets()
      statusText = "Task deleted"
    }
  }

  fun addShoppingItem(name: String, category: String?, quantity: String?) {
    val cleanName = name.trim()
    if (cleanName.isBlank()) return
    launchWork("Adding shopping item") {
      repository.createShoppingItem(cleanName, category, quantity)
      updateWidgets()
      statusText = "Shopping item added"
    }
  }

  fun toggleShoppingItem(item: ShoppingItem) {
    val targetChecked = !item.checked
    launchWork(if (targetChecked) "Checking shopping item" else "Restoring shopping item") {
      repository.toggleShoppingItemOptimistically(item.id, targetChecked)
      updateWidgets()
      val sent = repository.sendShoppingToggle(item.id, targetChecked)
      if (sent) repository.refreshShopping()
      updateWidgets()
      statusText = if (targetChecked) "Marked bought" else "Shopping item restored"
    }
  }

  fun editShoppingItem(itemId: String, patch: ShoppingItemPatch) {
    launchWork("Saving shopping item") {
      repository.patchShoppingItem(itemId, patch)
      updateWidgets()
      statusText = "Shopping item saved"
    }
  }

  fun setShoppingStaple(name: String, normalizedName: String, category: String, staple: Boolean) {
    launchWork(if (staple) "Setting staple" else "Unsetting staple") {
      repository.setShoppingStaple(name, normalizedName, category, staple)
      updateWidgets()
      statusText = if (staple) "Shopping staple set" else "Shopping staple removed"
    }
  }

  fun addVocabularyEntry(term: String, languageCode: String?, category: String?, context: String?) {
    val cleanTerm = term.trim()
    if (cleanTerm.isBlank()) return
    launchWork("Adding vocabulary") {
      repository.createVocabularyEntry(cleanTerm, languageCode, category, context)
      updateWidgets()
      statusText = "Vocabulary entry added"
    }
  }

  fun editVocabularyEntry(entryId: String, patch: VocabularyEntryPatch) {
    launchWork("Saving vocabulary") {
      repository.patchVocabularyEntry(entryId, patch)
      updateWidgets()
      statusText = "Vocabulary entry saved"
    }
  }

  fun refreshShopping() {
    launchWork("Refreshing shopping") {
      repository.refreshShopping()
      updateWidgets()
      statusText = "Shopping refreshed"
    }
  }

  fun refreshVocabulary() {
    launchWork("Refreshing vocabulary") {
      repository.refreshVocabulary()
      updateWidgets()
      statusText = "Vocabulary refreshed"
    }
  }

  fun refreshMessages() {
    launchWork("Refreshing chat") {
      repository.refreshMessages()
      statusText = "Chat refreshed"
    }
  }

  fun sendChat(text: String) {
    val cleanText = text.trim()
    if (cleanText.isBlank()) return
    launchWork("Sending") {
      repository.sendChatMessage(cleanText)
      repository.refreshDailyPlan()
      repository.refresh()
      repository.refreshShopping()
      repository.refreshVocabulary()
      updateWidgets()
      statusText = "Message sent"
    }
  }

  fun saveSettings(settings: RyanOsSettings) {
    launchWork("Saving settings") {
      repository.saveSettings(settings)
      repository.refreshDailyPlan()
      repository.refresh()
      repository.refreshShopping()
      repository.refreshVocabulary()
      repository.refreshMessages()
      updateWidgets()
      statusText = "Settings saved"
    }
  }

  fun signIn(apiBaseUrl: String, email: String, password: String) {
    if (apiBaseUrl.isBlank() || email.isBlank() || password.isBlank()) return
    launchWork("Signing in") {
      repository.signIn(apiBaseUrl, email, password)
      repository.refreshDailyPlan()
      repository.refresh()
      repository.refreshShopping()
      repository.refreshVocabulary()
      repository.refreshMessages()
      updateWidgets()
      statusText = "Signed in"
    }
  }

  fun signOut() {
    launchWork("Signing out") {
      repository.signOut()
      statusText = "Signed out"
    }
  }

  fun checkAndroidUpdate() {
    launchWork("Checking app update") {
      val latest = repository.checkAndroidUpdate()
      androidUpdateStatus = AndroidUpdateStatus(
        currentVersionCode = BuildConfig.VERSION_CODE,
        currentVersionName = BuildConfig.VERSION_NAME,
        latest = latest,
        checkedAt = java.time.Instant.now().toString()
      )
      statusText = if (latest.versionCode > BuildConfig.VERSION_CODE) {
        "Android update ${latest.versionName} is available"
      } else {
        "Android app is up to date"
      }
    }
  }

  fun refreshWidgetCaches() {
    launchWork("Refreshing widgets") {
      repository.refresh()
      repository.refreshShopping()
      repository.refreshVocabulary()
      updateWidgets()
      statusText = "Widget caches refreshed"
    }
  }

  fun requestPinWidget(kind: RyanOsWidgetKind) {
    statusText = repository.requestPinWidget(kind)
  }

  private fun launchWork(label: String, block: suspend () -> Unit) {
    viewModelScope.launch {
      busyLabel = label
      runCatching { block() }
        .onFailure { error ->
          statusText = error.message?.take(240)?.ifBlank { null } ?: "Action failed"
        }
      busyLabel = null
    }
  }

  private fun updateWidgets() {
    RyanOsWidgetRenderer.updateAll(appContext)
    RyanOsShoppingWidgetRenderer.updateAll(appContext)
    RyanOsVocabularyWidgetRenderer.updateAll(appContext)
  }
}
