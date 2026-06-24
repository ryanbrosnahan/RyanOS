package com.ryanos.android.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.ryanos.android.MainActivity
import com.ryanos.android.R
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.data.VocabularyEntry
import com.ryanos.android.data.VocabularySnapshot
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

object RyanOsVocabularyWidgetRenderer {
  fun updateAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(ComponentName(context, RyanOsVocabularyWidgetReceiver::class.java))
    update(context, manager, ids)
  }

  fun update(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { appWidgetId ->
      val views = RemoteViews(context.packageName, R.layout.vocabulary_widget_remote)
      views.setImageViewResource(R.id.vocabulary_widget_logo, R.drawable.ic_launcher)
      views.setOnClickPendingIntent(
        R.id.vocabulary_widget_refresh,
        PendingIntent.getBroadcast(
          context,
          70_000 + appWidgetId,
          Intent(context, RyanOsVocabularyWidgetReceiver::class.java)
            .setAction(RyanOsWidgetActions.ACTION_VOCABULARY_REFRESH)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId),
          RyanOsWidgetRenderer.pendingIntentFlags(mutable = false)
        )
      )
      views.setOnClickPendingIntent(
        R.id.vocabulary_widget_add,
        PendingIntent.getActivity(
          context,
          80_000 + appWidgetId,
          Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_INITIAL_SCREEN, MainActivity.SCREEN_VOCABULARY),
          RyanOsWidgetRenderer.pendingIntentFlags(mutable = false)
        )
      )
      views.setRemoteAdapter(
        R.id.vocabulary_widget_list,
        Intent(context, RyanOsVocabularyWidgetListService::class.java).apply {
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
          data = Uri.parse("ryanos://vocabulary-widget/list/$appWidgetId")
        }
      )
      views.setPendingIntentTemplate(
        R.id.vocabulary_widget_list,
        PendingIntent.getActivity(
          context,
          90_000 + appWidgetId,
          Intent(context, MainActivity::class.java),
          RyanOsWidgetRenderer.pendingIntentFlags(mutable = true)
        )
      )
      views.setEmptyView(R.id.vocabulary_widget_list, R.id.vocabulary_widget_empty)
      manager.updateAppWidget(appWidgetId, views)
      manager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.vocabulary_widget_list)
    }
  }
}

class RyanOsVocabularyWidgetListService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    RyanOsVocabularyWidgetRemoteViewsFactory(applicationContext)
}

private class RyanOsVocabularyWidgetRemoteViewsFactory(
  private val context: Context
) : RemoteViewsService.RemoteViewsFactory {
  private var snapshot = VocabularySnapshot()
  private var rows: List<VocabularyEntry> = emptyList()

  override fun onCreate() = Unit

  override fun onDataSetChanged() {
    snapshot = runBlocking {
      RyanOsRepository.getInstance(context).vocabularySnapshotFlow.first()
    }
    rows = snapshot.entries.sortedByDescending { it.updatedAt }
  }

  override fun onDestroy() {
    rows = emptyList()
  }

  override fun getCount(): Int = rows.size

  override fun getViewAt(position: Int): RemoteViews {
    val entry = rows.getOrNull(position)
      ?: return RemoteViews(context.packageName, R.layout.vocabulary_widget_row)
    return RemoteViews(context.packageName, R.layout.vocabulary_widget_row).apply {
      bindRow(entry)
    }
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount(): Int = 1

  override fun getItemId(position: Int): Long =
    rows.getOrNull(position)?.let { stableItemId(it) } ?: position.toLong()

  override fun hasStableIds(): Boolean = true

  private fun RemoteViews.bindRow(entry: VocabularyEntry) {
    setOnClickFillInIntent(
      R.id.vocabulary_row_root,
      Intent().putExtra(MainActivity.EXTRA_INITIAL_SCREEN, MainActivity.SCREEN_VOCABULARY)
    )
    setTextViewText(R.id.vocabulary_item_term, entry.term)
    setTextColor(R.id.vocabulary_item_term, COLOR_TEXT_PRIMARY)
    val label = listOf(entry.languageCode, entry.category).filter { it.isNotBlank() }.joinToString(" / ")
    setTextViewText(R.id.vocabulary_category_label, label)
    setInt(R.id.vocabulary_category_label, "setBackgroundColor", categoryChipColor(entry.category))

    val detail = vocabularyDetail(entry)
    if (detail == null) {
      setViewVisibility(R.id.vocabulary_item_definition, View.GONE)
    } else {
      setViewVisibility(R.id.vocabulary_item_definition, View.VISIBLE)
      setTextViewText(R.id.vocabulary_item_definition, detail)
      setTextColor(R.id.vocabulary_item_definition, COLOR_TEXT_SECONDARY)
    }
  }

  companion object {
    private const val COLOR_TEXT_PRIMARY = 0xFF17201C.toInt()
    private const val COLOR_TEXT_SECONDARY = 0xFF5B6962.toInt()

    private fun stableItemId(entry: VocabularyEntry): Long {
      val seed = "${entry.id}:${entry.updatedAt}"
      val hash = seed.fold(1125899906842597L) { acc, char -> 31L * acc + char.code }
      val positiveHash = hash and Long.MAX_VALUE
      return if (positiveHash == 0L) 1L else positiveHash
    }

    private fun vocabularyDetail(entry: VocabularyEntry): String? =
      listOfNotNull(
        entry.partOfSpeech?.takeIf { it.isNotBlank() },
        entry.definition?.takeIf { it.isNotBlank() },
        entry.translation?.takeIf { it.isNotBlank() }
      ).joinToString(" / ").takeIf { it.isNotBlank() }

    private fun categoryChipColor(category: String): Int =
      when (category) {
        "medical" -> 0xFFDCFCE7.toInt()
        "language" -> 0xFFE0E7FF.toInt()
        "technical" -> 0xFFE0F2FE.toInt()
        "slang" -> 0xFFFCE7F3.toInt()
        "proper_noun" -> 0xFFFEF3C7.toInt()
        else -> Color.WHITE
      }
  }
}
