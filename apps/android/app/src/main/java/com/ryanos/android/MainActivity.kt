package com.ryanos.android

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.ryanos.android.data.clampRecurrenceLeadDays
import com.ryanos.android.data.RyanOsRepository
import com.ryanos.android.data.RyanOsSettings
import com.ryanos.android.data.ShoppingItem
import com.ryanos.android.data.ShoppingSnapshot
import com.ryanos.android.data.WidgetItem
import com.ryanos.android.data.WidgetSnapshot
import com.ryanos.android.widget.RyanOsShoppingWidgetRenderer
import com.ryanos.android.widget.RyanOsWidgetRenderer
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  private val repository by lazy { RyanOsRepository.getInstance(applicationContext) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      RyanOsTheme {
        RyanOsSettingsScreen(
          repository = repository,
          initialScreen = intent?.getStringExtra(EXTRA_INITIAL_SCREEN)
        )
      }
    }
  }

  companion object {
    const val EXTRA_INITIAL_SCREEN = "initial_screen"
    const val SCREEN_SHOPPING = "shopping"
  }
}

@Composable
private fun RyanOsTheme(content: @Composable () -> Unit) {
  val context = LocalContext.current
  val darkTheme = isSystemInDarkTheme()
  val colorScheme = when {
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && darkTheme -> dynamicDarkColorScheme(context)
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> dynamicLightColorScheme(context)
    darkTheme -> darkColorScheme()
    else -> lightColorScheme()
  }

  MaterialTheme(
    colorScheme = colorScheme,
    content = content
  )
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun RyanOsSettingsScreen(repository: RyanOsRepository, initialScreen: String? = null) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val scrollState = rememberScrollState()
  val settings by repository.settingsFlow.collectAsState(initial = RyanOsSettings())
  val snapshot by repository.snapshotFlow.collectAsState(
    initial = WidgetSnapshot(configured = settings.isConfigured)
  )
  val shoppingSnapshot by repository.shoppingSnapshotFlow.collectAsState(
    initial = ShoppingSnapshot(configured = settings.isConfigured)
  )
  var apiBaseUrl by remember { mutableStateOf(settings.apiBaseUrl) }
  var userId by remember { mutableStateOf(settings.userId) }
  var timezone by remember { mutableStateOf(settings.timezone) }
  var recurrenceLeadDays by remember { mutableStateOf(settings.recurrenceLeadDaysBeforeDue.toString()) }
  var showTaskDetails by remember { mutableStateOf(settings.showTaskDetails) }
  var colorCodeByArea by remember { mutableStateOf(settings.colorCodeByArea) }
  var quickAddTitle by remember { mutableStateOf("") }
  var shoppingName by remember { mutableStateOf("") }
  var shoppingCategory by remember { mutableStateOf("") }
  var shoppingQuantity by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var statusText by remember { mutableStateOf("") }

  LaunchedEffect(settings) {
    apiBaseUrl = settings.apiBaseUrl
    userId = settings.userId
    timezone = settings.timezone
    recurrenceLeadDays = settings.recurrenceLeadDaysBeforeDue.toString()
    showTaskDetails = settings.showTaskDetails
    colorCodeByArea = settings.colorCodeByArea
  }

  LaunchedEffect(initialScreen) {
    if (initialScreen == MainActivity.SCREEN_SHOPPING) {
      scrollState.animateScrollTo(900)
    }
  }

  fun launchWork(status: String, block: suspend () -> Unit) {
    scope.launch {
      busy = true
      statusText = status
      runCatching {
        block()
        RyanOsWidgetRenderer.updateAll(context)
        RyanOsShoppingWidgetRenderer.updateAll(context)
      }.onFailure { error ->
        statusText = error.message ?: "Action failed"
      }
      busy = false
    }
  }

  Scaffold(
    topBar = {
      TopAppBar(
        title = {
          Text(
            text = "RyanOS",
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
        }
      )
    }
  ) { paddingValues ->
    Column(
      modifier = Modifier
        .fillMaxSize()
        .verticalScroll(scrollState)
        .padding(paddingValues)
        .padding(horizontal = 20.dp, vertical = 16.dp),
      verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
      SettingsSection(
        apiBaseUrl = apiBaseUrl,
        onApiBaseUrlChange = { apiBaseUrl = it },
        userId = userId,
        onUserIdChange = { userId = it },
        timezone = timezone,
        onTimezoneChange = { timezone = it }
      )

      WidgetDisplaySection(
        recurrenceLeadDays = recurrenceLeadDays,
        onRecurrenceLeadDaysChange = { value ->
          recurrenceLeadDays = value.filter { it.isDigit() }.take(2)
        },
        showTaskDetails = showTaskDetails,
        onShowTaskDetailsChange = { showTaskDetails = it },
        colorCodeByArea = colorCodeByArea,
        onColorCodeByAreaChange = { colorCodeByArea = it }
      )

      Button(
        enabled = !busy && apiBaseUrl.isNotBlank(),
        onClick = {
          launchWork("Saving settings") {
            repository.saveSettings(
              RyanOsSettings(
                apiBaseUrl = apiBaseUrl,
                userId = userId,
                timezone = timezone,
                recurrenceLeadDaysBeforeDue = clampRecurrenceLeadDays(recurrenceLeadDays.toIntOrNull() ?: 1),
                showTaskDetails = showTaskDetails,
                colorCodeByArea = colorCodeByArea
              )
            )
            val refreshed = repository.refresh()
            repository.refreshShopping()
            statusText = refreshed.error ?: "Settings saved"
          }
        }
      ) {
        Text("Save")
      }

      HorizontalDivider()

      QuickAddSection(
        title = quickAddTitle,
        onTitleChange = { quickAddTitle = it },
        busy = busy,
        onAdd = {
          val title = quickAddTitle.trim()
          if (title.isNotEmpty()) {
            launchWork("Adding item") {
              val refreshed = repository.createItem(title)
              if (refreshed.error == null) {
                quickAddTitle = ""
                statusText = "Item added"
              } else {
                statusText = refreshed.error
              }
            }
          }
        }
      )

      ShoppingSection(
        snapshot = shoppingSnapshot,
        name = shoppingName,
        onNameChange = { shoppingName = it },
        category = shoppingCategory,
        onCategoryChange = { shoppingCategory = it },
        quantity = shoppingQuantity,
        onQuantityChange = { shoppingQuantity = it },
        busy = busy,
        onAdd = {
          val name = shoppingName.trim()
          if (name.isNotEmpty()) {
            launchWork("Adding shopping item") {
              val refreshed = repository.createShoppingItem(
                name = name,
                category = shoppingCategory,
                quantity = shoppingQuantity
              )
              if (refreshed.error == null) {
                shoppingName = ""
                shoppingQuantity = ""
                statusText = "Shopping item added"
              } else {
                statusText = refreshed.error
              }
            }
          }
        },
        onRefresh = {
          launchWork("Refreshing shopping") {
            val refreshed = repository.refreshShopping()
            statusText = refreshed.error ?: "Shopping refreshed"
          }
        },
        onToggle = { item ->
          launchWork(if (item.checked) "Undoing shopping item" else "Checking shopping item") {
            val targetChecked = !item.checked
            val updated = repository.toggleShoppingItemOptimistically(item.id, targetChecked)
            statusText = updated.error ?: if (targetChecked) "Marked bought" else "Shopping item restored"
            repository.sendShoppingToggle(item.id, targetChecked)
            repository.refreshShopping()
          }
        }
      )

      HorizontalDivider()

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
      ) {
        Button(
          enabled = !busy,
          onClick = {
            launchWork("Refreshing") {
              val refreshed = repository.refresh()
              statusText = refreshed.error ?: "Refreshed"
            }
          }
        ) {
          Text("Refresh")
        }
        TextButton(
          enabled = !busy,
          onClick = { statusText = snapshot.error.orEmpty() }
        ) {
          Text("Status")
        }
      }

      if (statusText.isNotBlank() || snapshot.error != null) {
        Text(
          text = snapshot.error ?: statusText,
          style = MaterialTheme.typography.bodyMedium,
          color = if (snapshot.error == null) {
            MaterialTheme.colorScheme.onSurfaceVariant
          } else {
            MaterialTheme.colorScheme.error
          }
        )
      }

      SnapshotSection(snapshot = snapshot)
    }
  }
}

@Composable
private fun SettingsSection(
  apiBaseUrl: String,
  onApiBaseUrlChange: (String) -> Unit,
  userId: String,
  onUserIdChange: (String) -> Unit,
  timezone: String,
  onTimezoneChange: (String) -> Unit
) {
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Text(
      text = "Connection",
      style = MaterialTheme.typography.titleMedium,
      fontWeight = FontWeight.SemiBold
    )
    OutlinedTextField(
      value = apiBaseUrl,
      onValueChange = onApiBaseUrlChange,
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
      label = { Text("API base URL") },
      placeholder = { Text("https://ryanos.example") }
    )
    OutlinedTextField(
      value = userId,
      onValueChange = onUserIdChange,
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
      label = { Text("User ID") }
    )
    OutlinedTextField(
      value = timezone,
      onValueChange = onTimezoneChange,
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
      label = { Text("Timezone") }
    )
  }
}

@Composable
private fun WidgetDisplaySection(
  recurrenceLeadDays: String,
  onRecurrenceLeadDaysChange: (String) -> Unit,
  showTaskDetails: Boolean,
  onShowTaskDetailsChange: (Boolean) -> Unit,
  colorCodeByArea: Boolean,
  onColorCodeByAreaChange: (Boolean) -> Unit
) {
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Text(
      text = "Widget display",
      style = MaterialTheme.typography.titleMedium,
      fontWeight = FontWeight.SemiBold
    )
    OutlinedTextField(
      value = recurrenceLeadDays,
      onValueChange = onRecurrenceLeadDaysChange,
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
      label = { Text("Show repeating tasks days before due") },
      placeholder = { Text("1") },
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
    )
    SettingSwitchRow(
      label = "Show task details",
      checked = showTaskDetails,
      onCheckedChange = onShowTaskDetailsChange
    )
    SettingSwitchRow(
      label = "Color code by area",
      checked = colorCodeByArea,
      onCheckedChange = onColorCodeByAreaChange
    )
  }
}

@Composable
private fun SettingSwitchRow(
  label: String,
  checked: Boolean,
  onCheckedChange: (Boolean) -> Unit
) {
  Row(
    modifier = Modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically
  ) {
    Text(
      text = label,
      style = MaterialTheme.typography.bodyLarge,
      modifier = Modifier.weight(1f)
    )
    Switch(
      checked = checked,
      onCheckedChange = onCheckedChange
    )
  }
}

@Composable
private fun QuickAddSection(
  title: String,
  onTitleChange: (String) -> Unit,
  busy: Boolean,
  onAdd: () -> Unit
) {
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Text(
      text = "Quick Add",
      style = MaterialTheme.typography.titleMedium,
      fontWeight = FontWeight.SemiBold
    )
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      OutlinedTextField(
        value = title,
        onValueChange = onTitleChange,
        modifier = Modifier.weight(1f),
        singleLine = true,
        label = { Text("Task") }
      )
      Button(
        enabled = !busy && title.isNotBlank(),
        onClick = onAdd
      ) {
        Text("Add")
      }
    }
  }
}

@Composable
private fun ShoppingSection(
  snapshot: ShoppingSnapshot,
  name: String,
  onNameChange: (String) -> Unit,
  category: String,
  onCategoryChange: (String) -> Unit,
  quantity: String,
  onQuantityChange: (String) -> Unit,
  busy: Boolean,
  onAdd: () -> Unit,
  onRefresh: () -> Unit,
  onToggle: (ShoppingItem) -> Unit
) {
  val categories = snapshot.categories.ifEmpty {
    listOf("grocery", "personal care", "household good", "health", "miscellaneous")
  }
  val openItems = snapshot.items.filterNot { it.checked }
  val checkedItems = snapshot.items.filter { it.checked }

  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically
    ) {
      Text(
        text = "Shopping",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold
      )
      TextButton(
        enabled = !busy,
        onClick = onRefresh
      ) {
        Text("Refresh")
      }
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      OutlinedTextField(
        value = name,
        onValueChange = onNameChange,
        modifier = Modifier.weight(1f),
        singleLine = true,
        label = { Text("Item") }
      )
      Button(
        enabled = !busy && name.isNotBlank(),
        onClick = onAdd
      ) {
        Text("Add")
      }
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      OutlinedTextField(
        value = quantity,
        onValueChange = onQuantityChange,
        modifier = Modifier.weight(1f),
        singleLine = true,
        label = { Text("Qty") }
      )
      OutlinedTextField(
        value = category,
        onValueChange = onCategoryChange,
        modifier = Modifier.weight(1.3f),
        singleLine = true,
        label = { Text("Category") },
        placeholder = { Text("auto") }
      )
    }

    CategoryShortcuts(
      categories = categories,
      selected = category,
      onSelect = onCategoryChange
    )

    if (!snapshot.configured) {
      Text(
        text = "Connect RyanOS to load shopping.",
        style = MaterialTheme.typography.bodyMedium
      )
      return
    }

    snapshot.error?.let { error ->
      Text(
        text = error,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.error
      )
    }

    if (openItems.isEmpty() && checkedItems.isEmpty()) {
      Text(
        text = "No shopping items.",
        style = MaterialTheme.typography.bodyMedium
      )
    } else {
      openItems.take(8).forEach { item ->
        ShoppingItemRow(item = item, onToggle = { onToggle(item) })
      }
      checkedItems.take(4).forEach { item ->
        ShoppingItemRow(item = item, onToggle = { onToggle(item) })
      }
    }

    if (snapshot.suggestions.isNotEmpty()) {
      Text(
        text = "Staples",
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold
      )
      snapshot.suggestions.take(5).forEach { suggestion ->
        TextButton(
          enabled = !busy,
          onClick = {
            onNameChange(suggestion.name)
            onCategoryChange(suggestion.category)
          }
        ) {
          Text(
            text = "${suggestion.name} / ${suggestion.category}",
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
        }
      }
    }
  }
}

@Composable
private fun CategoryShortcuts(
  categories: List<String>,
  selected: String,
  onSelect: (String) -> Unit
) {
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    categories.chunked(2).forEach { rowCategories ->
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
      ) {
        rowCategories.forEach { category ->
          TextButton(
            modifier = Modifier.weight(1f),
            onClick = { onSelect(if (selected == category) "" else category) }
          ) {
            Text(
              text = category,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              fontWeight = if (selected == category) FontWeight.Bold else FontWeight.Normal
            )
          }
        }
        if (rowCategories.size == 1) {
          Spacer(modifier = Modifier.weight(1f))
        }
      }
    }
  }
}

@Composable
private fun ShoppingItemRow(
  item: ShoppingItem,
  onToggle: () -> Unit
) {
  Row(
    modifier = Modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    TextButton(onClick = onToggle) {
      Text(if (item.checked) "Undo" else "Bought")
    }
    Column(modifier = Modifier.weight(1f)) {
      Text(
        text = item.name,
        style = MaterialTheme.typography.bodyLarge,
        fontWeight = if (item.checked) FontWeight.Normal else FontWeight.Medium,
        textDecoration = if (item.checked) TextDecoration.LineThrough else TextDecoration.None,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
      )
      Text(
        text = listOfNotNull(item.quantity, item.category, item.note).joinToString(" / "),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
      )
    }
  }
}

@Composable
private fun SnapshotSection(snapshot: WidgetSnapshot) {
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Text(
      text = "Widget Items",
      style = MaterialTheme.typography.titleMedium,
      fontWeight = FontWeight.SemiBold
    )
    if (!snapshot.configured) {
      Text(
        text = "Connect RyanOS to load items.",
        style = MaterialTheme.typography.bodyMedium
      )
      return
    }
    if (snapshot.items.isEmpty()) {
      Text(
        text = "No open items.",
        style = MaterialTheme.typography.bodyMedium
      )
      return
    }
    snapshot.items.take(8).forEach { item ->
      SnapshotItemRow(item = item)
    }
    snapshot.lastSyncedAt?.let { syncedAt ->
      Spacer(modifier = Modifier.height(2.dp))
      Text(
        text = "Last sync $syncedAt",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
      )
    }
  }
}

@Composable
private fun SnapshotItemRow(item: WidgetItem) {
  Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Text(
      text = if (item.checked) "Done: ${item.title}" else item.title,
      style = MaterialTheme.typography.bodyLarge,
      fontWeight = if (item.checked) FontWeight.Normal else FontWeight.Medium,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis
    )
    item.secondaryText?.let { secondaryText ->
      Text(
        text = secondaryText,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
      )
    }
  }
}
