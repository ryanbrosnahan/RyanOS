package com.ryanos.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RyanOsApiTest {
  @Test
  fun parsesWidgetPayload() {
    val snapshot = RyanOsApi.parseSnapshot(
      rawJson = """
        {
          "date": "2026-05-27",
          "timezone": "UTC",
          "generatedAt": "2026-05-27T12:00:00.000Z",
          "items": [
            {
              "id": "item-1",
              "title": "Buy coffee beans",
              "kind": "task",
              "status": "open",
              "checked": false,
              "priority": "high",
              "priorityScore": 84,
              "prioritySignals": ["high priority"],
              "secondaryText": "2026-05-27",
              "scope": {
                "area": {
                  "id": "area-1",
                  "name": "Home",
                  "icon": "home",
                  "color": "amber"
                },
                "project": {
                  "id": "project-1",
                  "name": "Repairs",
                  "icon": "folder-kanban",
                  "color": "stone"
                }
              },
              "action": {
                "type": "item_complete",
                "itemId": "item-1"
              }
            },
            {
              "id": "item-2",
              "title": "Go to the gym",
              "kind": "habit",
              "status": "open",
              "checked": true,
              "priority": "normal",
              "priorityScore": 20,
              "prioritySignals": [],
              "recurrence": {
                "summary": "1/3",
                "intendedDate": "2026-05-28",
                "nextDueAt": "2026-05-28T12:00:00.000Z",
                "lastDoneLabel": "done today",
                "days": [
                  {
                    "date": "2026-05-26",
                    "weekday": "Tue",
                    "status": "none",
                    "allowEarly": false,
                    "isToday": false,
                    "isIntended": false
                  },
                  {
                    "date": "2026-05-27",
                    "weekday": "Wed",
                    "status": "completed",
                    "allowEarly": false,
                    "isToday": true,
                    "isIntended": false
                  }
                ]
              },
              "action": {
                "type": "recurrence_day",
                "itemId": "item-2",
                "date": "2026-05-27",
                "allowEarly": false
              }
            }
          ]
        }
      """.trimIndent(),
      lastSyncedAt = "2026-05-27T12:00:01.000Z",
      recurrenceLeadDaysBeforeDue = 3,
      showTaskDetails = false,
      colorCodeByArea = false,
      expandedRecurrenceItemIds = setOf("item-2")
    )

    assertTrue(snapshot.configured)
    assertEquals("2026-05-27", snapshot.date)
    assertEquals(3, snapshot.recurrenceLeadDaysBeforeDue)
    assertFalse(snapshot.showTaskDetails)
    assertFalse(snapshot.colorCodeByArea)
    assertTrue(snapshot.expandedRecurrenceItemIds.contains("item-2"))
    assertEquals(2, snapshot.items.size)
    assertFalse(snapshot.items[0].checked)
    assertEquals("item_complete", snapshot.items[0].action.type)
    assertEquals("Home", snapshot.items[0].scope?.area?.name)
    assertEquals("amber", snapshot.items[0].scope?.area?.color)
    assertEquals("Repairs", snapshot.items[0].scope?.project?.name)
    assertTrue(snapshot.items[1].checked)
    assertEquals("recurrence_day", snapshot.items[1].action.type)
    assertEquals("2026-05-27", snapshot.items[1].action.date)
    assertEquals("1/3", snapshot.items[1].recurrence?.summary)
    assertEquals("2026-05-28", snapshot.items[1].recurrence?.intendedDate)
    assertEquals("done today", snapshot.items[1].recurrence?.lastDoneLabel)
    assertEquals(2, snapshot.items[1].recurrence?.days?.size)
    assertEquals("completed", snapshot.items[1].recurrence?.days?.get(1)?.status)
  }

  @Test
  fun parsesLegacyWidgetPayloadDefaults() {
    val snapshot = RyanOsApi.parseSnapshot(
      rawJson = """
        {
          "date": "2026-05-27",
          "timezone": "UTC",
          "generatedAt": "2026-05-27T12:00:00.000Z",
          "items": [
            {
              "id": "item-1",
              "title": "Buy coffee beans",
              "kind": "task",
              "status": "open",
              "checked": false,
              "priority": "normal",
              "priorityScore": 10,
              "prioritySignals": [],
              "action": {
                "type": "item_complete",
                "itemId": "item-1"
              }
            }
          ]
        }
      """.trimIndent()
    )

    assertEquals(DEFAULT_RECURRENCE_LEAD_DAYS, snapshot.recurrenceLeadDaysBeforeDue)
    assertTrue(snapshot.showTaskDetails)
    assertTrue(snapshot.colorCodeByArea)
    assertTrue(snapshot.expandedRecurrenceItemIds.isEmpty())
    assertNull(snapshot.items[0].scope)
    assertNull(snapshot.items[0].recurrence)
  }

  @Test
  fun optimisticToggleUpdatesOneOffTask() {
    val rawJson = """
      {
        "date": "2026-06-18",
        "timezone": "America/Chicago",
        "generatedAt": "2026-06-18T12:00:00.000Z",
        "items": [
          {
            "id": "item-1",
            "title": "Buy flowers",
            "kind": "task",
            "status": "open",
            "checked": false,
            "priority": "normal",
            "priorityScore": 10,
            "prioritySignals": [],
            "action": {
              "type": "item_complete",
              "itemId": "item-1"
            }
          }
        ]
      }
    """.trimIndent()

    val completedPayload = RyanOsApi.optimisticallyToggleWidgetPayload(
      rawJson = rawJson,
      itemId = "item-1",
      completed = true,
      date = null,
      timezone = "America/Chicago",
      toggleExisting = true
    )
    val completedSnapshot = RyanOsApi.parseSnapshot(completedPayload)

    assertTrue(completedSnapshot.items[0].checked)
    assertEquals("done", completedSnapshot.items[0].status)

    val undonePayload = RyanOsApi.optimisticallyToggleWidgetPayload(
      rawJson = completedPayload,
      itemId = "item-1",
      completed = true,
      date = null,
      timezone = "America/Chicago",
      toggleExisting = true
    )
    val undoneSnapshot = RyanOsApi.parseSnapshot(undonePayload)

    assertFalse(undoneSnapshot.items[0].checked)
    assertEquals("open", undoneSnapshot.items[0].status)
  }

  @Test
  fun optimisticToggleUpdatesRecurringTodayAndSummary() {
    val rawJson = """
      {
        "date": "2026-06-18",
        "timezone": "America/Chicago",
        "generatedAt": "2026-06-18T12:00:00.000Z",
        "items": [
          {
            "id": "item-2",
            "title": "Go to the gym",
            "kind": "habit",
            "status": "open",
            "checked": false,
            "priority": "normal",
            "priorityScore": 20,
            "prioritySignals": [],
            "recurrence": {
              "summary": "2/5",
              "intendedDate": "2026-06-18",
              "nextDueAt": "2026-06-18T12:00:00.000Z",
              "lastDoneLabel": "last 1d ago",
              "days": [
                {
                  "date": "2026-06-16",
                  "weekday": "Tue",
                  "status": "completed",
                  "allowEarly": false,
                  "isToday": false,
                  "isIntended": false
                },
                {
                  "date": "2026-06-17",
                  "weekday": "Wed",
                  "status": "completed",
                  "allowEarly": false,
                  "isToday": false,
                  "isIntended": false
                },
                {
                  "date": "2026-06-18",
                  "weekday": "Thu",
                  "status": "uncompleted",
                  "allowEarly": false,
                  "isToday": true,
                  "isIntended": true
                }
              ]
            },
            "action": {
              "type": "recurrence_day",
              "itemId": "item-2",
              "date": "2026-06-18",
              "allowEarly": false
            }
          }
        ]
      }
    """.trimIndent()

    val completedPayload = RyanOsApi.optimisticallyToggleWidgetPayload(
      rawJson = rawJson,
      itemId = "item-2",
      completed = true,
      date = "2026-06-18",
      timezone = "America/Chicago",
      toggleExisting = true
    )
    val completedSnapshot = RyanOsApi.parseSnapshot(completedPayload)
    val completedItem = completedSnapshot.items[0]

    assertTrue(completedItem.checked)
    assertEquals("open", completedItem.status)
    assertEquals("3/5", completedItem.recurrence?.summary)
    assertEquals("completed", completedItem.recurrence?.days?.last()?.status)

    val undonePayload = RyanOsApi.optimisticallyToggleWidgetPayload(
      rawJson = completedPayload,
      itemId = "item-2",
      completed = true,
      date = "2026-06-18",
      timezone = "America/Chicago",
      toggleExisting = true
    )
    val undoneSnapshot = RyanOsApi.parseSnapshot(undonePayload)
    val undoneItem = undoneSnapshot.items[0]

    assertFalse(undoneItem.checked)
    assertEquals("2/5", undoneItem.recurrence?.summary)
    assertEquals("uncompleted", undoneItem.recurrence?.days?.last()?.status)
  }

  @Test
  fun parsesShoppingPayload() {
    val snapshot = RyanOsApi.parseShoppingSnapshot(
      rawJson = """
        {
          "categories": ["grocery", "personal care", "household good", "health", "miscellaneous"],
          "items": [
            {
              "id": "shopping-1",
              "name": "Dish detergent",
              "normalizedName": "dish detergent",
              "category": "household good",
              "quantity": "1",
              "checked": false,
              "source": "manual",
              "sortOrder": 0,
              "createdAt": "2026-06-19T12:00:00.000Z",
              "updatedAt": "2026-06-19T12:00:00.000Z"
            },
            {
              "id": "shopping-2",
              "name": "Toothpaste",
              "normalizedName": "toothpaste",
              "category": "personal care",
              "checked": true,
              "checkedAt": "2026-06-19T13:00:00.000Z",
              "source": "manual",
              "sortOrder": 0,
              "createdAt": "2026-06-19T12:00:00.000Z",
              "updatedAt": "2026-06-19T13:00:00.000Z"
            }
          ],
          "suggestions": [
            {
              "id": "catalog-1",
              "name": "Vitamins",
              "normalizedName": "vitamins",
              "category": "health",
              "purchaseCount": 3,
              "lastPurchasedAt": "2026-06-18T12:00:00.000Z"
            }
          ]
        }
      """.trimIndent(),
      lastSyncedAt = "2026-06-19T14:00:00.000Z"
    )

    assertTrue(snapshot.configured)
    assertEquals("2026-06-19T14:00:00.000Z", snapshot.lastSyncedAt)
    assertEquals(5, snapshot.categories.size)
    assertEquals(2, snapshot.items.size)
    assertEquals("household good", snapshot.items[0].category)
    assertEquals("1", snapshot.items[0].quantity)
    assertFalse(snapshot.items[0].checked)
    assertTrue(snapshot.items[1].checked)
    assertEquals("2026-06-19T13:00:00.000Z", snapshot.items[1].checkedAt)
    assertEquals("Vitamins", snapshot.suggestions[0].name)
    assertEquals(3, snapshot.suggestions[0].purchaseCount)
  }

  @Test
  fun optimisticToggleUpdatesShoppingItem() {
    val rawJson = """
      {
        "items": [
          {
            "id": "shopping-1",
            "name": "Dish detergent",
            "normalizedName": "dish detergent",
            "category": "household good",
            "checked": false,
            "source": "manual",
            "sortOrder": 0,
            "createdAt": "2026-06-19T12:00:00.000Z",
            "updatedAt": "2026-06-19T12:00:00.000Z"
          }
        ],
        "suggestions": []
      }
    """.trimIndent()

    val checkedPayload = RyanOsApi.optimisticallyToggleShoppingPayload(
      rawJson = rawJson,
      itemId = "shopping-1",
      checked = true
    )
    val checkedSnapshot = RyanOsApi.parseShoppingSnapshot(checkedPayload)

    assertTrue(checkedSnapshot.items[0].checked)
    assertTrue(checkedSnapshot.items[0].checkedAt?.isNotBlank() == true)

    val undonePayload = RyanOsApi.optimisticallyToggleShoppingPayload(
      rawJson = checkedPayload,
      itemId = "shopping-1",
      checked = false
    )
    val undoneSnapshot = RyanOsApi.parseShoppingSnapshot(undonePayload)

    assertFalse(undoneSnapshot.items[0].checked)
    assertNull(undoneSnapshot.items[0].checkedAt)
  }
}
