package com.ryanos.android.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

class RyanOsWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = RyanOsTodoWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    WidgetSyncScheduler.schedulePeriodic(context)
    WidgetSyncScheduler.enqueueNow(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    WidgetSyncScheduler.cancelPeriodic(context)
  }
}
