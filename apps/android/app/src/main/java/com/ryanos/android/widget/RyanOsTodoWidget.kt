package com.ryanos.android.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.Button
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextDecoration
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider as GlanceColorProvider
import com.ryanos.android.MainActivity
import com.ryanos.android.R
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.data.WidgetItem
import com.ryanos.android.data.WidgetRecurrenceDay
import com.ryanos.android.data.WidgetScopeLabel
import com.ryanos.android.data.WidgetSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

class RyanOsTodoWidget : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Responsive(
    setOf(
      COMPACT_SIZE,
      WIDE_SIZE,
      TALL_SIZE,
      EXTRA_TALL_SIZE
    )
  )

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snapshot = withContext(Dispatchers.IO) {
      RyanOsRepository.getInstance(context).snapshotFlow.first()
    }
    provideContent {
      WidgetContent(snapshot = snapshot)
    }
  }

  @Composable
  private fun WidgetContent(snapshot: WidgetSnapshot) {
    val size = LocalSize.current
    val compact = size.width < 220.dp
    val showDetails = snapshot.showTaskDetails && !compact && size.height >= 170.dp
    val colorCodeByArea = snapshot.colorCodeByArea && showDetails
    val orderedItems = snapshot.items.sortedWith(
      compareBy<WidgetItem> { it.checked }.thenByDescending { it.priorityScore }
    )

    Column(
      modifier = GlanceModifier
        .fillMaxSize()
        .background(WidgetBackground)
        .padding(12.dp)
    ) {
      Header(compact = compact)
      Spacer(modifier = GlanceModifier.height(8.dp))
      when {
        !snapshot.configured -> SetupState()
        snapshot.items.isEmpty() -> EmptyState(snapshot = snapshot)
        else -> {
          LazyColumn(
            modifier = GlanceModifier
              .defaultWeight()
              .fillMaxWidth()
          ) {
            items(
              items = orderedItems,
              itemId = { item -> stableItemId(item.id) }
            ) { item ->
              Column(modifier = GlanceModifier.fillMaxWidth()) {
                WidgetItemRow(
                  item = item,
                  showDetails = showDetails,
                  colorCodeByArea = colorCodeByArea,
                  expanded = snapshot.expandedRecurrenceItemIds.contains(item.id)
                )
                Spacer(modifier = GlanceModifier.height(6.dp))
              }
            }
          }
          if (!compact && snapshot.error != null) {
            Text(
              text = "Offline changes disabled",
              style = TextStyle(
                color = ErrorText,
                fontSize = 12.sp
              ),
              maxLines = 1
            )
          }
        }
      }
    }
  }

  @Composable
  private fun Header(compact: Boolean) {
    Row(modifier = GlanceModifier.fillMaxWidth()) {
      Image(
        provider = ImageProvider(R.drawable.ic_launcher),
        contentDescription = "RyanOS",
        modifier = GlanceModifier.size(24.dp)
      )
      Spacer(modifier = GlanceModifier.width(8.dp))
      Text(
        text = "RyanOS",
        modifier = GlanceModifier.defaultWeight(),
        style = TextStyle(
          color = TextPrimary,
          fontSize = 16.sp,
          fontWeight = FontWeight.Bold
        ),
        maxLines = 1
      )
      Button(
        text = if (compact) "Sync" else "Refresh",
        onClick = actionRunCallback<RefreshWidgetAction>()
      )
      if (!compact) {
        Spacer(modifier = GlanceModifier.width(6.dp))
        Button(
          text = "Add",
          onClick = actionStartActivity<MainActivity>()
        )
      }
    }
  }

  @Composable
  private fun SetupState() {
    Text(
      text = "Connect RyanOS",
      style = TextStyle(
        color = TextPrimary,
        fontSize = 15.sp,
        fontWeight = FontWeight.Bold
      ),
      maxLines = 1
    )
    Spacer(modifier = GlanceModifier.height(6.dp))
    Button(
      text = "Open app",
      onClick = actionStartActivity<MainActivity>()
    )
  }

  @Composable
  private fun EmptyState(snapshot: WidgetSnapshot) {
    Text(
      text = snapshot.error ?: "No open items",
      style = TextStyle(
        color = if (snapshot.error == null) TextSecondary else ErrorText,
        fontSize = 14.sp
      ),
      maxLines = 2
    )
    Spacer(modifier = GlanceModifier.height(6.dp))
    Button(
      text = "Add",
      onClick = actionStartActivity<MainActivity>()
    )
  }

  @Composable
  private fun WidgetItemRow(
    item: WidgetItem,
    showDetails: Boolean,
    colorCodeByArea: Boolean,
    expanded: Boolean
  ) {
    val completed = !item.checked
    val primaryAction = actionRunCallback<ToggleItemAction>(
      actionParametersOf(
        WidgetActionKeys.ItemId to item.id,
        WidgetActionKeys.Completed to completed.toString(),
        WidgetActionKeys.Date to (item.action.date ?: ""),
        WidgetActionKeys.AllowEarly to item.action.allowEarly.toString()
      )
    )

    Column(
      modifier = GlanceModifier
        .fillMaxWidth()
        .background(rowBackground(item))
        .padding(6.dp)
    ) {
      Row(modifier = GlanceModifier.fillMaxWidth()) {
        if (colorCodeByArea) {
          AreaAccent(item.scope?.area)
          Spacer(modifier = GlanceModifier.width(6.dp))
        }
        Image(
          provider = ImageProvider(if (item.checked) R.drawable.ic_widget_undo else R.drawable.ic_widget_check_circle),
          contentDescription = if (item.checked) "Undo ${item.title}" else "Complete ${item.title}",
          modifier = GlanceModifier
            .size(28.dp)
            .clickable(primaryAction),
          colorFilter = ColorFilter.tint(if (item.checked) TextSecondary else CheckAccent)
        )
        Spacer(modifier = GlanceModifier.width(8.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
          Text(
            text = item.title,
            style = TextStyle(
              color = if (item.checked) TextSecondary else TextPrimary,
              fontSize = 14.sp,
              fontWeight = if (item.checked) FontWeight.Normal else FontWeight.Medium,
              textDecoration = if (item.checked) TextDecoration.LineThrough else null
            ),
            maxLines = if (showDetails) 1 else 2
          )
          if (showDetails) {
            ItemDetails(item = item)
          }
        }
        if (item.recurrence != null && showDetails) {
          Spacer(modifier = GlanceModifier.width(6.dp))
          Text(
            text = if (expanded) "Hide" else "Days",
            modifier = GlanceModifier
              .width(54.dp)
              .height(30.dp)
              .background(if (expanded) ButtonSelectedBackground else ButtonBackground)
              .padding(horizontal = 8.dp, vertical = 6.dp)
              .clickable(
                actionRunCallback<ToggleRecurrenceExpandedAction>(
                  actionParametersOf(WidgetActionKeys.ItemId to item.id)
                )
              ),
            style = TextStyle(
              color = if (expanded) ButtonSelectedText else TextSecondary,
              fontSize = 12.sp,
              fontWeight = FontWeight.Medium
            ),
            maxLines = 1
          )
        }
      }
      if (expanded && item.recurrence != null && showDetails) {
        Spacer(modifier = GlanceModifier.height(6.dp))
        RecurrenceDaysRow(item = item)
      }
    }
  }

  @Composable
  private fun AreaAccent(area: WidgetScopeLabel?) {
    Spacer(
      modifier = GlanceModifier
        .width(4.dp)
        .height(44.dp)
        .background(areaAccentColor(area?.color))
    )
  }

  @Composable
  private fun ItemDetails(item: WidgetItem) {
    val area = item.scope?.area
    val project = item.scope?.project
    Row(modifier = GlanceModifier.fillMaxWidth()) {
      if (area != null) {
        ScopeLabel(area, areaChipColor(area.color))
        Spacer(modifier = GlanceModifier.width(4.dp))
      }
      if (project != null) {
        ScopeLabel(project, ProjectChip)
      }
    }
    val recurrence = item.recurrence
    val detail = when {
      recurrence?.summary?.isNotBlank() == true && item.secondaryText != null ->
        "${item.secondaryText} / ${recurrence.summary}"
      recurrence?.summary?.isNotBlank() == true -> recurrence.summary
      item.secondaryText != null -> item.secondaryText
      else -> null
    }
    if (detail != null) {
      Text(
        text = detail,
        style = TextStyle(
          color = TextSecondary,
          fontSize = 12.sp
        ),
        maxLines = 1
      )
    }
  }

  @Composable
  private fun ScopeLabel(scope: WidgetScopeLabel, background: GlanceColorProvider) {
    Text(
      text = scope.name,
      modifier = GlanceModifier
        .background(background)
        .padding(horizontal = 4.dp, vertical = 2.dp),
      style = TextStyle(
        color = ChipText,
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium
      ),
      maxLines = 1
    )
  }

  @Composable
  private fun RecurrenceDaysRow(item: WidgetItem) {
    Row(modifier = GlanceModifier.fillMaxWidth()) {
      item.recurrence?.days.orEmpty().forEach { day ->
        RecurrenceDayButton(item = item, day = day)
        Spacer(modifier = GlanceModifier.width(3.dp))
      }
    }
    item.recurrence?.lastDoneLabel?.takeIf { it.isNotBlank() }?.let { label ->
      Spacer(modifier = GlanceModifier.height(4.dp))
      Text(
        text = label,
        style = TextStyle(
          color = TextSecondary,
          fontSize = 11.sp
        ),
        maxLines = 1
      )
    }
  }

  @Composable
  private fun RecurrenceDayButton(item: WidgetItem, day: WidgetRecurrenceDay) {
    Text(
      text = if (day.status == "completed") "✓" else recurrenceDayLabel(day),
      modifier = GlanceModifier
        .width(30.dp)
        .height(28.dp)
        .background(recurrenceDayBackground(day))
        .padding(horizontal = 9.dp, vertical = 5.dp)
        .clickable(
          actionRunCallback<ToggleItemAction>(
            actionParametersOf(
              WidgetActionKeys.ItemId to item.id,
              WidgetActionKeys.Completed to (day.status != "completed").toString(),
              WidgetActionKeys.Date to day.date,
              WidgetActionKeys.AllowEarly to day.allowEarly.toString(),
              WidgetActionKeys.KeepExpanded to "true"
            )
          )
        ),
      style = TextStyle(
        color = recurrenceDayText(day),
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium
      ),
      maxLines = 1
    )
  }

  companion object {
    private val COMPACT_SIZE = DpSize(130.dp, 110.dp)
    private val WIDE_SIZE = DpSize(276.dp, 110.dp)
    private val TALL_SIZE = DpSize(276.dp, 320.dp)
    private val EXTRA_TALL_SIZE = DpSize(276.dp, 560.dp)

    private val WidgetBackground = ColorProvider(
      day = Color(0xFFFBFCF8),
      night = Color(0xFF101414)
    )
    private val TextPrimary = ColorProvider(
      day = Color(0xFF17201C),
      night = Color(0xFFE9F1EC)
    )
    private val TextSecondary = ColorProvider(
      day = Color(0xFF5B6962),
      night = Color(0xFFA9B6AF)
    )
    private val ErrorText = ColorProvider(
      day = Color(0xFF9E2B25),
      night = Color(0xFFFFB4AB)
    )
    private val CheckAccent = ColorProvider(
      day = Color(0xFF047857),
      night = Color(0xFF6EE7B7)
    )
    private val ButtonBackground = ColorProvider(
      day = Color(0xFFEDE8E1),
      night = Color(0xFF24302B)
    )
    private val ButtonSelectedBackground = ColorProvider(
      day = Color(0xFFDDEDEA),
      night = Color(0xFF12312A)
    )
    private val ButtonSelectedText = ColorProvider(
      day = Color(0xFF0F766E),
      night = Color(0xFF99F6E4)
    )
    private val ChipText = ColorProvider(
      day = Color(0xFF1F2933),
      night = Color(0xFFE9F1EC)
    )
    private val ProjectChip = ColorProvider(
      day = Color(0xFFFFFFFF),
      night = Color(0xFF222A27)
    )
    private val RowCheckedBackground = ColorProvider(
      day = Color(0xFFF1F4F0),
      night = Color(0xFF151C19)
    )

    private fun stableItemId(id: String): Long {
      val hash = id.fold(1125899906842597L) { acc, char -> 31L * acc + char.code }
      val positiveHash = hash and Long.MAX_VALUE
      return if (positiveHash == 0L) 1L else positiveHash
    }

    private fun rowBackground(item: WidgetItem): GlanceColorProvider =
      if (item.checked) RowCheckedBackground else WidgetBackground

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

    private fun recurrenceDayBackground(day: WidgetRecurrenceDay): GlanceColorProvider =
      when {
        day.status == "completed" -> ColorProvider(day = Color(0xFF047857), night = Color(0xFF065F46))
        day.isIntended -> ColorProvider(day = Color(0xFFFFF7D6), night = Color(0xFF463A10))
        day.isToday -> ColorProvider(day = Color(0xFFE0F2FE), night = Color(0xFF133247))
        day.status == "missed" -> ColorProvider(day = Color(0xFFFFE4E6), night = Color(0xFF4A1720))
        day.status == "skipped" || day.status == "deferred" ->
          ColorProvider(day = Color(0xFFFFF7ED), night = Color(0xFF44220B))
        else -> ButtonBackground
      }

    private fun recurrenceDayText(day: WidgetRecurrenceDay): GlanceColorProvider =
      if (day.status == "completed") {
        ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFFE9F1EC))
      } else {
        TextPrimary
      }

    private fun areaAccentColor(color: String?): GlanceColorProvider =
      when (color) {
        "emerald", "cyan" -> ColorProvider(day = Color(0xFF0891B2), night = Color(0xFF67E8F9))
        "rose", "violet" -> ColorProvider(day = Color(0xFF7C3AED), night = Color(0xFFC4B5FD))
        "lime", "sky" -> ColorProvider(day = Color(0xFF0284C7), night = Color(0xFF7DD3FC))
        "amber" -> ColorProvider(day = Color(0xFFD97706), night = Color(0xFFFCD34D))
        "indigo" -> ColorProvider(day = Color(0xFF4F46E5), night = Color(0xFFA5B4FC))
        "fuchsia" -> ColorProvider(day = Color(0xFFC026D3), night = Color(0xFFF0ABFC))
        "blue" -> ColorProvider(day = Color(0xFF2563EB), night = Color(0xFF93C5FD))
        else -> ColorProvider(day = Color(0xFF78716C), night = Color(0xFFA8A29E))
      }

    private fun areaChipColor(color: String?): GlanceColorProvider =
      when (color) {
        "emerald", "cyan" -> ColorProvider(day = Color(0xFFE0F7FA), night = Color(0xFF133F46))
        "rose", "violet" -> ColorProvider(day = Color(0xFFF3E8FF), night = Color(0xFF33204B))
        "lime", "sky" -> ColorProvider(day = Color(0xFFE0F2FE), night = Color(0xFF133247))
        "amber" -> ColorProvider(day = Color(0xFFFEF3C7), night = Color(0xFF3B2E0A))
        "indigo" -> ColorProvider(day = Color(0xFFE0E7FF), night = Color(0xFF222454))
        "fuchsia" -> ColorProvider(day = Color(0xFFFAE8FF), night = Color(0xFF3B1A45))
        "blue" -> ColorProvider(day = Color(0xFFDBEAFE), night = Color(0xFF172B53))
        else -> ColorProvider(day = Color(0xFFF5F5F4), night = Color(0xFF292524))
      }
  }
}
