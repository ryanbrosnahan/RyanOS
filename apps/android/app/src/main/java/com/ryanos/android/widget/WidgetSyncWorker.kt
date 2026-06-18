package com.ryanos.android.widget

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.util.WidgetTiming
import java.util.concurrent.TimeUnit

class WidgetSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): Result =
    runCatching {
      val refreshStart = WidgetTiming.now()
      RyanOsRepository.getInstance(applicationContext).refresh()
      WidgetTiming.mark("widget-sync-worker", "repository.refresh", refreshStart)
      val updateStart = WidgetTiming.now()
      RyanOsWidgetRenderer.updateAll(applicationContext)
      WidgetTiming.mark("widget-sync-worker", "widget.updateAll", updateStart)
      Result.success()
    }.getOrElse {
      WidgetTiming.event(
        operation = "widget-sync-worker",
        event = "error",
        details = it.message.orEmpty()
      )
      Result.retry()
    }
}

class WidgetToggleSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): ListenableWorker.Result {
    val itemId = inputData.getString(KEY_ITEM_ID) ?: return Result.success()
    val completed = inputData.getBoolean(KEY_COMPLETED, false)
    val date = inputData.getString(KEY_DATE)?.takeIf { it.isNotBlank() }
    val allowEarly = inputData.getBoolean(KEY_ALLOW_EARLY, false)
    val toggleExisting = inputData.getBoolean(KEY_TOGGLE_EXISTING, false)
    val workerStart = WidgetTiming.now()
    WidgetTiming.event(
      operation = "widget-toggle-sync-worker",
      event = "start",
      details = "item=${WidgetTiming.shortId(itemId)} completed=$completed date=${date ?: "default"} allowEarly=$allowEarly toggleExisting=$toggleExisting"
    )
    return runCatching {
      val repositoryStart = WidgetTiming.now()
      val repository = RyanOsRepository.getInstance(applicationContext)
      val sent = repository.sendToggleItem(
        itemId = itemId,
        completed = completed,
        date = date,
        allowEarly = allowEarly,
        toggleExisting = toggleExisting
      )
      WidgetTiming.mark(
        operation = "widget-toggle-sync-worker",
        stage = "repository.sendToggleItem",
        startedAt = repositoryStart,
        details = "sent=$sent"
      )
      if (!sent) return Result.retry()

      val cachedStateStart = WidgetTiming.now()
      val currentCompleted = repository.cachedCompletionState(itemId = itemId, date = date)
      WidgetTiming.mark(
        operation = "widget-toggle-sync-worker",
        stage = "repository.cachedCompletionState",
        startedAt = cachedStateStart,
        details = "current=$currentCompleted expected=$completed"
      )
      if (currentCompleted != completed) {
        WidgetTiming.event(
          operation = "widget-toggle-sync-worker",
          event = "skip-stale-refresh",
          details = "item=${WidgetTiming.shortId(itemId)} current=$currentCompleted expected=$completed"
        )
        return Result.success()
      }

      val refreshStart = WidgetTiming.now()
      val snapshot = repository.refresh()
      WidgetTiming.mark(
        operation = "widget-toggle-sync-worker",
        stage = "repository.refresh",
        startedAt = refreshStart,
        details = "items=${snapshot.items.size} error=${snapshot.error != null}"
      )
      val updateStart = WidgetTiming.now()
      RyanOsWidgetRenderer.updateAll(applicationContext)
      WidgetTiming.mark(
        operation = "widget-toggle-sync-worker",
        stage = "widget.updateAll",
        startedAt = updateStart,
        details = "total=${WidgetTiming.elapsed(workerStart)}ms"
      )
      Result.success()
    }.getOrElse {
      WidgetTiming.event(
        operation = "widget-toggle-sync-worker",
        event = "error",
        details = it.message.orEmpty()
      )
      Result.retry()
    }
  }

  companion object {
    const val KEY_ITEM_ID = "item_id"
    const val KEY_COMPLETED = "completed"
    const val KEY_DATE = "date"
    const val KEY_ALLOW_EARLY = "allow_early"
    const val KEY_TOGGLE_EXISTING = "toggle_existing"
  }
}

object WidgetSyncScheduler {
  private const val ONE_TIME_WORK = "ryanos_widget_sync_now"
  private const val PERIODIC_WORK = "ryanos_widget_sync_periodic"
  private const val TOGGLE_WORK_PREFIX = "ryanos_widget_toggle_sync"
  private const val TOGGLE_DEBOUNCE_MS = 300L

  fun enqueueNow(context: Context) {
    val request = OneTimeWorkRequestBuilder<WidgetSyncWorker>()
      .setConstraints(networkConstraints())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      ONE_TIME_WORK,
      ExistingWorkPolicy.REPLACE,
      request
    )
  }

  fun enqueueToggle(
    context: Context,
    itemId: String,
    completed: Boolean,
    date: String?,
    allowEarly: Boolean,
    toggleExisting: Boolean
  ) {
    val request = OneTimeWorkRequestBuilder<WidgetToggleSyncWorker>()
      .setConstraints(networkConstraints())
      .setInitialDelay(TOGGLE_DEBOUNCE_MS, TimeUnit.MILLISECONDS)
      .setInputData(
        workDataOf(
          WidgetToggleSyncWorker.KEY_ITEM_ID to itemId,
          WidgetToggleSyncWorker.KEY_COMPLETED to completed,
          WidgetToggleSyncWorker.KEY_DATE to date.orEmpty(),
          WidgetToggleSyncWorker.KEY_ALLOW_EARLY to allowEarly,
          WidgetToggleSyncWorker.KEY_TOGGLE_EXISTING to toggleExisting
        )
      )
      .build()
    val enqueueStart = WidgetTiming.now()
    WorkManager.getInstance(context).enqueueUniqueWork(
      toggleWorkName(itemId, date),
      ExistingWorkPolicy.REPLACE,
      request
    )
    WidgetTiming.mark(
      operation = "widget-toggle-sync-scheduler",
      stage = "enqueueUniqueWork",
      startedAt = enqueueStart,
      details = "item=${WidgetTiming.shortId(itemId)} completed=$completed date=${date ?: "default"}"
    )
  }

  fun schedulePeriodic(context: Context) {
    val request = PeriodicWorkRequestBuilder<WidgetSyncWorker>(30, TimeUnit.MINUTES)
      .setConstraints(networkConstraints())
      .build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
      PERIODIC_WORK,
      ExistingPeriodicWorkPolicy.REPLACE,
      request
    )
  }

  fun cancelPeriodic(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
  }

  private fun networkConstraints(): Constraints =
    Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()

  private fun toggleWorkName(itemId: String, date: String?): String =
    "$TOGGLE_WORK_PREFIX:${stableWorkKey(itemId)}:${date.orEmpty()}"

  private fun stableWorkKey(seed: String): String {
    val hash = seed.fold(1125899906842597L) { acc, char -> 31L * acc + char.code }
    return (hash and Long.MAX_VALUE).toString(36)
  }
}
