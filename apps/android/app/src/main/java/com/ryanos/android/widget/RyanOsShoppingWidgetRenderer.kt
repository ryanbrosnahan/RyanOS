package com.ryanos.android.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.ryanos.android.MainActivity
import com.ryanos.android.R
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.data.ShoppingItem
import com.ryanos.android.data.ShoppingSnapshot
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

object RyanOsShoppingWidgetRenderer {
  fun updateAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(ComponentName(context, RyanOsShoppingWidgetReceiver::class.java))
    update(context, manager, ids)
  }

  fun update(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { appWidgetId ->
      val views = RemoteViews(context.packageName, R.layout.shopping_widget_remote)
      views.setImageViewResource(R.id.shopping_widget_logo, R.drawable.ic_launcher)
      views.setOnClickPendingIntent(
        R.id.shopping_widget_refresh,
        PendingIntent.getBroadcast(
          context,
          30_000 + appWidgetId,
          Intent(context, RyanOsShoppingWidgetReceiver::class.java)
            .setAction(RyanOsWidgetActions.ACTION_SHOPPING_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId),
          RyanOsWidgetRenderer.pendingIntentFlags(mutable = false)
        )
      )
      views.setOnClickPendingIntent(
        R.id.shopping_widget_add,
        PendingIntent.getActivity(
          context,
          40_000 + appWidgetId,
          Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_INITIAL_SCREEN, MainActivity.SCREEN_SHOPPING),
          RyanOsWidgetRenderer.pendingIntentFlags(mutable = false)
        )
      )
      views.setRemoteAdapter(
        R.id.shopping_widget_list,
        Intent(context, RyanOsShoppingWidgetListService::class.java).apply {
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
          data = Uri.parse("ryanos://shopping-widget/list/$appWidgetId")
        }
      )
      views.setPendingIntentTemplate(
        R.id.shopping_widget_list,
        PendingIntent.getBroadcast(
          context,
          50_000 + appWidgetId,
          Intent(context, RyanOsShoppingWidgetReceiver::class.java)
            .setAction(RyanOsWidgetActions.ACTION_SHOPPING_ROW)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId),
          RyanOsWidgetRenderer.pendingIntentFlags(mutable = true)
        )
      )
      views.setEmptyView(R.id.shopping_widget_list, R.id.shopping_widget_empty)
      manager.updateAppWidget(appWidgetId, views)
      manager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.shopping_widget_list)
    }
  }
}

class RyanOsShoppingWidgetListService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    RyanOsShoppingWidgetRemoteViewsFactory(applicationContext)
}

private class RyanOsShoppingWidgetRemoteViewsFactory(
  private val context: Context
) : RemoteViewsService.RemoteViewsFactory {
  private var snapshot = ShoppingSnapshot()
  private var rows: List<ShoppingItem> = emptyList()

  override fun onCreate() = Unit

  override fun onDataSetChanged() {
    snapshot = runBlocking {
      RyanOsRepository.getInstance(context).shoppingSnapshotFlow.first()
    }
    rows = sortRows(snapshot.items)
  }

  override fun onDestroy() {
    rows = emptyList()
  }

  override fun getCount(): Int = rows.size

  override fun getViewAt(position: Int): RemoteViews {
    val item = rows.getOrNull(position)
      ?: return RemoteViews(context.packageName, R.layout.shopping_widget_row)
    return RemoteViews(context.packageName, R.layout.shopping_widget_row).apply {
      bindRow(item)
    }
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount(): Int = 1

  override fun getItemId(position: Int): Long =
    rows.getOrNull(position)?.let { stableItemId(it) } ?: position.toLong()

  override fun hasStableIds(): Boolean = true

  private fun RemoteViews.bindRow(item: ShoppingItem) {
    setInt(
      R.id.shopping_row_root,
      "setBackgroundColor",
      if (item.checked) COLOR_ROW_CHECKED else COLOR_BACKGROUND
    )
    setImageViewResource(
      R.id.shopping_item_toggle,
      if (item.checked) R.drawable.ic_widget_undo else R.drawable.ic_widget_check_circle
    )
    setInt(
      R.id.shopping_item_toggle,
      "setColorFilter",
      if (item.checked) COLOR_TEXT_SECONDARY else COLOR_CHECK
    )
    setContentDescription(
      R.id.shopping_item_toggle,
      if (item.checked) "Undo ${item.name}" else "Bought ${item.name}"
    )
    setOnClickFillInIntent(
      R.id.shopping_item_toggle,
      Intent()
        .putExtra(RyanOsWidgetActions.EXTRA_WIDGET_ACTION, RyanOsWidgetActions.ACTION_TOGGLE_SHOPPING_ITEM)
        .putExtra(RyanOsWidgetActions.EXTRA_ITEM_ID, item.id)
        .putExtra(RyanOsWidgetActions.EXTRA_COMPLETED, !item.checked)
    )

    setTextViewText(
      R.id.shopping_item_title,
      if (item.checked) strikethrough(item.name) else item.name
    )
    setTextColor(R.id.shopping_item_title, if (item.checked) COLOR_TEXT_SECONDARY else COLOR_TEXT_PRIMARY)

    setTextViewText(R.id.shopping_category_label, item.category)
    setInt(R.id.shopping_category_label, "setBackgroundColor", categoryChipColor(item.category))

    val detail = shoppingDetail(item)
    if (detail == null) {
      setViewVisibility(R.id.shopping_item_detail, View.GONE)
    } else {
      setViewVisibility(R.id.shopping_item_detail, View.VISIBLE)
      setTextViewText(R.id.shopping_item_detail, detail)
    }
  }

  companion object {
    private const val COLOR_BACKGROUND = 0xFFFBFCF8.toInt()
    private const val COLOR_ROW_CHECKED = 0xFFF1F4F0.toInt()
    private const val COLOR_TEXT_PRIMARY = 0xFF17201C.toInt()
    private const val COLOR_TEXT_SECONDARY = 0xFF5B6962.toInt()
    private const val COLOR_CHECK = 0xFF047857.toInt()

    private fun sortRows(items: List<ShoppingItem>): List<ShoppingItem> =
      items.filterNot { it.checked }
        .sortedWith(compareBy<ShoppingItem> { categoryRank(it.category) }.thenBy { it.sortOrder }.thenBy { it.name.lowercase() }) +
        items.filter { it.checked }.sortedByDescending { it.checkedAt.orEmpty() }

    private fun stableItemId(item: ShoppingItem): Long {
      val seed = "${item.id}:${item.checked}:${item.checkedAt.orEmpty()}"
      val hash = seed.fold(1125899906842597L) { acc, char -> 31L * acc + char.code }
      val positiveHash = hash and Long.MAX_VALUE
      return if (positiveHash == 0L) 1L else positiveHash
    }

    private fun shoppingDetail(item: ShoppingItem): String? =
      listOfNotNull(
        item.quantity?.takeIf { it.isNotBlank() },
        item.note?.takeIf { it.isNotBlank() }
      ).joinToString(" / ").takeIf { it.isNotBlank() }

    private fun strikethrough(text: String): SpannableString =
      SpannableString(text).apply {
        setSpan(StrikethroughSpan(), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }

    private fun categoryRank(category: String): Int =
      when (category) {
        "grocery" -> 0
        "personal care" -> 1
        "household good" -> 2
        "health" -> 3
        else -> 4
      }

    private fun categoryChipColor(category: String): Int =
      when (category) {
        "grocery" -> 0xFFE0F2FE.toInt()
        "personal care" -> 0xFFF3E8FF.toInt()
        "household good" -> 0xFFFEF3C7.toInt()
        "health" -> 0xFFDCFCE7.toInt()
        else -> Color.WHITE
      }
  }
}
