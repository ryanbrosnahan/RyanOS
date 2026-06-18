package com.ryanos.android.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.ryanos.android.MainActivity
import com.ryanos.android.R
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.data.WidgetItem
import com.ryanos.android.data.WidgetRecurrenceDay
import com.ryanos.android.data.WidgetScopeLabel
import com.ryanos.android.data.WidgetSnapshot
import com.ryanos.android.util.WidgetTiming
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

object RyanOsWidgetRenderer {
  fun updateAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(ComponentName(context, RyanOsWidgetReceiver::class.java))
    update(context, manager, ids)
  }

  fun update(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val start = WidgetTiming.now()
    appWidgetIds.forEach { appWidgetId ->
      val views = RemoteViews(context.packageName, R.layout.widget_remote)
      views.setImageViewResource(R.id.widget_logo, R.drawable.ic_launcher)
      views.setOnClickPendingIntent(
        R.id.widget_refresh,
        PendingIntent.getBroadcast(
          context,
          appWidgetId,
          Intent(context, RyanOsWidgetReceiver::class.java)
            .setAction(RyanOsWidgetActions.ACTION_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId),
          pendingIntentFlags(mutable = false)
        )
      )
      views.setOnClickPendingIntent(
        R.id.widget_add,
        PendingIntent.getActivity(
          context,
          10_000 + appWidgetId,
          Intent(context, MainActivity::class.java),
          pendingIntentFlags(mutable = false)
        )
      )
      views.setRemoteAdapter(
        R.id.widget_list,
        Intent(context, RyanOsWidgetListService::class.java).apply {
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
          data = Uri.parse("ryanos://widget/list/$appWidgetId")
        }
      )
      views.setPendingIntentTemplate(
        R.id.widget_list,
        PendingIntent.getBroadcast(
          context,
          20_000 + appWidgetId,
          Intent(context, RyanOsWidgetReceiver::class.java)
            .setAction(RyanOsWidgetActions.ACTION_ROW)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId),
          pendingIntentFlags(mutable = true)
        )
      )
      views.setEmptyView(R.id.widget_list, R.id.widget_empty)
      manager.updateAppWidget(appWidgetId, views)
      manager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list)
    }
    WidgetTiming.mark(
      operation = "native-renderer",
      stage = "update",
      startedAt = start,
      details = "widgets=${appWidgetIds.size}"
    )
  }

  internal fun pendingIntentFlags(mutable: Boolean): Int {
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      flags = flags or if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
    }
    return flags
  }
}

class RyanOsWidgetListService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    RyanOsWidgetRemoteViewsFactory(applicationContext)
}

private class RyanOsWidgetRemoteViewsFactory(
  private val context: Context
) : RemoteViewsService.RemoteViewsFactory {
  private var snapshot = WidgetSnapshot()
  private var rows: List<WidgetItem> = emptyList()

  override fun onCreate() = Unit

  override fun onDataSetChanged() {
    val start = WidgetTiming.now()
    snapshot = runBlocking {
      RyanOsRepository.getInstance(context).snapshotFlow.first()
    }
    rows = sortRows(snapshot.items)
    WidgetTiming.mark(
      operation = "native-list-factory",
      stage = "onDataSetChanged",
      startedAt = start,
      details = "items=${rows.size} expanded=${snapshot.expandedRecurrenceItemIds.size}"
    )
  }

  override fun onDestroy() {
    rows = emptyList()
  }

  override fun getCount(): Int = rows.size

  override fun getViewAt(position: Int): RemoteViews {
    val item = rows.getOrNull(position)
      ?: return RemoteViews(context.packageName, R.layout.widget_task_row)
    val showDetails = snapshot.showTaskDetails
    val colorCodeByArea = snapshot.colorCodeByArea && showDetails
    val expanded = snapshot.expandedRecurrenceItemIds.contains(item.id)
    return RemoteViews(context.packageName, R.layout.widget_task_row).apply {
      bindRow(item, showDetails, colorCodeByArea, expanded)
    }
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount(): Int = 1

  override fun getItemId(position: Int): Long =
    rows.getOrNull(position)?.let { stableItemId(it, snapshot.expandedRecurrenceItemIds.contains(it.id)) }
      ?: position.toLong()

  override fun hasStableIds(): Boolean = true

  private fun RemoteViews.bindRow(
    item: WidgetItem,
    showDetails: Boolean,
    colorCodeByArea: Boolean,
    expanded: Boolean
  ) {
    setInt(
      R.id.widget_row_root,
      "setBackgroundColor",
      if (item.checked) COLOR_ROW_CHECKED else COLOR_BACKGROUND
    )
    setImageViewResource(
      R.id.widget_item_toggle,
      if (item.checked) R.drawable.ic_widget_undo else R.drawable.ic_widget_check_circle
    )
    setInt(
      R.id.widget_item_toggle,
      "setColorFilter",
      if (item.checked) COLOR_TEXT_SECONDARY else COLOR_CHECK
    )
    setContentDescription(
      R.id.widget_item_toggle,
      if (item.checked) "Undo ${item.title}" else "Complete ${item.title}"
    )
    setOnClickFillInIntent(
      R.id.widget_item_toggle,
      Intent()
        .putExtra(RyanOsWidgetActions.EXTRA_WIDGET_ACTION, RyanOsWidgetActions.ACTION_TOGGLE_ITEM)
        .putExtra(RyanOsWidgetActions.EXTRA_ITEM_ID, item.id)
        .putExtra(RyanOsWidgetActions.EXTRA_COMPLETED, (!item.checked))
        .putExtra(RyanOsWidgetActions.EXTRA_DATE, item.action.date.orEmpty())
        .putExtra(RyanOsWidgetActions.EXTRA_ALLOW_EARLY, item.action.allowEarly)
    )

    setTextViewText(
      R.id.widget_item_title,
      if (item.checked) strikethrough(item.title) else item.title
    )
    setTextColor(R.id.widget_item_title, if (item.checked) COLOR_TEXT_SECONDARY else COLOR_TEXT_PRIMARY)
    setBoolean(R.id.widget_item_title, "setSingleLine", true)

    if (colorCodeByArea) {
      setViewVisibility(R.id.widget_area_accent, View.VISIBLE)
      setInt(R.id.widget_area_accent, "setBackgroundColor", areaAccentColor(item.scope?.area?.color))
    } else {
      setViewVisibility(R.id.widget_area_accent, View.GONE)
    }

    bindScope(item, showDetails)
    bindDetail(item, showDetails)
    bindDays(item, showDetails, colorCodeByArea, expanded)
  }

  private fun RemoteViews.bindScope(item: WidgetItem, showDetails: Boolean) {
    val area = item.scope?.area
    val project = item.scope?.project
    val hasScope = showDetails && (area != null || project != null)
    setViewVisibility(R.id.widget_scope_row, if (hasScope) View.VISIBLE else View.GONE)
    if (area != null && showDetails) {
      setViewVisibility(R.id.widget_area_label, View.VISIBLE)
      setTextViewText(R.id.widget_area_label, area.name)
      setInt(R.id.widget_area_label, "setBackgroundColor", areaChipColor(area.color))
    } else {
      setViewVisibility(R.id.widget_area_label, View.GONE)
    }
    if (project != null && showDetails) {
      setViewVisibility(R.id.widget_project_label, View.VISIBLE)
      setTextViewText(R.id.widget_project_label, project.name)
      setInt(R.id.widget_project_label, "setBackgroundColor", COLOR_PROJECT_CHIP)
    } else {
      setViewVisibility(R.id.widget_project_label, View.GONE)
    }
  }

  private fun RemoteViews.bindDetail(item: WidgetItem, showDetails: Boolean) {
    val recurrenceSummary = item.recurrence?.summary?.takeIf { it.isNotBlank() }
    val detail = when {
      recurrenceSummary != null && item.secondaryText != null -> "${item.secondaryText} / $recurrenceSummary"
      recurrenceSummary != null -> recurrenceSummary
      item.secondaryText != null -> item.secondaryText
      item.dueAt != null -> item.dueAt
      else -> null
    }
    if (showDetails && detail != null) {
      setViewVisibility(R.id.widget_item_detail, View.VISIBLE)
      setTextViewText(R.id.widget_item_detail, detail)
    } else {
      setViewVisibility(R.id.widget_item_detail, View.GONE)
    }
  }

  private fun RemoteViews.bindDays(
    item: WidgetItem,
    showDetails: Boolean,
    colorCodeByArea: Boolean,
    expanded: Boolean
  ) {
    val recurrence = item.recurrence
    if (recurrence == null || !showDetails) {
      setViewVisibility(R.id.widget_days_toggle, View.GONE)
      setViewVisibility(R.id.widget_days_container, View.GONE)
      return
    }

    setViewVisibility(R.id.widget_days_toggle, View.VISIBLE)
    setTextViewText(R.id.widget_days_toggle, if (expanded) "Hide" else "Days")
    setTextColor(R.id.widget_days_toggle, if (expanded) COLOR_BUTTON_SELECTED_TEXT else COLOR_TEXT_SECONDARY)
    setInt(
      R.id.widget_days_toggle,
      "setBackgroundResource",
      if (expanded) R.drawable.widget_button_selected_background else R.drawable.widget_button_background
    )
    setOnClickFillInIntent(
      R.id.widget_days_toggle,
      Intent()
        .putExtra(RyanOsWidgetActions.EXTRA_WIDGET_ACTION, RyanOsWidgetActions.ACTION_TOGGLE_DAYS)
        .putExtra(RyanOsWidgetActions.EXTRA_ITEM_ID, item.id)
    )

    setViewVisibility(R.id.widget_days_container, if (expanded) View.VISIBLE else View.GONE)
    if (!expanded) return

    setViewPadding(
      R.id.widget_days_container,
      context.dp(if (colorCodeByArea) 46 else 36),
      0,
      0,
      0
    )
    val days = lastSevenDays(item)
    DAY_VIEW_IDS.forEachIndexed { index, viewId ->
      val day = days.getOrNull(index)
      if (day == null) {
        setViewVisibility(viewId, View.GONE)
      } else {
        setViewVisibility(viewId, View.VISIBLE)
        setTextViewText(viewId, if (day.status == "completed") "✓" else recurrenceDayLabel(day))
        setTextColor(viewId, if (day.status == "completed") Color.WHITE else COLOR_TEXT_PRIMARY)
        setInt(viewId, "setBackgroundResource", recurrenceDayBackground(day))
        setOnClickFillInIntent(
          viewId,
          Intent()
            .putExtra(RyanOsWidgetActions.EXTRA_WIDGET_ACTION, RyanOsWidgetActions.ACTION_TOGGLE_ITEM)
            .putExtra(RyanOsWidgetActions.EXTRA_ITEM_ID, item.id)
            .putExtra(RyanOsWidgetActions.EXTRA_COMPLETED, day.status != "completed")
            .putExtra(RyanOsWidgetActions.EXTRA_DATE, day.date)
            .putExtra(RyanOsWidgetActions.EXTRA_ALLOW_EARLY, day.allowEarly)
            .putExtra(RyanOsWidgetActions.EXTRA_KEEP_EXPANDED, true)
        )
      }
    }
    if (recurrence.lastDoneLabel.isNullOrBlank()) {
      setViewVisibility(R.id.widget_last_done, View.GONE)
    } else {
      setViewVisibility(R.id.widget_last_done, View.VISIBLE)
      setTextViewText(R.id.widget_last_done, recurrence.lastDoneLabel)
    }
  }

  companion object {
    private val DAY_VIEW_IDS = intArrayOf(
      R.id.widget_day_0,
      R.id.widget_day_1,
      R.id.widget_day_2,
      R.id.widget_day_3,
      R.id.widget_day_4,
      R.id.widget_day_5,
      R.id.widget_day_6
    )

    private const val COLOR_BACKGROUND = 0xFFFBFCF8.toInt()
    private const val COLOR_ROW_CHECKED = 0xFFF1F4F0.toInt()
    private const val COLOR_TEXT_PRIMARY = 0xFF17201C.toInt()
    private const val COLOR_TEXT_SECONDARY = 0xFF5B6962.toInt()
    private const val COLOR_CHECK = 0xFF047857.toInt()
    private const val COLOR_BUTTON_SELECTED_TEXT = 0xFF0F766E.toInt()
    private const val COLOR_PROJECT_CHIP = Color.WHITE

    private fun sortRows(items: List<WidgetItem>): List<WidgetItem> =
      items.filterNot { it.checked }.sortedByDescending { it.priorityScore } +
        items.filter { it.checked }.sortedByDescending { it.priorityScore }

    private fun stableItemId(item: WidgetItem, expanded: Boolean): Long {
      val seed = buildString {
        append(item.id)
        append(':')
        append(item.status)
        append(':')
        append(item.checked)
        append(':')
        append(expanded)
        item.recurrence?.let { recurrence ->
          append(':')
          append(recurrence.summary)
          recurrence.days.forEach { day ->
            append('|')
            append(day.date)
            append('=')
            append(day.status)
          }
        }
      }
      val hash = seed.fold(1125899906842597L) { acc, char -> 31L * acc + char.code }
      val positiveHash = hash and Long.MAX_VALUE
      return if (positiveHash == 0L) 1L else positiveHash
    }

    private fun strikethrough(text: String): SpannableString =
      SpannableString(text).apply {
        setSpan(StrikethroughSpan(), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }

    private fun lastSevenDays(item: WidgetItem): List<WidgetRecurrenceDay> {
      val today = item.action.date ?: item.recurrence?.days?.firstOrNull { it.isToday }?.date
      return item.recurrence?.days.orEmpty()
        .filter { today == null || it.date <= today }
        .sortedBy { it.date }
        .takeLast(7)
    }

    private fun recurrenceDayLabel(day: WidgetRecurrenceDay): String =
      when (day.weekday) {
        "Sunday", "Sun" -> "S"
        "Monday", "Mon" -> "M"
        "Tuesday", "Tue" -> "T"
        "Wednesday", "Wed" -> "W"
        "Thursday", "Thu" -> "T"
        "Friday", "Fri" -> "F"
        "Saturday", "Sat" -> "S"
        else -> day.weekday.take(1).ifBlank { day.date.takeLast(1) }
      }

    private fun recurrenceDayBackground(day: WidgetRecurrenceDay): Int =
      when {
        day.status == "completed" -> R.drawable.widget_day_completed
        day.isIntended -> R.drawable.widget_day_intended
        day.isToday -> R.drawable.widget_day_today
        day.status == "missed" -> R.drawable.widget_day_missed
        day.status == "skipped" || day.status == "deferred" -> R.drawable.widget_day_skipped
        else -> R.drawable.widget_day_neutral
      }

    private fun areaAccentColor(color: String?): Int =
      when (color) {
        "emerald", "cyan" -> 0xFF0891B2.toInt()
        "rose", "violet" -> 0xFF7C3AED.toInt()
        "lime", "sky" -> 0xFF0284C7.toInt()
        "amber" -> 0xFFD97706.toInt()
        "indigo" -> 0xFF4F46E5.toInt()
        "fuchsia" -> 0xFFC026D3.toInt()
        "blue" -> 0xFF2563EB.toInt()
        else -> 0xFF78716C.toInt()
      }

    private fun areaChipColor(color: String?): Int =
      when (color) {
        "emerald", "cyan" -> 0xFFE0F7FA.toInt()
        "rose", "violet" -> 0xFFF3E8FF.toInt()
        "lime", "sky" -> 0xFFE0F2FE.toInt()
        "amber" -> 0xFFFEF3C7.toInt()
        "indigo" -> 0xFFE0E7FF.toInt()
        "fuchsia" -> 0xFFFAE8FF.toInt()
        "blue" -> 0xFFDBEAFE.toInt()
        else -> 0xFFF5F5F4.toInt()
      }

    private fun Context.dp(value: Int): Int =
      TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics
      ).toInt()
  }
}
