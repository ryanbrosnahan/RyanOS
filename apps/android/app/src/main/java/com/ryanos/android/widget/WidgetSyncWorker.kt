package com.ryanos.android.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.ryanos.android.data.RyanOsRepository
import java.util.concurrent.TimeUnit

class WidgetSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): Result =
    runCatching {
      RyanOsRepository.getInstance(applicationContext).refresh()
      RyanOsTodoWidget().updateAll(applicationContext)
      Result.success()
    }.getOrElse {
      Result.retry()
    }
}

object WidgetSyncScheduler {
  private const val ONE_TIME_WORK = "ryanos_widget_sync_now"
  private const val PERIODIC_WORK = "ryanos_widget_sync_periodic"

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
}
