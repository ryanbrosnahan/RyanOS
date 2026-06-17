package com.ryanos.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
      lastSyncedAt = "2026-05-27T12:00:01.000Z"
    )

    assertTrue(snapshot.configured)
    assertEquals("2026-05-27", snapshot.date)
    assertEquals(2, snapshot.items.size)
    assertFalse(snapshot.items[0].checked)
    assertEquals("item_complete", snapshot.items[0].action.type)
    assertTrue(snapshot.items[1].checked)
    assertEquals("recurrence_day", snapshot.items[1].action.type)
    assertEquals("2026-05-27", snapshot.items[1].action.date)
  }
}
