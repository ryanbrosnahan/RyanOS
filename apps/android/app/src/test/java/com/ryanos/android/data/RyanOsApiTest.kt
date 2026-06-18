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
}
