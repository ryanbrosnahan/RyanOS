package com.ryanos.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Today
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.ryanos.android.MainActivity
import com.ryanos.android.data.DailyPlanSnapshot
import com.ryanos.android.data.FocusItem
import com.ryanos.android.data.FocusRecurrenceDay
import com.ryanos.android.data.MessageSnapshot
import com.ryanos.android.data.RyanOsSettings
import com.ryanos.android.data.RyanOsWidgetKind
import com.ryanos.android.data.ShoppingItem
import com.ryanos.android.data.ShoppingItemPatch
import com.ryanos.android.data.ShoppingSnapshot
import com.ryanos.android.data.VocabularyEntry
import com.ryanos.android.data.VocabularyEntryPatch
import com.ryanos.android.data.VocabularySnapshot
import com.ryanos.android.data.WidgetScope
import com.ryanos.android.data.WidgetSnapshot
import com.ryanos.android.data.clampRecurrenceLeadDays

private enum class Destination(
  val route: String,
  val label: String,
  val icon: ImageVector
) {
  TODAY(MainActivity.SCREEN_TODAY, "Today", Icons.Filled.Today),
  SHOPPING(MainActivity.SCREEN_SHOPPING, "Shopping", Icons.Filled.ShoppingCart),
  VOCABULARY(MainActivity.SCREEN_VOCABULARY, "Words", Icons.Filled.MenuBook),
  CHAT(MainActivity.SCREEN_CHAT, "Chat", Icons.Filled.Chat),
  SETTINGS(MainActivity.SCREEN_SETTINGS, "Settings", Icons.Filled.Settings)
}

private enum class CaptureKind(val label: String) {
  TASK("Task"),
  SHOPPING("Shopping"),
  VOCABULARY("Word"),
  CHAT("Chat")
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun RyanOsApp(viewModel: RyanOsViewModel, initialScreen: String?) {
  val navController = rememberNavController()
  val settings by viewModel.settingsFlow.collectAsState(initial = RyanOsSettings())
  val dailyPlan by viewModel.dailyPlanFlow.collectAsState(initial = DailyPlanSnapshot(configured = settings.isConfigured))
  val todoSnapshot by viewModel.todoFlow.collectAsState(initial = WidgetSnapshot(configured = settings.isConfigured))
  val shoppingSnapshot by viewModel.shoppingFlow.collectAsState(initial = ShoppingSnapshot(configured = settings.isConfigured))
  val vocabularySnapshot by viewModel.vocabularyFlow.collectAsState(initial = VocabularySnapshot(configured = settings.isConfigured))
  val messageSnapshot by viewModel.messageFlow.collectAsState(initial = MessageSnapshot(configured = settings.isConfigured))
  val backStackEntry by navController.currentBackStackEntryAsState()
  val currentDestination = destinationForRoute(backStackEntry?.destination?.route)
  var captureKind by remember { mutableStateOf(CaptureKind.TASK) }
  var captureOpen by remember { mutableStateOf(false) }
  var initialRefreshDone by remember { mutableStateOf(false) }

  LaunchedEffect(initialScreen) {
    val destination = destinationForRoute(initialScreen)
    if (destination != Destination.TODAY) {
      navController.navigate(destination.route) {
        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
      }
    }
  }

  LaunchedEffect(settings.isConfigured) {
    if (settings.isConfigured && !initialRefreshDone) {
      initialRefreshDone = true
      viewModel.refreshInitial()
    }
  }

  fun openCapture(kind: CaptureKind = captureKindFor(currentDestination)) {
    captureKind = kind
    captureOpen = true
  }

  if (captureOpen) {
    CaptureSheet(
      initialKind = captureKind,
      busy = viewModel.busy,
      onDismiss = { captureOpen = false },
      onAddTask = {
        viewModel.addTask(it)
        captureOpen = false
      },
      onAddShopping = { name, category, quantity ->
        viewModel.addShoppingItem(name, category, quantity)
        captureOpen = false
      },
      onAddVocabulary = { term, languageCode, category, context ->
        viewModel.addVocabularyEntry(term, languageCode, category, context)
        captureOpen = false
      },
      onSendChat = {
        viewModel.sendChat(it)
        captureOpen = false
        navController.navigate(Destination.CHAT.route) {
          launchSingleTop = true
        }
      }
    )
  }

  BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
    val wide = maxWidth >= 720.dp
    Row(modifier = Modifier.fillMaxSize()) {
      if (wide) {
        RyanOsNavigationRail(
          currentDestination = currentDestination,
          onNavigate = { destination ->
            navController.navigate(destination.route) {
              popUpTo(navController.graph.findStartDestination().id) { saveState = true }
              launchSingleTop = true
              restoreState = true
            }
          }
        )
      }
      Scaffold(
        topBar = {
          TopAppBar(
            title = {
              Column {
                Text(currentDestination.label)
                if (viewModel.busyLabel != null) {
                  Text(
                    text = viewModel.busyLabel.orEmpty(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                  )
                }
              }
            },
            actions = {
              IconButton(onClick = { viewModel.refreshInitial() }) {
                Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
              }
            }
          )
        },
        bottomBar = {
          if (!wide) {
            RyanOsNavigationBar(
              currentDestination = currentDestination,
              onNavigate = { destination ->
                navController.navigate(destination.route) {
                  popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                  launchSingleTop = true
                  restoreState = true
                }
              }
            )
          }
        },
        floatingActionButton = {
          if (currentDestination != Destination.SETTINGS) {
            if (wide) {
              ExtendedFloatingActionButton(
                onClick = { openCapture() },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Add") }
              )
            } else {
              FloatingActionButton(onClick = { openCapture() }) {
                Icon(Icons.Filled.Add, contentDescription = "Add")
              }
            }
          }
        }
      ) { padding ->
        NavHost(
          navController = navController,
          startDestination = Destination.TODAY.route,
          modifier = Modifier
            .fillMaxSize()
            .padding(padding)
        ) {
          composable(Destination.TODAY.route) {
            TodayScreen(
              plan = dailyPlan,
              todoSnapshot = todoSnapshot,
              statusText = viewModel.statusText,
              busy = viewModel.busy,
              onRefresh = viewModel::refreshToday,
              onSuggest = viewModel::suggestToday,
              onToggle = { item -> viewModel.toggleFocusItem(item, dailyPlan.date) },
              onToggleDay = viewModel::toggleFocusItem,
              onToggleStar = viewModel::toggleStar,
              onAddTask = { openCapture(CaptureKind.TASK) },
              onOpenSettings = {
                navController.navigate(Destination.SETTINGS.route) {
                  launchSingleTop = true
                }
              }
            )
          }
          composable(Destination.SHOPPING.route) {
            ShoppingScreen(
              snapshot = shoppingSnapshot,
              busy = viewModel.busy,
              statusText = viewModel.statusText,
              onRefresh = viewModel::refreshShopping,
              onAdd = viewModel::addShoppingItem,
              onToggle = viewModel::toggleShoppingItem,
              onEdit = viewModel::editShoppingItem
            )
          }
          composable(Destination.VOCABULARY.route) {
            VocabularyScreen(
              snapshot = vocabularySnapshot,
              busy = viewModel.busy,
              statusText = viewModel.statusText,
              onRefresh = viewModel::refreshVocabulary,
              onAdd = viewModel::addVocabularyEntry,
              onEdit = viewModel::editVocabularyEntry
            )
          }
          composable(Destination.CHAT.route) {
            ChatScreen(
              snapshot = messageSnapshot,
              busy = viewModel.busy,
              statusText = viewModel.statusText,
              onRefresh = viewModel::refreshMessages,
              onSend = viewModel::sendChat
            )
          }
          composable(Destination.SETTINGS.route) {
            SettingsScreen(
              settings = settings,
              busy = viewModel.busy,
              statusText = viewModel.statusText,
              canPinWidgets = viewModel.repository.canRequestPinWidgets(),
              onSave = viewModel::saveSettings,
              onSignIn = viewModel::signIn,
              onSignOut = viewModel::signOut,
              onRefreshWidgets = viewModel::refreshWidgetCaches,
              onPinWidget = viewModel::requestPinWidget
            )
          }
        }
      }
    }
  }
}

@Composable
private fun RyanOsNavigationBar(
  currentDestination: Destination,
  onNavigate: (Destination) -> Unit
) {
  NavigationBar {
    Destination.entries.forEach { destination ->
      NavigationBarItem(
        selected = destination == currentDestination,
        onClick = { onNavigate(destination) },
        icon = { Icon(destination.icon, contentDescription = null) },
        label = { Text(destination.label) }
      )
    }
  }
}

@Composable
private fun RyanOsNavigationRail(
  currentDestination: Destination,
  onNavigate: (Destination) -> Unit
) {
  NavigationRail {
    Spacer(Modifier.height(12.dp))
    Destination.entries.forEach { destination ->
      NavigationRailItem(
        selected = destination == currentDestination,
        onClick = { onNavigate(destination) },
        icon = { Icon(destination.icon, contentDescription = null) },
        label = { Text(destination.label) }
      )
    }
  }
}

@Composable
private fun TodayScreen(
  plan: DailyPlanSnapshot,
  todoSnapshot: WidgetSnapshot,
  statusText: String,
  busy: Boolean,
  onRefresh: () -> Unit,
  onSuggest: () -> Unit,
  onToggle: (FocusItem) -> Unit,
  onToggleDay: (FocusItem, String, Boolean) -> Unit,
  onToggleStar: (FocusItem) -> Unit,
  onAddTask: () -> Unit,
  onOpenSettings: () -> Unit
) {
  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp)
  ) {
    item {
      HeaderActions(
        title = if (plan.date.isBlank()) "Today" else formatDateLabel(plan.date),
        subtitle = syncSubtitle(plan.lastSyncedAt, plan.error),
        primaryLabel = "Refresh",
        primaryIcon = Icons.Filled.Refresh,
        onPrimary = onRefresh,
        secondaryLabel = "Suggest",
        secondaryIcon = Icons.Filled.AutoAwesome,
        onSecondary = onSuggest,
        busy = busy
      )
    }
    item {
      StatusBanner(
        configured = plan.configured,
        error = plan.error,
        statusText = statusText,
        emptyMessage = "Connect RyanOS in Settings to load today.",
        onOpenSettings = onOpenSettings
      )
    }
    if (plan.configured) {
      val focusItems = plan.selectedItems.ifEmpty { plan.starredItems }.ifEmpty { plan.suggestedItems.take(4) }
      item {
        FocusSection(
          title = "Focus",
          items = focusItems,
          dateKey = plan.date,
          emptyText = "No focus items yet.",
          onToggle = onToggle,
          onToggleDay = onToggleDay,
          onToggleStar = onToggleStar
        )
      }
      item {
        FocusSection(
          title = "Due and recurring",
          items = plan.dueItems.filterNot { candidate -> focusItems.any { it.id == candidate.id } }.take(8),
          dateKey = plan.date,
          emptyText = "Nothing else needs attention.",
          onToggle = onToggle,
          onToggleDay = onToggleDay,
          onToggleStar = onToggleStar
        )
      }
      item {
        FocusSection(
          title = "All tasks",
          items = plan.items.take(12),
          dateKey = plan.date,
          emptyText = "No open tasks.",
          onToggle = onToggle,
          onToggleDay = onToggleDay,
          onToggleStar = onToggleStar
        )
      }
      item {
        WidgetPreviewCard(todoSnapshot = todoSnapshot, onAddTask = onAddTask)
      }
    }
  }
}

@Composable
private fun FocusSection(
  title: String,
  items: List<FocusItem>,
  dateKey: String,
  emptyText: String,
  onToggle: (FocusItem) -> Unit,
  onToggleDay: (FocusItem, String, Boolean) -> Unit,
  onToggleStar: (FocusItem) -> Unit
) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    SectionTitle(title, if (items.isEmpty()) null else items.size.toString())
    if (items.isEmpty()) {
      EmptyText(emptyText)
    } else {
      items.forEach { item ->
        FocusItemRow(
          item = item,
          dateKey = dateKey,
          onToggle = { onToggle(item) },
          onToggleDay = { day ->
            val completed = day.status != "completed"
            onToggleDay(item, day.date, completed)
          },
          onToggleStar = { onToggleStar(item) }
        )
      }
    }
  }
}

@Composable
private fun FocusItemRow(
  item: FocusItem,
  dateKey: String,
  onToggle: () -> Unit,
  onToggleDay: (FocusRecurrenceDay) -> Unit,
  onToggleStar: () -> Unit
) {
  val checked = item.checkedFor(dateKey)
  ElevatedCard(
    colors = CardDefaults.elevatedCardColors(
      containerColor = if (checked) {
        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
      } else {
        MaterialTheme.colorScheme.surface
      }
    )
  ) {
    Column(
      modifier = Modifier.padding(12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
      ) {
        IconButton(onClick = onToggle) {
          Icon(
            imageVector = if (checked) Icons.Filled.Undo else Icons.Outlined.RadioButtonUnchecked,
            contentDescription = if (checked) "Undo" else "Mark done",
            tint = if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
          )
        }
        Column(modifier = Modifier.weight(1f)) {
          Text(
            text = item.title,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (checked) FontWeight.Normal else FontWeight.SemiBold,
            textDecoration = if (checked) TextDecoration.LineThrough else TextDecoration.None,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
          )
          TaskMeta(item)
        }
        IconButton(onClick = onToggleStar) {
          Icon(
            imageVector = if (item.starred) Icons.Filled.Star else Icons.Outlined.StarBorder,
            contentDescription = if (item.starred) "Unstar" else "Star",
            tint = if (item.starred) Color(0xFFB45309) else MaterialTheme.colorScheme.onSurfaceVariant
          )
        }
      }
      ScopeChips(item.scope)
      if (item.recurrence != null) {
        Row(
          horizontalArrangement = Arrangement.spacedBy(6.dp),
          verticalAlignment = Alignment.CenterVertically
        ) {
          item.recurrence.week.days.takeLast(7).forEach { day ->
            val dayChecked = day.status == "completed"
            FilterChip(
              selected = dayChecked,
              onClick = { onToggleDay(day) },
              label = {
                Text(
                  text = recurrenceDayLabel(day),
                  maxLines = 1
                )
              },
              leadingIcon = if (dayChecked) {
                { Icon(Icons.Filled.CheckCircle, contentDescription = null) }
              } else {
                null
              }
            )
          }
        }
      }
      if (item.checklist.total > 0 || item.progress.count > 0) {
        Text(
          text = listOfNotNull(
            if (item.checklist.total > 0) "${item.checklist.completed}/${item.checklist.total} checklist" else null,
            if (item.progress.count > 0) "${item.progress.count} notes" else null
          ).joinToString(" / "),
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }
    }
  }
}

@Composable
private fun TaskMeta(item: FocusItem) {
  val meta = listOfNotNull(
    item.kind.takeIf { it.isNotBlank() },
    item.priority.takeIf { it.isNotBlank() },
    item.dueAt?.take(10),
    item.recurrence?.state?.nextDueAt?.take(10)
  ).joinToString(" / ")
  if (meta.isNotBlank()) {
    Text(
      text = meta,
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis
    )
  }
}

@Composable
private fun WidgetPreviewCard(todoSnapshot: WidgetSnapshot, onAddTask: () -> Unit) {
  Card {
    Column(
      modifier = Modifier.padding(14.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        SectionTitle("Widget cache", todoSnapshot.items.size.toString())
        TextButton(onClick = onAddTask) {
          Text("Add task")
        }
      }
      todoSnapshot.items.take(3).forEach { item ->
        Text(
          text = if (item.checked) "Done: ${item.title}" else item.title,
          style = MaterialTheme.typography.bodyMedium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
      if (todoSnapshot.items.isEmpty()) EmptyText("No cached widget tasks.")
    }
  }
}

@Composable
private fun ShoppingScreen(
  snapshot: ShoppingSnapshot,
  busy: Boolean,
  statusText: String,
  onRefresh: () -> Unit,
  onAdd: (String, String?, String?) -> Unit,
  onToggle: (ShoppingItem) -> Unit,
  onEdit: (String, ShoppingItemPatch) -> Unit
) {
  val categories = snapshot.categories.ifEmpty { defaultShoppingCategories }
  var name by remember { mutableStateOf("") }
  var quantity by remember { mutableStateOf("") }
  var category by remember { mutableStateOf("") }
  var editItem by remember { mutableStateOf<ShoppingItem?>(null) }
  val openItems = snapshot.items.filterNot { it.checked }
  val checkedItems = snapshot.items.filter { it.checked }
  val groupedOpen = openItems.groupBy { it.category }

  editItem?.let { item ->
    ShoppingEditSheet(
      item = item,
      categories = categories,
      onDismiss = { editItem = null },
      onSave = { patch ->
        onEdit(item.id, patch)
        editItem = null
      }
    )
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp)
  ) {
    item {
      HeaderActions(
        title = "Shopping",
        subtitle = syncSubtitle(snapshot.lastSyncedAt, snapshot.error),
        primaryLabel = "Refresh",
        primaryIcon = Icons.Filled.Refresh,
        onPrimary = onRefresh,
        busy = busy
      )
    }
    item {
      StatusBanner(snapshot.configured, snapshot.error, statusText, "Connect RyanOS in Settings to load shopping.")
    }
    item {
      QuickShoppingForm(
        name = name,
        quantity = quantity,
        category = category,
        categories = categories,
        busy = busy,
        onNameChange = { name = it },
        onQuantityChange = { quantity = it },
        onCategoryChange = { category = it },
        onAdd = {
          onAdd(name, category.takeIf { it.isNotBlank() }, quantity.takeIf { it.isNotBlank() })
          name = ""
          quantity = ""
        }
      )
    }
    if (snapshot.configured) {
      if (groupedOpen.isEmpty() && checkedItems.isEmpty()) {
        item { EmptyText("Nothing on the list.") }
      } else {
        groupedOpen.forEach { (group, itemsForGroup) ->
          item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
              SectionTitle(displayCategory(group), itemsForGroup.size.toString())
              itemsForGroup.forEach { item ->
                ShoppingItemRow(
                  item = item,
                  onToggle = { onToggle(item) },
                  onEdit = { editItem = item }
                )
              }
            }
          }
        }
        if (checkedItems.isNotEmpty()) {
          item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
              SectionTitle("Bought today", checkedItems.size.toString())
              checkedItems.forEach { item ->
                ShoppingItemRow(
                  item = item,
                  onToggle = { onToggle(item) },
                  onEdit = { editItem = item }
                )
              }
            }
          }
        }
      }
      if (snapshot.suggestions.isNotEmpty()) {
        item {
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionTitle("Staples")
            snapshot.suggestions.take(8).forEach { suggestion ->
              AssistChip(
                onClick = {
                  name = suggestion.name
                  category = suggestion.category
                },
                label = { Text("${suggestion.name} / ${displayCategory(suggestion.category)}") }
              )
            }
          }
        }
      }
    }
  }
}

@Composable
private fun QuickShoppingForm(
  name: String,
  quantity: String,
  category: String,
  categories: List<String>,
  busy: Boolean,
  onNameChange: (String) -> Unit,
  onQuantityChange: (String) -> Unit,
  onCategoryChange: (String) -> Unit,
  onAdd: () -> Unit
) {
  ElevatedCard {
    Column(
      modifier = Modifier.padding(14.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      OutlinedTextField(
        value = name,
        onValueChange = onNameChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        label = { Text("Item") }
      )
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
          value = quantity,
          onValueChange = onQuantityChange,
          modifier = Modifier.weight(0.8f),
          singleLine = true,
          label = { Text("Qty") }
        )
        OutlinedTextField(
          value = category,
          onValueChange = onCategoryChange,
          modifier = Modifier.weight(1.2f),
          singleLine = true,
          label = { Text("Category") },
          placeholder = { Text("auto") }
        )
      }
      CategoryChips(categories, category, onCategoryChange)
      Button(
        enabled = !busy && name.isNotBlank(),
        onClick = onAdd
      ) {
        Icon(Icons.Filled.Add, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text("Add")
      }
    }
  }
}

@Composable
private fun ShoppingItemRow(item: ShoppingItem, onToggle: () -> Unit, onEdit: () -> Unit) {
  ElevatedCard {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(12.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      IconButton(onClick = onToggle) {
        Icon(
          imageVector = if (item.checked) Icons.Filled.Undo else Icons.Outlined.RadioButtonUnchecked,
          contentDescription = if (item.checked) "Undo" else "Bought"
        )
      }
      Column(modifier = Modifier.weight(1f)) {
        Text(
          text = item.name,
          style = MaterialTheme.typography.bodyLarge,
          fontWeight = if (item.checked) FontWeight.Normal else FontWeight.SemiBold,
          textDecoration = if (item.checked) TextDecoration.LineThrough else TextDecoration.None,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        Text(
          text = listOfNotNull(item.quantity, displayCategory(item.category), item.note).joinToString(" / "),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
      IconButton(onClick = onEdit) {
        Icon(Icons.Filled.Edit, contentDescription = "Edit")
      }
    }
  }
}

@Composable
private fun VocabularyScreen(
  snapshot: VocabularySnapshot,
  busy: Boolean,
  statusText: String,
  onRefresh: () -> Unit,
  onAdd: (String, String?, String?, String?) -> Unit,
  onEdit: (String, VocabularyEntryPatch) -> Unit
) {
  val categories = snapshot.categories.ifEmpty { defaultVocabularyCategories }
  var term by remember { mutableStateOf("") }
  var languageCode by remember { mutableStateOf("en") }
  var category by remember { mutableStateOf("") }
  var context by remember { mutableStateOf("") }
  var query by remember { mutableStateOf("") }
  var filterCategory by remember { mutableStateOf("") }
  var selectedEntry by remember { mutableStateOf<VocabularyEntry?>(null) }
  val filtered = snapshot.entries.filter { entry ->
    val matchesQuery = query.isBlank() ||
      entry.term.contains(query, ignoreCase = true) ||
      entry.definition.orEmpty().contains(query, ignoreCase = true) ||
      entry.tags.any { it.contains(query, ignoreCase = true) }
    val matchesCategory = filterCategory.isBlank() || entry.category == filterCategory
    matchesQuery && matchesCategory
  }

  selectedEntry?.let { entry ->
    VocabularyDetailSheet(
      entry = entry,
      categories = categories,
      encounters = snapshot.encountersByEntryId[entry.id].orEmpty(),
      onDismiss = { selectedEntry = null },
      onSave = { patch ->
        onEdit(entry.id, patch)
        selectedEntry = null
      }
    )
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp)
  ) {
    item {
      HeaderActions(
        title = "Vocabulary",
        subtitle = syncSubtitle(snapshot.lastSyncedAt, snapshot.error),
        primaryLabel = "Refresh",
        primaryIcon = Icons.Filled.Refresh,
        onPrimary = onRefresh,
        busy = busy
      )
    }
    item {
      StatusBanner(snapshot.configured, snapshot.error, statusText, "Connect RyanOS in Settings to load vocabulary.")
    }
    item {
      ElevatedCard {
        Column(
          modifier = Modifier.padding(14.dp),
          verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
          OutlinedTextField(
            value = term,
            onValueChange = { term = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("Word or term") }
          )
          Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
              value = languageCode,
              onValueChange = { languageCode = it },
              modifier = Modifier.weight(0.7f),
              singleLine = true,
              label = { Text("Lang") }
            )
            OutlinedTextField(
              value = category,
              onValueChange = { category = it },
              modifier = Modifier.weight(1.3f),
              singleLine = true,
              label = { Text("Category") },
              placeholder = { Text("auto") }
            )
          }
          OutlinedTextField(
            value = context,
            onValueChange = { context = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Context") },
            maxLines = 3
          )
          CategoryChips(categories, category, { category = it })
          Button(
            enabled = !busy && term.isNotBlank(),
            onClick = {
              onAdd(term, languageCode, category.takeIf { it.isNotBlank() }, context.takeIf { it.isNotBlank() })
              term = ""
              context = ""
            }
          ) {
            Icon(Icons.Filled.Add, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Add")
          }
        }
      }
    }
    item {
      OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        label = { Text("Search") },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) }
      )
    }
    item { CategoryChips(categories, filterCategory, { filterCategory = it }) }
    if (snapshot.configured) {
      if (filtered.isEmpty()) {
        item { EmptyText("No vocabulary entries match.") }
      } else {
        items(filtered, key = { it.id }) { entry ->
          VocabularyEntryRow(
            entry = entry,
            onClick = { selectedEntry = entry }
          )
        }
      }
    }
  }
}

@Composable
private fun VocabularyEntryRow(entry: VocabularyEntry, onClick: () -> Unit) {
  ElevatedCard(onClick = onClick) {
    Column(
      modifier = Modifier.padding(14.dp),
      verticalArrangement = Arrangement.spacedBy(5.dp)
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        Text(
          text = entry.term,
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.weight(1f),
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        Text(
          text = "${entry.languageCode} / ${displayCategory(entry.category)}",
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }
      entry.partOfSpeech?.let {
        Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
      }
      Text(
        text = entry.definition?.takeIf { it.isNotBlank() } ?: "No definition yet.",
        style = MaterialTheme.typography.bodyMedium,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis
      )
      if (entry.tags.isNotEmpty()) {
        Text(
          text = entry.tags.joinToString(", "),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
    }
  }
}

@Composable
private fun ChatScreen(
  snapshot: MessageSnapshot,
  busy: Boolean,
  statusText: String,
  onRefresh: () -> Unit,
  onSend: (String) -> Unit
) {
  var input by remember { mutableStateOf("") }
  val prompts = listOf(
    "Plan today",
    "Add dish detergent to shopping",
    "Save the word serendipity",
    "What should I focus on?"
  )

  Column(modifier = Modifier.fillMaxSize()) {
    LazyColumn(
      modifier = Modifier
        .weight(1f)
        .fillMaxWidth(),
      contentPadding = PaddingValues(16.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      item {
        HeaderActions(
          title = "Chat",
          subtitle = syncSubtitle(snapshot.lastSyncedAt, snapshot.error),
          primaryLabel = "Refresh",
          primaryIcon = Icons.Filled.Refresh,
          onPrimary = onRefresh,
          busy = busy
        )
      }
      item {
        StatusBanner(snapshot.configured, snapshot.error, statusText, "Connect RyanOS in Settings to use chat.")
      }
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          prompts.take(2).forEach { prompt ->
            AssistChip(onClick = { input = prompt }, label = { Text(prompt) })
          }
        }
      }
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          prompts.drop(2).forEach { prompt ->
            AssistChip(onClick = { input = prompt }, label = { Text(prompt) })
          }
        }
      }
      if (snapshot.messages.isEmpty()) {
        item { EmptyText("No chat history yet.") }
      } else {
        items(snapshot.messages, key = { it.id }) { message ->
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = if (message.role == "user") Arrangement.End else Arrangement.Start
          ) {
            Card(
              colors = CardDefaults.cardColors(
                containerColor = if (message.role == "user") {
                  MaterialTheme.colorScheme.primaryContainer
                } else {
                  MaterialTheme.colorScheme.surfaceVariant
                }
              )
            ) {
              Text(
                text = if (message.pending) "${message.text}\nSending..." else message.text,
                modifier = Modifier
                  .padding(12.dp)
                  .fillMaxWidth(0.82f),
                style = MaterialTheme.typography.bodyMedium
              )
            }
          }
        }
      }
    }
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(16.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      OutlinedTextField(
        value = input,
        onValueChange = { input = it },
        modifier = Modifier.weight(1f),
        minLines = 1,
        maxLines = 4,
        label = { Text("Message") }
      )
      IconButton(
        enabled = !busy && input.isNotBlank(),
        onClick = {
          onSend(input)
          input = ""
        }
      ) {
        Icon(Icons.Filled.Send, contentDescription = "Send")
      }
    }
  }
}

@Composable
private fun SettingsScreen(
  settings: RyanOsSettings,
  busy: Boolean,
  statusText: String,
  canPinWidgets: Boolean,
  onSave: (RyanOsSettings) -> Unit,
  onSignIn: (String, String, String) -> Unit,
  onSignOut: () -> Unit,
  onRefreshWidgets: () -> Unit,
  onPinWidget: (RyanOsWidgetKind) -> Unit
) {
  var apiBaseUrl by remember { mutableStateOf(settings.apiBaseUrl) }
  var email by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var timezone by remember { mutableStateOf(settings.timezone) }
  var recurrenceLeadDays by remember { mutableStateOf(settings.recurrenceLeadDaysBeforeDue.toString()) }
  var showTaskDetails by remember { mutableStateOf(settings.showTaskDetails) }
  var colorCodeByArea by remember { mutableStateOf(settings.colorCodeByArea) }

  LaunchedEffect(settings) {
    apiBaseUrl = settings.apiBaseUrl
    timezone = settings.timezone
    recurrenceLeadDays = settings.recurrenceLeadDaysBeforeDue.toString()
    showTaskDetails = settings.showTaskDetails
    colorCodeByArea = settings.colorCodeByArea
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp)
  ) {
    item {
      StatusBanner(true, null, statusText, "")
    }
    item {
      SettingsCard(title = "Connection", icon = Icons.Filled.Home) {
        OutlinedTextField(
          value = apiBaseUrl,
          onValueChange = { apiBaseUrl = it },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          label = { Text("API base URL") }
        )
        OutlinedTextField(
          value = timezone,
          onValueChange = { timezone = it },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          label = { Text("Timezone") }
        )
        Button(
          enabled = !busy && apiBaseUrl.isNotBlank(),
          onClick = {
            onSave(
              RyanOsSettings(
                apiBaseUrl = apiBaseUrl,
                userId = settings.userId,
                sessionCookie = settings.sessionCookie,
                timezone = timezone,
                recurrenceLeadDaysBeforeDue = clampRecurrenceLeadDays(recurrenceLeadDays.toIntOrNull() ?: 1),
                showTaskDetails = showTaskDetails,
                colorCodeByArea = colorCodeByArea
              )
            )
          }
        ) {
          Icon(Icons.Filled.Save, contentDescription = null)
          Spacer(Modifier.width(8.dp))
          Text("Save")
        }
        Text(
          text = if (settings.hasSession) {
            "Session saved for authenticated API requests."
          } else {
            "No session saved. This only works against a dev-local API."
          },
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        OutlinedTextField(
          value = email,
          onValueChange = { email = it },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          label = { Text("Email") },
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
        )
        OutlinedTextField(
          value = password,
          onValueChange = { password = it },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          label = { Text("Password") },
          visualTransformation = PasswordVisualTransformation(),
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Button(
            enabled = !busy && apiBaseUrl.isNotBlank() && email.isNotBlank() && password.isNotBlank(),
            onClick = {
              onSignIn(apiBaseUrl, email, password)
              password = ""
            }
          ) {
            Text("Sign in")
          }
          OutlinedButton(
            enabled = !busy && settings.hasSession,
            onClick = onSignOut
          ) {
            Text("Clear session")
          }
        }
      }
    }
    item {
      SettingsCard(title = "Widget display", icon = Icons.Filled.Widgets) {
        OutlinedTextField(
          value = recurrenceLeadDays,
          onValueChange = { recurrenceLeadDays = it.filter { char -> char.isDigit() }.take(2) },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          label = { Text("Show repeating tasks days before due") },
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
        )
        SwitchRow("Show task details", showTaskDetails, { showTaskDetails = it })
        SwitchRow("Color code by area", colorCodeByArea, { colorCodeByArea = it })
      }
    }
    item {
      SettingsCard(title = "Sync and diagnostics", icon = Icons.Filled.Refresh) {
        Text(
          text = when {
            !settings.isConfigured -> "Not connected"
            settings.hasSession -> "Connected with saved session"
            else -> "Connected without session"
          },
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        OutlinedButton(enabled = !busy, onClick = onRefreshWidgets) {
          Icon(Icons.Filled.Refresh, contentDescription = null)
          Spacer(Modifier.width(8.dp))
          Text("Refresh widget caches")
        }
      }
    }
    item {
      SettingsCard(title = "Home screen widgets", icon = Icons.Filled.Widgets) {
        Text(
          text = if (canPinWidgets) {
            "Ask Android to place a widget on the home screen."
          } else {
            "This launcher may require adding widgets manually from the home screen."
          },
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = { onPinWidget(RyanOsWidgetKind.TODO) }) { Text("To-Do") }
          OutlinedButton(onClick = { onPinWidget(RyanOsWidgetKind.SHOPPING) }) { Text("Shopping") }
          OutlinedButton(onClick = { onPinWidget(RyanOsWidgetKind.VOCABULARY) }) { Text("Words") }
        }
      }
    }
  }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun CaptureSheet(
  initialKind: CaptureKind,
  busy: Boolean,
  onDismiss: () -> Unit,
  onAddTask: (String) -> Unit,
  onAddShopping: (String, String?, String?) -> Unit,
  onAddVocabulary: (String, String?, String?, String?) -> Unit,
  onSendChat: (String) -> Unit
) {
  var kind by remember { mutableStateOf(initialKind) }
  var primary by remember { mutableStateOf("") }
  var secondary by remember { mutableStateOf("") }
  var tertiary by remember { mutableStateOf("") }
  var context by remember { mutableStateOf("") }

  ModalBottomSheet(onDismissRequest = onDismiss) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 20.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      SectionTitle("Quick add")
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CaptureKind.entries.forEach { option ->
          FilterChip(
            selected = kind == option,
            onClick = {
              kind = option
              primary = ""
              secondary = ""
              tertiary = ""
              context = ""
            },
            label = { Text(option.label) }
          )
        }
      }
      when (kind) {
        CaptureKind.TASK -> {
          OutlinedTextField(primary, { primary = it }, Modifier.fillMaxWidth(), label = { Text("Task") })
          Button(enabled = !busy && primary.isNotBlank(), onClick = { onAddTask(primary) }) {
            Text("Add task")
          }
        }
        CaptureKind.SHOPPING -> {
          OutlinedTextField(primary, { primary = it }, Modifier.fillMaxWidth(), label = { Text("Item") })
          Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(secondary, { secondary = it }, Modifier.weight(1f), label = { Text("Qty") })
            OutlinedTextField(tertiary, { tertiary = it }, Modifier.weight(1.2f), label = { Text("Category") })
          }
          Button(enabled = !busy && primary.isNotBlank(), onClick = {
            onAddShopping(primary, tertiary.takeIf { it.isNotBlank() }, secondary.takeIf { it.isNotBlank() })
          }) {
            Text("Add item")
          }
        }
        CaptureKind.VOCABULARY -> {
          OutlinedTextField(primary, { primary = it }, Modifier.fillMaxWidth(), label = { Text("Word or term") })
          Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(secondary, { secondary = it }, Modifier.weight(0.7f), label = { Text("Lang") })
            OutlinedTextField(tertiary, { tertiary = it }, Modifier.weight(1.3f), label = { Text("Category") })
          }
          OutlinedTextField(context, { context = it }, Modifier.fillMaxWidth(), label = { Text("Context") }, maxLines = 3)
          Button(enabled = !busy && primary.isNotBlank(), onClick = {
            onAddVocabulary(
              primary,
              secondary.ifBlank { "en" },
              tertiary.takeIf { it.isNotBlank() },
              context.takeIf { it.isNotBlank() }
            )
          }) {
            Text("Save word")
          }
        }
        CaptureKind.CHAT -> {
          OutlinedTextField(primary, { primary = it }, Modifier.fillMaxWidth(), label = { Text("Message") }, minLines = 2)
          Button(enabled = !busy && primary.isNotBlank(), onClick = { onSendChat(primary) }) {
            Text("Send")
          }
        }
      }
      Spacer(Modifier.height(12.dp))
    }
  }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun ShoppingEditSheet(
  item: ShoppingItem,
  categories: List<String>,
  onDismiss: () -> Unit,
  onSave: (ShoppingItemPatch) -> Unit
) {
  var name by remember(item.id) { mutableStateOf(item.name) }
  var quantity by remember(item.id) { mutableStateOf(item.quantity.orEmpty()) }
  var category by remember(item.id) { mutableStateOf(item.category) }
  var note by remember(item.id) { mutableStateOf(item.note.orEmpty()) }
  ModalBottomSheet(onDismissRequest = onDismiss) {
    Column(
      modifier = Modifier.padding(20.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      SectionTitle("Edit shopping item")
      OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Item") })
      OutlinedTextField(quantity, { quantity = it }, Modifier.fillMaxWidth(), label = { Text("Qty") })
      OutlinedTextField(category, { category = it }, Modifier.fillMaxWidth(), label = { Text("Category") })
      CategoryChips(categories, category, { category = it })
      OutlinedTextField(note, { note = it }, Modifier.fillMaxWidth(), label = { Text("Note") })
      Button(
        enabled = name.isNotBlank(),
        onClick = {
          onSave(
            ShoppingItemPatch(
              name = name,
              category = category,
              quantity = quantity,
              note = note
            )
          )
        }
      ) {
        Icon(Icons.Filled.Save, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text("Save")
      }
    }
  }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun VocabularyDetailSheet(
  entry: VocabularyEntry,
  categories: List<String>,
  encounters: List<com.ryanos.android.data.VocabularyEncounter>,
  onDismiss: () -> Unit,
  onSave: (VocabularyEntryPatch) -> Unit
) {
  var term by remember(entry.id) { mutableStateOf(entry.term) }
  var language by remember(entry.id) { mutableStateOf(entry.languageCode) }
  var category by remember(entry.id) { mutableStateOf(entry.category) }
  var definition by remember(entry.id) { mutableStateOf(entry.definition.orEmpty()) }
  var partOfSpeech by remember(entry.id) { mutableStateOf(entry.partOfSpeech.orEmpty()) }
  var pronunciation by remember(entry.id) { mutableStateOf(entry.pronunciation.orEmpty()) }
  var translation by remember(entry.id) { mutableStateOf(entry.translation.orEmpty()) }
  var notes by remember(entry.id) { mutableStateOf(entry.notes.orEmpty()) }
  var tags by remember(entry.id) { mutableStateOf(entry.tags.joinToString(", ")) }
  ModalBottomSheet(onDismissRequest = onDismiss) {
    LazyColumn(
      contentPadding = PaddingValues(20.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      item { SectionTitle("Edit word") }
      item { OutlinedTextField(term, { term = it }, Modifier.fillMaxWidth(), label = { Text("Term") }) }
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          OutlinedTextField(language, { language = it }, Modifier.weight(0.7f), label = { Text("Lang") })
          OutlinedTextField(category, { category = it }, Modifier.weight(1.3f), label = { Text("Category") })
        }
      }
      item { CategoryChips(categories, category, { category = it }) }
      item { OutlinedTextField(definition, { definition = it }, Modifier.fillMaxWidth(), label = { Text("Definition") }, minLines = 2, maxLines = 5) }
      item {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          OutlinedTextField(partOfSpeech, { partOfSpeech = it }, Modifier.weight(1f), label = { Text("Part of speech") })
          OutlinedTextField(pronunciation, { pronunciation = it }, Modifier.weight(1f), label = { Text("Pronunciation") })
        }
      }
      item { OutlinedTextField(translation, { translation = it }, Modifier.fillMaxWidth(), label = { Text("Translation") }) }
      item { OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Notes") }, minLines = 2, maxLines = 5) }
      item { OutlinedTextField(tags, { tags = it }, Modifier.fillMaxWidth(), label = { Text("Tags") }) }
      if (encounters.isNotEmpty()) {
        item {
          Text(
            text = encounters.first().context ?: "Encounter saved ${encounters.first().occurredAt.take(10)}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
          )
        }
      }
      item {
        Button(
          enabled = term.isNotBlank(),
          onClick = {
            onSave(
              VocabularyEntryPatch(
                term = term,
                languageCode = language,
                category = category,
                definition = definition,
                partOfSpeech = partOfSpeech,
                pronunciation = pronunciation,
                translation = translation,
                notes = notes,
                tags = tags.split(",").map { it.trim() }.filter { it.isNotBlank() }
              )
            )
          }
        ) {
          Icon(Icons.Filled.Save, contentDescription = null)
          Spacer(Modifier.width(8.dp))
          Text("Save")
        }
      }
    }
  }
}

@Composable
private fun HeaderActions(
  title: String,
  subtitle: String?,
  primaryLabel: String,
  primaryIcon: ImageVector,
  onPrimary: () -> Unit,
  busy: Boolean,
  secondaryLabel: String? = null,
  secondaryIcon: ImageVector? = null,
  onSecondary: (() -> Unit)? = null
) {
  Row(
    modifier = Modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
  ) {
    Column(modifier = Modifier.weight(1f)) {
      Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
      subtitle?.let {
        Text(
          text = it,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      if (secondaryLabel != null && secondaryIcon != null && onSecondary != null) {
        OutlinedButton(enabled = !busy, onClick = onSecondary) {
          Icon(secondaryIcon, contentDescription = null)
          Spacer(Modifier.width(6.dp))
          Text(secondaryLabel)
        }
      }
      Button(enabled = !busy, onClick = onPrimary) {
        Icon(primaryIcon, contentDescription = null)
        Spacer(Modifier.width(6.dp))
        Text(primaryLabel)
      }
    }
  }
}

@Composable
private fun SettingsCard(title: String, icon: ImageVector, content: @Composable ColumnScope.() -> Unit) {
  ElevatedCard {
    Column(
      modifier = Modifier.padding(14.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, contentDescription = null)
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      }
      content()
    }
  }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
  Row(
    modifier = Modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
  ) {
    Text(label, modifier = Modifier.weight(1f))
    Switch(checked = checked, onCheckedChange = onCheckedChange)
  }
}

@Composable
private fun SectionTitle(title: String, count: String? = null) {
  Row(
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    count?.let {
      Text(
        text = it,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant
      )
    }
  }
}

@Composable
private fun StatusBanner(
  configured: Boolean,
  error: String?,
  statusText: String,
  emptyMessage: String,
  onOpenSettings: (() -> Unit)? = null
) {
  val text = when {
    !configured -> emptyMessage
    error != null -> error
    else -> statusText
  }
  if (text.isBlank()) return
  Card(
    colors = CardDefaults.cardColors(
      containerColor = if (error != null) {
        MaterialTheme.colorScheme.errorContainer
      } else {
        MaterialTheme.colorScheme.surfaceVariant
      }
    ),
    border = if (error != null) BorderStroke(1.dp, MaterialTheme.colorScheme.error) else null
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(12.dp),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically
    ) {
      Text(
        text = text,
        modifier = Modifier.weight(1f),
        style = MaterialTheme.typography.bodyMedium,
        color = if (error != null) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant
      )
      if (!configured && onOpenSettings != null) {
        TextButton(onClick = onOpenSettings) { Text("Settings") }
      }
    }
  }
}

@Composable
private fun EmptyText(text: String) {
  Text(
    text = text,
    style = MaterialTheme.typography.bodyMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant
  )
}

@Composable
private fun CategoryChips(categories: List<String>, selected: String, onSelect: (String) -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    categories.chunked(3).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        row.forEach { category ->
          FilterChip(
            selected = selected == category,
            onClick = { onSelect(if (selected == category) "" else category) },
            label = {
              Text(
                text = displayCategory(category),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
              )
            }
          )
        }
      }
    }
  }
}

@Composable
private fun ScopeChips(scope: WidgetScope?) {
  val area = scope?.area
  val project = scope?.project
  if (area == null && project == null) return
  Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    area?.let {
      AssistChip(
        onClick = {},
        label = { Text(it.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
      )
    }
    project?.let {
      AssistChip(
        onClick = {},
        label = { Text(it.name, maxLines = 1, overflow = TextOverflow.Ellipsis) }
      )
    }
  }
}

private fun destinationForRoute(route: String?): Destination =
  Destination.entries.firstOrNull { it.route == route } ?: Destination.TODAY

private fun captureKindFor(destination: Destination): CaptureKind =
  when (destination) {
    Destination.SHOPPING -> CaptureKind.SHOPPING
    Destination.VOCABULARY -> CaptureKind.VOCABULARY
    Destination.CHAT -> CaptureKind.CHAT
    else -> CaptureKind.TASK
  }

private fun syncSubtitle(lastSyncedAt: String?, error: String?): String? =
  error ?: lastSyncedAt?.let { "Synced ${it.replace('T', ' ').take(19)}" }

private fun formatDateLabel(dateKey: String): String =
  dateKey

private fun displayCategory(category: String): String =
  category.replace("_", " ").replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

private fun recurrenceDayLabel(day: FocusRecurrenceDay): String =
  when (day.weekday.take(3)) {
    "Sun" -> "Su"
    "Mon" -> "Mo"
    "Tue" -> "Tu"
    "Wed" -> "We"
    "Thu" -> "Th"
    "Fri" -> "Fr"
    "Sat" -> "Sa"
    else -> day.date.takeLast(2)
  }

private val defaultShoppingCategories = listOf(
  "grocery",
  "personal care",
  "household good",
  "health",
  "miscellaneous"
)

private val defaultVocabularyCategories = listOf(
  "general",
  "medical",
  "language",
  "technical",
  "slang",
  "proper_noun",
  "other"
)
