package com.ryanos.android.data

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RyanOsApiTest {
  @Test
  fun normalizesApiBaseUrlWithDefaultHttpsScheme() {
    assertEquals(
      "https://ryan-lenovo-desktop.taile89fa5.ts.net/api",
      normalizeApiBaseUrl(" ryan-lenovo-desktop.taile89fa5.ts.net/api/ ")
    )
    assertEquals(
      "https://ryan-lenovo-desktop.taile89fa5.ts.net/api",
      normalizeApiBaseUrl("https://ryan-lenovo-desktop.taile89fa5.ts.net/api/")
    )
  }

  @Test
  fun derivesAndroidReleaseManifestUrlFromApiBaseUrl() {
    assertEquals(
      "https://ryan-lenovo-desktop.taile89fa5.ts.net/downloads/android/manifest.json",
      RyanOsApi.androidReleaseManifestUrl(
        "https://ryan-lenovo-desktop.taile89fa5.ts.net/api"
      )
    )
    assertEquals(
      "https://example.com/ryanos/downloads/android/manifest.json",
      RyanOsApi.androidReleaseManifestUrl("https://example.com/ryanos/api/")
    )
    assertEquals(
      "https://ryan-lenovo-desktop.taile89fa5.ts.net/downloads/android/manifest.json",
      RyanOsApi.androidReleaseManifestUrl("ryan-lenovo-desktop.taile89fa5.ts.net/api")
    )
  }

  @Test
  fun parsesAndroidReleaseManifest() {
    val manifest = RyanOsApi.parseAndroidReleaseManifest(
      rawJson = """
        {
          "versionCode": 2,
          "versionName": "0.1.1",
          "apkUrl": "/downloads/android/ryanos-latest.apk",
          "apkSha256": "abc123",
          "apkSizeBytes": 12345,
          "publishedAt": "2026-06-26T12:00:00Z"
        }
      """.trimIndent(),
      manifestUrl = "https://example.com/downloads/android/manifest.json"
    )

    assertEquals(2, manifest.versionCode)
    assertEquals("0.1.1", manifest.versionName)
    assertEquals("https://example.com/downloads/android/ryanos-latest.apk", manifest.apkUrl)
    assertEquals("abc123", manifest.apkSha256)
    assertEquals(12345L, manifest.apkSizeBytes)
    assertEquals("2026-06-26T12:00:00Z", manifest.publishedAt)
  }

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
              "starred": true,
              "starredAt": "2026-05-27T13:00:00.000Z",
              "priority": "high",
              "priorityScore": 84,
              "prioritySignals": ["high priority"],
              "secondaryText": "2026-05-27",
              "progress": {
                "count": 2,
                "latest": [
                  {
                    "id": "note-1",
                    "body": "emailed tux company",
                    "occurredAt": "2026-05-27T13:30:00.000Z",
                    "createdAt": "2026-05-27T13:30:00.000Z",
                    "updatedAt": "2026-05-27T13:30:00.000Z"
                  }
                ]
              },
              "checklist": {
                "total": 3,
                "completed": 1,
                "moreCount": 0,
                "items": [
                  {
                    "id": "step-1",
                    "title": "Email rental place",
                    "checked": true,
                    "checkedAt": "2026-05-27T13:30:00.000Z",
                    "sortOrder": 0,
                    "createdAt": "2026-05-27T12:00:00.000Z",
                    "updatedAt": "2026-05-27T13:30:00.000Z"
                  },
                  {
                    "id": "step-2",
                    "title": "Confirm sizes",
                    "checked": false,
                    "sortOrder": 1,
                    "createdAt": "2026-05-27T12:00:00.000Z",
                    "updatedAt": "2026-05-27T12:00:00.000Z"
                  }
                ]
              },
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
      expandedRecurrenceItemIds = setOf("item-2"),
      expandedDetailItemIds = setOf("item-1")
    )

    assertTrue(snapshot.configured)
    assertEquals("2026-05-27", snapshot.date)
    assertEquals(3, snapshot.recurrenceLeadDaysBeforeDue)
    assertFalse(snapshot.showTaskDetails)
    assertFalse(snapshot.colorCodeByArea)
    assertTrue(snapshot.expandedRecurrenceItemIds.contains("item-2"))
    assertTrue(snapshot.expandedDetailItemIds.contains("item-1"))
    assertEquals(2, snapshot.items.size)
    assertFalse(snapshot.items[0].checked)
    assertTrue(snapshot.items[0].starred)
    assertEquals(2, snapshot.items[0].progress.count)
    assertEquals("emailed tux company", snapshot.items[0].progress.latest[0].body)
    assertEquals(3, snapshot.items[0].checklist.total)
    assertEquals(1, snapshot.items[0].checklist.completed)
    assertTrue(snapshot.items[0].checklist.items[0].checked)
    assertFalse(snapshot.items[0].checklist.items[1].checked)
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
    assertTrue(snapshot.expandedDetailItemIds.isEmpty())
    assertFalse(snapshot.items[0].starred)
    assertEquals(0, snapshot.items[0].progress.count)
    assertEquals(0, snapshot.items[0].checklist.total)
    assertNull(snapshot.items[0].scope)
    assertNull(snapshot.items[0].recurrence)
  }

  @Test
  fun parsesTaskListPayloadWithPaginationAndDetails() {
    val snapshot = RyanOsApi.parseTaskListSnapshot(
      rawJson = """
        {
          "date": "2026-06-30",
          "timezone": "America/Chicago",
          "limit": 2,
          "offset": 0,
          "hasMore": true,
          "nextOffset": 2,
          "items": [
            {
              "id": "item-1",
              "title": "Reserve tuxedos",
              "body": "Coordinate groomsman tuxedos with rental company.",
              "kind": "task",
              "status": "open",
              "starred": true,
              "starredAt": "2026-06-30T12:00:00.000Z",
              "priority": "high",
              "priorityScore": 80,
              "prioritySignals": ["starred"],
              "completion": { "completedToday": false },
              "progress": {
                "count": 1,
                "latest": [
                  {
                    "id": "note-1",
                    "body": "emailed tux company",
                    "occurredAt": "2026-06-30T13:00:00.000Z",
                    "createdAt": "2026-06-30T13:00:00.000Z",
                    "updatedAt": "2026-06-30T13:00:00.000Z"
                  }
                ]
              },
              "checklist": {
                "total": 2,
                "completed": 1,
                "items": [
                  {
                    "id": "step-1",
                    "title": "Email rental place",
                    "checked": true,
                    "checkedAt": "2026-06-30T13:00:00.000Z",
                    "sortOrder": 0,
                    "createdAt": "2026-06-30T12:00:00.000Z",
                    "updatedAt": "2026-06-30T13:00:00.000Z"
                  }
                ]
              }
            }
          ]
        }
      """.trimIndent(),
      lastSyncedAt = "sync"
    )

    assertTrue(snapshot.configured)
    assertEquals("sync", snapshot.lastSyncedAt)
    assertEquals(2, snapshot.limit)
    assertEquals(0, snapshot.offset)
    assertTrue(snapshot.hasMore)
    assertEquals(2, snapshot.nextOffset)
    assertEquals("Reserve tuxedos", snapshot.items[0].title)
    assertEquals("Coordinate groomsman tuxedos with rental company.", snapshot.items[0].body)
    assertTrue(snapshot.items[0].starred)
    assertEquals("emailed tux company", snapshot.items[0].progress.latest[0].body)
    assertEquals(2, snapshot.items[0].checklist.total)
    assertTrue(snapshot.items[0].checklist.items[0].checked)
  }

  @Test
  fun parsesItemDetailsPayload() {
    val details = RyanOsApi.parseItemDetailsSnapshot(
      rawJson = """
        {
          "item": {
            "id": "item-1",
            "title": "Reserve tuxedos",
            "body": "Coordinate groomsman tuxedos with rental company.",
            "kind": "task",
            "status": "open",
            "priority": "high",
            "priorityScore": 80,
            "prioritySignals": [],
            "completion": { "completedToday": false }
          },
          "progressNotes": [
            {
              "id": "note-1",
              "body": "emailed tux company",
              "occurredAt": "2026-06-30T13:00:00.000Z",
              "createdAt": "2026-06-30T13:00:00.000Z",
              "updatedAt": "2026-06-30T13:00:00.000Z"
            }
          ],
          "checklistItems": [
            {
              "id": "step-1",
              "title": "Email rental place",
              "checked": true,
              "checkedAt": "2026-06-30T13:00:00.000Z",
              "sortOrder": 0,
              "createdAt": "2026-06-30T12:00:00.000Z",
              "updatedAt": "2026-06-30T13:00:00.000Z"
            }
          ]
        }
      """.trimIndent(),
      lastSyncedAt = "sync"
    )

    assertTrue(details.configured)
    assertEquals("Reserve tuxedos", details.item?.title)
    assertEquals("Coordinate groomsman tuxedos with rental company.", details.item?.body)
    assertEquals("emailed tux company", details.progressNotes[0].body)
    assertEquals("Email rental place", details.checklistItems[0].title)
    assertTrue(details.checklistItems[0].checked)
  }

  @Test
  fun parsesInboxPayload() {
    val snapshot = RyanOsApi.parseInboxSnapshot(
      emailRawJson = """
        {
          "proposals": [
            {
              "id": "email-proposal-1",
              "actionType": "reply",
              "status": "proposed",
              "title": "Reply to sender about Friday",
              "body": "Confirm Friday works.",
              "priority": "normal",
              "draftReplyText": "Friday works for me.",
              "rationale": "Sender asked for confirmation.",
              "confidence": 91,
              "account": { "email": "ryan@example.com", "displayName": "Personal Gmail" },
              "source": {
                "title": "Friday meeting",
                "summary": "Asked whether Friday works.",
                "url": "https://mail.google.com/mail/u/0/#inbox/msg-1",
                "occurredAt": "2026-06-30T12:00:00.000Z",
                "metadata": {
                  "gmail": {
                    "from": "sender@example.com",
                    "subject": "Friday meeting"
                  }
                }
              }
            }
          ]
        }
      """.trimIndent(),
      opportunityRawJson = """
        {
          "proposals": [
            {
              "id": "opportunity-proposal-1",
              "status": "proposed",
              "projectSlug": "court-nox",
              "title": "Review county software opportunity",
              "summary": "Potential case management opportunity.",
              "rating": 8.5,
              "fit": "high",
              "priority": "high",
              "recommendedAction": "Review bid package",
              "sourceUrls": ["https://example.com/bid"],
              "source": {
                "title": "County bid",
                "summary": "Bid details.",
                "url": "https://example.com/bid",
                "occurredAt": "2026-06-30T13:00:00.000Z"
              }
            }
          ]
        }
      """.trimIndent(),
      codexStatusRawJson = """
        {
          "enabled": true,
          "setup": {
            "configured": true,
            "ready": true,
            "warnings": []
          },
          "account": {
            "lastIngestAt": "2026-06-30T13:00:00.000Z"
          },
          "counts": {
            "proposed": 1
          }
        }
      """.trimIndent(),
      lastSyncedAt = "sync"
    )

    assertTrue(snapshot.configured)
    assertEquals("sync", snapshot.lastSyncedAt)
    assertEquals(1, snapshot.emailProposals.size)
    assertEquals("Personal Gmail", snapshot.emailProposals[0].accountLabel)
    assertEquals("sender@example.com", snapshot.emailProposals[0].sender)
    assertEquals("Friday meeting", snapshot.emailProposals[0].subject)
    assertEquals(91, snapshot.emailProposals[0].confidence)
    assertEquals(1, snapshot.opportunityProposals.size)
    assertEquals("court-nox", snapshot.opportunityProposals[0].projectSlug)
    assertEquals(8.5, snapshot.opportunityProposals[0].rating ?: 0.0, 0.0)
    assertEquals("Review bid package", snapshot.opportunityProposals[0].recommendedAction)
    assertTrue(snapshot.codexStatus?.ready == true)
    assertEquals(1, snapshot.codexStatus?.proposedCount)
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
  fun optimisticToggleUpdatesChecklistItem() {
    val rawJson = """
      {
        "date": "2026-06-18",
        "timezone": "America/Chicago",
        "generatedAt": "2026-06-18T12:00:00.000Z",
        "items": [
          {
            "id": "item-1",
            "title": "Reserve tuxedos",
            "kind": "task",
            "status": "open",
            "checked": false,
            "priority": "normal",
            "priorityScore": 10,
            "prioritySignals": [],
            "checklist": {
              "total": 2,
              "completed": 0,
              "moreCount": 0,
              "items": [
                {
                  "id": "step-1",
                  "title": "Email rental place",
                  "checked": false,
                  "sortOrder": 0,
                  "createdAt": "2026-06-18T12:00:00.000Z",
                  "updatedAt": "2026-06-18T12:00:00.000Z"
                }
              ]
            },
            "action": {
              "type": "item_complete",
              "itemId": "item-1"
            }
          }
        ]
      }
    """.trimIndent()

    val checkedPayload = RyanOsApi.optimisticallyToggleChecklistPayload(
      rawJson = rawJson,
      itemId = "item-1",
      checklistItemId = "step-1",
      checked = true
    )
    val snapshot = RyanOsApi.parseSnapshot(checkedPayload)

    assertTrue(snapshot.items[0].checklist.items[0].checked)
    assertEquals(1, snapshot.items[0].checklist.completed)
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
              "staple": true,
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
              "staple": false,
              "source": "manual",
              "sortOrder": 0,
              "createdAt": "2026-06-19T12:00:00.000Z",
              "updatedAt": "2026-06-19T13:00:00.000Z"
            },
            {
              "id": "shopping-3",
              "name": "Paper towels",
              "normalizedName": "paper towels",
              "category": "household good",
              "checked": true,
              "checkedAt": "2026-06-19T12:58:00.000Z",
              "staple": false,
              "source": "manual",
              "sortOrder": 0,
              "createdAt": "2026-06-19T12:00:00.000Z",
              "updatedAt": "2026-06-19T12:58:00.000Z"
            }
          ],
          "suggestions": [
            {
              "id": "catalog-1",
              "name": "Vitamins",
              "normalizedName": "vitamins",
              "category": "health",
              "purchaseCount": 3,
              "staple": true,
              "lastPurchasedAt": "2026-06-18T12:00:00.000Z"
            }
          ]
        }
      """.trimIndent(),
      lastSyncedAt = "2026-06-19T14:00:00.000Z",
      now = Instant.parse("2026-06-20T12:59:00.000Z")
    )

    assertTrue(snapshot.configured)
    assertEquals("2026-06-19T14:00:00.000Z", snapshot.lastSyncedAt)
    assertEquals(5, snapshot.categories.size)
    assertEquals(2, snapshot.items.size)
    assertEquals("household good", snapshot.items[0].category)
    assertEquals("1", snapshot.items[0].quantity)
    assertFalse(snapshot.items[0].checked)
    assertTrue(snapshot.items[0].staple)
    assertTrue(snapshot.items[1].checked)
    assertFalse(snapshot.items[1].staple)
    assertEquals("2026-06-19T13:00:00.000Z", snapshot.items[1].checkedAt)
    assertFalse(snapshot.items.any { it.id == "shopping-3" })
    assertEquals("Vitamins", snapshot.suggestions[0].name)
    assertEquals(3, snapshot.suggestions[0].purchaseCount)
    assertTrue(snapshot.suggestions[0].staple)
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

  @Test
  fun parsesVocabularyPayload() {
    val snapshot = RyanOsApi.parseVocabularySnapshot(
      rawJson = """
        {
          "categories": ["general", "medical", "language", "technical", "slang", "proper_noun", "other"],
          "entries": [
            {
              "id": "vocab-1",
              "term": "sobremesa",
              "normalizedTerm": "sobremesa",
              "languageCode": "es",
              "category": "language",
              "definition": "The time spent talking at the table after a meal.",
              "partOfSpeech": "noun",
              "pronunciation": "so-breh-MEH-sah",
              "translation": "after-meal conversation",
              "notes": "Useful cultural term.",
              "tags": ["spanish", "food"],
              "definitionSource": "ai_draft",
              "status": "active",
              "createdAt": "2026-06-24T12:00:00.000Z",
              "updatedAt": "2026-06-24T12:00:00.000Z"
            }
          ],
          "encountersByEntryId": {
            "vocab-1": [
              {
                "id": "encounter-1",
                "entryId": "vocab-1",
                "sourceType": "podcast",
                "sourceTitle": "Spanish lesson",
                "context": "They used sobremesa to describe lingering after dinner.",
                "occurredAt": "2026-06-24T12:01:00.000Z",
                "createdAt": "2026-06-24T12:01:00.000Z"
              }
            ]
          }
        }
      """.trimIndent(),
      lastSyncedAt = "2026-06-24T12:02:00.000Z"
    )

    assertTrue(snapshot.configured)
    assertEquals("2026-06-24T12:02:00.000Z", snapshot.lastSyncedAt)
    assertEquals(7, snapshot.categories.size)
    assertEquals(1, snapshot.entries.size)
    assertEquals("sobremesa", snapshot.entries[0].term)
    assertEquals("es", snapshot.entries[0].languageCode)
    assertEquals("language", snapshot.entries[0].category)
    assertEquals("noun", snapshot.entries[0].partOfSpeech)
    assertEquals("after-meal conversation", snapshot.entries[0].translation)
    assertEquals(listOf("spanish", "food"), snapshot.entries[0].tags)
    assertEquals("Spanish lesson", snapshot.encountersByEntryId["vocab-1"]?.first()?.sourceTitle)
  }

  @Test
  fun parsesLegacyVocabularyPayloadDefaults() {
    val snapshot = RyanOsApi.parseVocabularySnapshot(
      rawJson = """
        {
          "entries": [
            {
              "id": "vocab-2",
              "term": "serendipity"
            }
          ]
        }
      """.trimIndent()
    )

    assertTrue(snapshot.configured)
    assertEquals(1, snapshot.entries.size)
    assertEquals("serendipity", snapshot.entries[0].term)
    assertEquals("en", snapshot.entries[0].languageCode)
    assertEquals("general", snapshot.entries[0].category)
    assertEquals("manual", snapshot.entries[0].definitionSource)
    assertTrue(snapshot.entries[0].tags.isEmpty())
    assertTrue(snapshot.encountersByEntryId.isEmpty())
  }

  @Test
  fun parsesDailyPlanPayloadAndOptimisticTaskToggle() {
    val rawJson = """
      {
        "date": "2026-06-24",
        "timezone": "America/Chicago",
        "plan": {
          "selectedItemIds": ["item-1"],
          "suggestedItemIds": ["item-2"],
          "suggestionSource": "heuristic",
          "status": "active"
        },
        "selectedItems": [
          {
            "id": "item-1",
            "title": "Write update",
            "kind": "task",
            "status": "open",
            "starred": true,
            "priority": "high",
            "priorityScore": 70,
            "prioritySignals": ["high priority"],
            "completion": { "completedToday": false },
            "scope": {
              "area": { "id": "area-1", "name": "Work", "icon": "briefcase-business", "color": "sky" }
            }
          }
        ],
        "items": [
          {
            "id": "item-1",
            "title": "Write update",
            "kind": "task",
            "status": "open",
            "starred": true,
            "priority": "high",
            "priorityScore": 70,
            "prioritySignals": ["high priority"],
            "completion": { "completedToday": false },
            "scope": {
              "area": { "id": "area-1", "name": "Work", "icon": "briefcase-business", "color": "sky" }
            }
          }
        ]
      }
    """.trimIndent()

    val snapshot = RyanOsApi.parseDailyPlanSnapshot(rawJson = rawJson, lastSyncedAt = "sync")
    assertTrue(snapshot.configured)
    assertEquals("2026-06-24", snapshot.date)
    assertEquals(listOf("item-1"), snapshot.plan.selectedItemIds)
    assertEquals("Write update", snapshot.selectedItems[0].title)
    assertEquals("Work", snapshot.selectedItems[0].scope?.area?.name)
    assertFalse(snapshot.selectedItems[0].checkedFor(snapshot.date))

    val updatedPayload = RyanOsApi.optimisticallyToggleDailyPlanPayload(
      rawJson = rawJson,
      itemId = "item-1",
      completed = true,
      date = "2026-06-24",
      timezone = "America/Chicago"
    )
    val updated = RyanOsApi.parseDailyPlanSnapshot(updatedPayload)
    assertTrue(updated.selectedItems[0].checkedFor(updated.date))
    assertFalse(updated.selectedItems[0].starred)
    assertEquals("done", updated.items[0].status)
  }

  @Test
  fun parsesDailyPlanRecurringWeekAndOptimisticDayToggle() {
    val rawJson = """
      {
        "date": "2026-06-24",
        "timezone": "America/Chicago",
        "items": [
          {
            "id": "habit-1",
            "title": "Go to gym",
            "kind": "habit",
            "status": "open",
            "starred": false,
            "priority": "normal",
            "priorityScore": 20,
            "prioritySignals": [],
            "completion": { "completedToday": false },
            "recurrence": {
              "policy": {
                "id": "policy-1",
                "type": "target_frequency",
                "targetCount": 3,
                "targetWindowDays": 7,
                "preferredDays": []
              },
              "week": {
                "startDate": "2026-06-18",
                "endDate": "2026-06-24",
                "completedCount": 0,
                "targetWindowDays": 7,
                "days": [
                  { "date": "2026-06-23", "weekday": "Tue", "status": "none" },
                  { "date": "2026-06-24", "weekday": "Wed", "status": "uncompleted" }
                ]
              },
              "state": { "stalenessScore": 4 }
            }
          }
        ]
      }
    """.trimIndent()

    val snapshot = RyanOsApi.parseDailyPlanSnapshot(rawJson)
    assertEquals(2, snapshot.items[0].recurrence?.week?.days?.size)
    assertEquals("target_frequency", snapshot.items[0].recurrence?.policy?.type)

    val updatedPayload = RyanOsApi.optimisticallyToggleDailyPlanPayload(
      rawJson = rawJson,
      itemId = "habit-1",
      completed = true,
      date = "2026-06-24",
      timezone = "America/Chicago"
    )
    val updated = RyanOsApi.parseDailyPlanSnapshot(updatedPayload)
    assertEquals("completed", updated.items[0].recurrence?.week?.days?.get(1)?.status)
    assertEquals(1, updated.items[0].recurrence?.week?.completedCount)
    assertTrue(updated.items[0].checkedFor(updated.date))
  }

  @Test
  fun parsesMessagePayloadAndOptimisticAppend() {
    val rawJson = """
      {
        "messages": [
          {
            "id": "message-1",
            "direction": "inbound",
            "text": "add toothpaste to shopping",
            "occurredAt": "2026-06-24T12:00:00.000Z"
          },
          {
            "id": "message-2",
            "direction": "outbound",
            "text": "Added toothpaste.",
            "occurredAt": "2026-06-24T12:00:02.000Z"
          }
        ]
      }
    """.trimIndent()

    val snapshot = RyanOsApi.parseMessageSnapshot(rawJson, lastSyncedAt = "sync")
    assertTrue(snapshot.configured)
    assertEquals("user", snapshot.messages[0].role)
    assertEquals("assistant", snapshot.messages[1].role)

    val appended = RyanOsApi.optimisticallyAppendMessagePayload(
      rawJson = rawJson,
      text = "plan today",
      now = Instant.parse("2026-06-24T12:01:00.000Z")
    )
    val updated = RyanOsApi.parseMessageSnapshot(appended)
    assertEquals(3, updated.messages.size)
    assertTrue(updated.messages[2].pending)
    assertEquals("plan today", updated.messages[2].text)
  }
}
