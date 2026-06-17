package com.ryanos.android.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.Button
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
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
import androidx.glance.text.TextStyle
import com.ryanos.android.MainActivity
import com.ryanos.android.R
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.data.WidgetItem
import com.ryanos.android.data.WidgetSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

class RyanOsTodoWidget : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Responsive(
    setOf(
      COMPACT_SIZE,
      WIDE_SIZE,
      TALL_SIZE
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
    val maxItems = when {
      size.height < 120.dp -> 1
      size.height < 180.dp -> 2
      size.height < 235.dp -> 3
      else -> 4
    }
    val showSecondary = !compact && size.height >= 170.dp

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
          snapshot.items.take(maxItems).forEach { item ->
            WidgetItemRow(item = item, showSecondary = showSecondary)
            Spacer(modifier = GlanceModifier.height(4.dp))
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
  private fun WidgetItemRow(item: WidgetItem, showSecondary: Boolean) {
    val completed = !item.checked
    Row(modifier = GlanceModifier.fillMaxWidth()) {
      Button(
        text = if (item.checked) "Done" else "Do",
        onClick = actionRunCallback<ToggleItemAction>(
          actionParametersOf(
            WidgetActionKeys.ItemId to item.id,
            WidgetActionKeys.Completed to completed.toString(),
            WidgetActionKeys.Date to (item.action.date ?: ""),
            WidgetActionKeys.AllowEarly to item.action.allowEarly.toString()
          )
        )
      )
      Spacer(modifier = GlanceModifier.width(8.dp))
      Column(modifier = GlanceModifier.defaultWeight()) {
        Text(
          text = item.title,
          style = TextStyle(
            color = if (item.checked) TextSecondary else TextPrimary,
            fontSize = 14.sp,
            fontWeight = if (item.checked) FontWeight.Normal else FontWeight.Medium
          ),
          maxLines = if (showSecondary) 1 else 2
        )
        if (showSecondary && item.secondaryText != null) {
          Text(
            text = item.secondaryText,
            style = TextStyle(
              color = TextSecondary,
              fontSize = 12.sp
            ),
            maxLines = 1
          )
        }
      }
    }
  }

  companion object {
    private val COMPACT_SIZE = DpSize(130.dp, 110.dp)
    private val WIDE_SIZE = DpSize(276.dp, 110.dp)
    private val TALL_SIZE = DpSize(276.dp, 220.dp)

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
  }
}
