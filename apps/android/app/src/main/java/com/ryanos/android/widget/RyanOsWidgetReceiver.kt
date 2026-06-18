package com.ryanos.android.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.util.WidgetTiming
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class RyanOsWidgetReceiver : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    RyanOsWidgetRenderer.update(context, appWidgetManager, appWidgetIds)
    WidgetSyncScheduler.enqueueNow(context)
  }

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    WidgetSyncScheduler.schedulePeriodic(context)
    WidgetSyncScheduler.enqueueNow(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    WidgetSyncScheduler.cancelPeriodic(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    val widgetAction = intent.getStringExtra(RyanOsWidgetActions.EXTRA_WIDGET_ACTION)
    when (intent.action) {
      RyanOsWidgetActions.ACTION_REFRESH -> {
        goAsync {
          val start = WidgetTiming.now()
          WidgetTiming.event("native-refresh-action", "start")
          val snapshot = RyanOsRepository.getInstance(context).refresh()
          WidgetTiming.mark(
            operation = "native-refresh-action",
            stage = "repository.refresh",
            startedAt = start,
            details = "items=${snapshot.items.size} error=${snapshot.error != null}"
          )
          RyanOsWidgetRenderer.updateAll(context)
          WidgetTiming.mark("native-refresh-action", "renderer.updateAll", start)
        }
      }

      RyanOsWidgetActions.ACTION_ROW -> {
        when (widgetAction) {
          RyanOsWidgetActions.ACTION_TOGGLE_DAYS -> handleToggleDays(context, intent)
          RyanOsWidgetActions.ACTION_TOGGLE_ITEM -> handleToggleItem(context, intent)
          else -> super.onReceive(context, intent)
        }
      }

      else -> super.onReceive(context, intent)
    }
  }

  private fun handleToggleDays(context: Context, intent: Intent) {
    val itemId = intent.getStringExtra(RyanOsWidgetActions.EXTRA_ITEM_ID) ?: return
    goAsync {
      val start = WidgetTiming.now()
      WidgetTiming.event(
        operation = "native-toggle-days-action",
        event = "start",
        details = "item=${WidgetTiming.shortId(itemId)}"
      )
      val snapshot = RyanOsRepository.getInstance(context).toggleRecurrenceExpanded(itemId)
      WidgetTiming.mark(
        operation = "native-toggle-days-action",
        stage = "repository.toggleRecurrenceExpanded",
        startedAt = start,
        details = "items=${snapshot.items.size} expanded=${snapshot.expandedRecurrenceItemIds.size}"
      )
      RyanOsWidgetRenderer.updateAll(context)
      WidgetTiming.mark(
        operation = "native-toggle-days-action",
        stage = "renderer.updateAll",
        startedAt = start,
        details = "total=${WidgetTiming.elapsed(start)}ms"
      )
    }
  }

  private fun handleToggleItem(context: Context, intent: Intent) {
    val itemId = intent.getStringExtra(RyanOsWidgetActions.EXTRA_ITEM_ID) ?: return
    val completed = intent.getBooleanExtra(RyanOsWidgetActions.EXTRA_COMPLETED, false)
    val date = intent.getStringExtra(RyanOsWidgetActions.EXTRA_DATE)?.takeIf { it.isNotBlank() }
    val allowEarly = intent.getBooleanExtra(RyanOsWidgetActions.EXTRA_ALLOW_EARLY, false)
    val keepExpanded = intent.getBooleanExtra(RyanOsWidgetActions.EXTRA_KEEP_EXPANDED, false)
    val toggleExisting = intent.getBooleanExtra(RyanOsWidgetActions.EXTRA_TOGGLE_EXISTING, false)

    goAsync {
      val start = WidgetTiming.now()
      WidgetTiming.event(
        operation = "native-toggle-item-action",
        event = "start",
        details = "item=${WidgetTiming.shortId(itemId)} completed=$completed date=${date ?: "default"} allowEarly=$allowEarly keepExpanded=$keepExpanded toggleExisting=$toggleExisting"
      )
      val snapshot = RyanOsRepository.getInstance(context).toggleItemOptimistically(
        itemId = itemId,
        completed = completed,
        date = date,
        allowEarly = allowEarly,
        toggleExisting = toggleExisting,
        keepExpanded = keepExpanded
      )
      WidgetTiming.mark(
        operation = "native-toggle-item-action",
        stage = "repository.toggleItemOptimistically",
        startedAt = start,
        details = "items=${snapshot.items.size} error=${snapshot.error != null}"
      )
      RyanOsWidgetRenderer.updateAll(context)
      WidgetTiming.mark(
        operation = "native-toggle-item-action",
        stage = "renderer.updateAll",
        startedAt = start,
        details = "total=${WidgetTiming.elapsed(start)}ms"
      )
      WidgetSyncScheduler.enqueueToggle(
        context = context,
        itemId = itemId,
        completed = completed,
        date = date,
        allowEarly = allowEarly,
        toggleExisting = toggleExisting
      )
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
