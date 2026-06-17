package com.ryanos.android.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionCallback
import androidx.glance.action.ActionParameters
import com.ryanos.android.data.RyanOsRepository

object WidgetActionKeys {
  val ItemId = ActionParameters.Key<String>("item_id")
  val Completed = ActionParameters.Key<String>("completed")
  val Date = ActionParameters.Key<String>("date")
  val AllowEarly = ActionParameters.Key<String>("allow_early")
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
    RyanOsRepository.getInstance(context).toggleItem(
      itemId = itemId,
      completed = completed,
      date = date,
      allowEarly = allowEarly
    )
    RyanOsTodoWidget().update(context, glanceId)
  }
}
