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
import java.util.concurrent.TimeUnit

class ShoppingWidgetSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): Result =
    runCatching {
      RyanOsRepository.getInstance(applicationContext).refreshShopping()
      RyanOsShoppingWidgetRenderer.updateAll(applicationContext)
      Result.success()
    }.getOrElse {
      Result.retry()
    }
}

class ShoppingWidgetToggleSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): ListenableWorker.Result {
    val itemId = inputData.getString(KEY_ITEM_ID) ?: return Result.success()
    val checked = inputData.getBoolean(KEY_CHECKED, false)
    return runCatching {
      val repository = RyanOsRepository.getInstance(applicationContext)
      val sent = repository.sendShoppingToggle(itemId = itemId, checked = checked)
      if (!sent) return Result.retry()

      val currentChecked = repository.cachedShoppingCheckedState(itemId)
      if (currentChecked != checked) return Result.success()

      repository.refreshShopping()
      RyanOsShoppingWidgetRenderer.updateAll(applicationContext)
      Result.success()
    }.getOrElse {
      Result.retry()
    }
  }

  companion object {
    const val KEY_ITEM_ID = "item_id"
    const val KEY_CHECKED = "checked"
  }
}

object ShoppingWidgetSyncScheduler {
  private const val ONE_TIME_WORK = "ryanos_shopping_widget_sync_now"
  private const val PERIODIC_WORK = "ryanos_shopping_widget_sync_periodic"
  private const val TOGGLE_WORK_PREFIX = "ryanos_shopping_widget_toggle_sync"
  private const val TOGGLE_DEBOUNCE_MS = 300L

  fun enqueueNow(context: Context) {
    val request = OneTimeWorkRequestBuilder<ShoppingWidgetSyncWorker>()
      .setConstraints(networkConstraints())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      ONE_TIME_WORK,
      ExistingWorkPolicy.REPLACE,
      request
    )
  }

  fun enqueueToggle(context: Context, itemId: String, checked: Boolean) {
    val request = OneTimeWorkRequestBuilder<ShoppingWidgetToggleSyncWorker>()
      .setConstraints(networkConstraints())
      .setInitialDelay(TOGGLE_DEBOUNCE_MS, TimeUnit.MILLISECONDS)
      .setInputData(
        workDataOf(
          ShoppingWidgetToggleSyncWorker.KEY_ITEM_ID to itemId,
          ShoppingWidgetToggleSyncWorker.KEY_CHECKED to checked
        )
      )
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      "$TOGGLE_WORK_PREFIX:${stableWorkKey(itemId)}",
      ExistingWorkPolicy.REPLACE,
      request
    )
  }

  fun schedulePeriodic(context: Context) {
    val request = PeriodicWorkRequestBuilder<ShoppingWidgetSyncWorker>(30, TimeUnit.MINUTES)
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

  private fun stableWorkKey(seed: String): String {
    val hash = seed.fold(1125899906842597L) { acc, char -> 31L * acc + char.code }
    return (hash and Long.MAX_VALUE).toString(36)
  }
}
