package com.ryanos.android.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.ryanos.android.data.RyanOsRepository

object WidgetActionKeys {
  val ItemId = ActionParameters.Key<String>("item_id")
  val Completed = ActionParameters.Key<String>("completed")
  val Date = ActionParameters.Key<String>("date")
  val AllowEarly = ActionParameters.Key<String>("allow_early")
  val KeepExpanded = ActionParameters.Key<String>("keep_expanded")
  val ToggleExisting = ActionParameters.Key<String>("toggle_existing")
}

class RefreshWidgetAction : ActionCallback {
  override suspend fun onAction(
    context: Context,
    glanceId: GlanceId,
    parameters: ActionParameters
  ) {
    RyanOsRepository.getInstance(context).refresh()
    RyanOsTodoWidget().update(context, glanceId)
  }
}

class ToggleItemAction : ActionCallback {
  override suspend fun onAction(
    context: Context,
    glanceId: GlanceId,
    parameters: ActionParameters
  ) {
    val itemId = parameters[WidgetActionKeys.ItemId] ?: return
    val completed = parameters[WidgetActionKeys.Completed] == "true"
    val date = parameters[WidgetActionKeys.Date]?.takeIf { it.isNotBlank() }
    val allowEarly = parameters[WidgetActionKeys.AllowEarly] == "true"
    val keepExpanded = parameters[WidgetActionKeys.KeepExpanded] == "true"
    val toggleExisting = parameters[WidgetActionKeys.ToggleExisting] == "true"
    val repository = RyanOsRepository.getInstance(context)
    repository.toggleItem(
      itemId = itemId,
      completed = completed,
      date = date,
      allowEarly = allowEarly,
      toggleExisting = toggleExisting
    )
    if (keepExpanded) {
      repository.setRecurrenceExpanded(itemId = itemId, expanded = true)
    }
    RyanOsTodoWidget().update(context, glanceId)
  }
}

class ToggleRecurrenceExpandedAction : ActionCallback {
  override suspend fun onAction(
    context: Context,
    glanceId: GlanceId,
    parameters: ActionParameters
  ) {
    val itemId = parameters[WidgetActionKeys.ItemId] ?: return
    RyanOsRepository.getInstance(context).toggleRecurrenceExpanded(itemId)
    RyanOsTodoWidget().update(context, glanceId)
  }
}
