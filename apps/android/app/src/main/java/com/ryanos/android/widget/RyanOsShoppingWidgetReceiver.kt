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

class RyanOsShoppingWidgetReceiver : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    RyanOsShoppingWidgetRenderer.update(context, appWidgetManager, appWidgetIds)
    ShoppingWidgetSyncScheduler.enqueueNow(context)
  }

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    ShoppingWidgetSyncScheduler.schedulePeriodic(context)
    ShoppingWidgetSyncScheduler.enqueueNow(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    ShoppingWidgetSyncScheduler.cancelPeriodic(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    val widgetAction = intent.getStringExtra(RyanOsWidgetActions.EXTRA_WIDGET_ACTION)
    when (intent.action) {
      RyanOsWidgetActions.ACTION_SHOPPING_REFRESH -> {
        goAsync {
          RyanOsRepository.getInstance(context).refreshShopping()
          RyanOsShoppingWidgetRenderer.updateAll(context)
        }
      }

      RyanOsWidgetActions.ACTION_SHOPPING_ROW -> {
        when (widgetAction) {
          RyanOsWidgetActions.ACTION_TOGGLE_SHOPPING_ITEM -> handleToggleShoppingItem(context, intent)
          else -> super.onReceive(context, intent)
        }
      }

      else -> super.onReceive(context, intent)
    }
  }

  private fun handleToggleShoppingItem(context: Context, intent: Intent) {
    val itemId = intent.getStringExtra(RyanOsWidgetActions.EXTRA_ITEM_ID) ?: return
    val checked = intent.getBooleanExtra(RyanOsWidgetActions.EXTRA_COMPLETED, false)
    goAsync {
      RyanOsRepository.getInstance(context).toggleShoppingItemOptimistically(
        itemId = itemId,
        checked = checked
      )
      RyanOsShoppingWidgetRenderer.updateAll(context)
      ShoppingWidgetSyncScheduler.enqueueToggle(
        context = context,
        itemId = itemId,
        checked = checked
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
