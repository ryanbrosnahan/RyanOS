package com.ryanos.android.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import com.ryanos.android.data.RyanOsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class RyanOsVocabularyWidgetReceiver : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    RyanOsVocabularyWidgetRenderer.update(context, appWidgetManager, appWidgetIds)
    VocabularyWidgetSyncScheduler.enqueueNow(context)
  }

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    VocabularyWidgetSyncScheduler.schedulePeriodic(context)
    VocabularyWidgetSyncScheduler.enqueueNow(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    VocabularyWidgetSyncScheduler.cancelPeriodic(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      RyanOsWidgetActions.ACTION_VOCABULARY_REFRESH -> {
        goAsync {
          RyanOsRepository.getInstance(context).refreshVocabulary()
          RyanOsVocabularyWidgetRenderer.updateAll(context)
        }
      }
      else -> super.onReceive(context, intent)
    }
  }

  private fun goAsync(block: suspend () -> Unit) {
    val pendingResult = goAsync()
    receiverScope.launch {
      try {
        block()
      } finally {
        pendingResult.finish()
      }
    }
  }

  companion object {
    private val receiverScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  }
}
