import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import type { AdherenceReport } from "@ryanos/core";

/** Fully local export: the same calculated report powers the screen and PDF. */
export async function adherencePdf(
  title: string,
  report: AdherenceReport,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    font: fileURLToPath(
      new URL("../assets/fonts/NotoSans-Regular.ttf", import.meta.url),
    ),
    info: { Title: `${title} - Adherence report`, Author: "RyanOS" },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const ink = "#292524",
    muted = "#78716c",
    green = "#047857";
  const text = (
    value: string,
    x: number,
    y: number,
    size = 10,
    width = 510,
    color = ink,
  ) => {
    doc
      .fontSize(size)
      .fillColor(color)
      .text(value, x, y, { width, height: 80, ellipsis: true });
  };
  text("RYANOS / ADHERENCE REPORT", 42, 38, 9, 510, muted);
  text(title, 42, 60, 23);
  text(
    `${report.start ?? "No completions yet"} through ${report.through}  |  ${report.timezone}`,
    42,
    142,
    10,
    510,
    muted,
  );
  const cards = [
    [String(report.total), "Completed days"],
    [report.weeklyAverage.toFixed(2), "Average / week"],
    [report.monthlyAverage.toFixed(2), "Average / month"],
  ];
  cards.forEach(([value, label], i) => {
    const x = 42 + i * 174;
    doc.roundedRect(x, 178, 162, 76, 7).fill("#f5f5f4");
    text(value!, x + 12, 187, 23, 138, green);
    text(label!, x + 12, 227, 9, 138, muted);
  });
  const goal = report.adherence;
  text("Current-goal adherence", 42, 277, 14);
  text(
    goal
      ? `${goal.percent === null ? "No closed periods yet" : `${goal.percent.toFixed(1)}% of target completions recorded`} | ${goal.met}/${goal.windows} periods met goal\n${goal.label}`
      : "No count-based goal available for this recurrence rule.",
    42,
    304,
    10,
  );
  text(
    `Recent ${report.recentDays} days: ${report.recentWeeklyAverage.toFixed(2)} / week   |   ${report.skipped} skipped days since tracking began`,
    42,
    365,
    10,
  );
  text("Monthly completed days / last 12 months", 42, 411, 14);
  const max = Math.max(1, ...report.months.map((month) => month.completed));
  report.months.forEach((month, i) => {
    const y = 445 + i * 22;
    text(`${month.month}${month.partial ? "*" : ""}`, 42, y, 9, 74, muted);
    if (month.completed)
      doc.rect(122, y + 2, (month.completed / max) * 380, 11).fill(green);
    text(String(month.completed), 514, y, 9, 38);
  });
  text(
    "* Partial or untracked month. Totals reflect recorded completed days.",
    42,
    719,
    9,
    510,
    muted,
  );

  doc.addPage();
  text("Completion calendar", 42, 38, 20);
  text(
    "Green + completed   Amber S skipped   Gray - no completion\nFaded dates are outside tracking or in the future. Weeks start Monday.",
    42,
    75,
    9,
    510,
    muted,
  );
  report.months.forEach((month, i) => {
    const x = 42 + (i % 3) * 174,
      y = 124 + Math.floor(i / 3) * 153;
    text(month.month, x, y, 11, 155);
    ["M", "T", "W", "T", "F", "S", "S"].forEach((day, column) =>
      text(day, x + column * 22, y + 25, 8, 20, muted),
    );
    const days = report.calendar.filter((day) =>
      day.date.startsWith(month.month),
    );
    const offset =
      (new Date(`${month.month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
    days.forEach((day, index) => {
      const dx = x + ((index + offset) % 7) * 22,
        dy = y + 44 + Math.floor((index + offset) / 7) * 15;
      const faded = day.status === "future" || day.status === "before_tracking";
      const done = day.status === "completed",
        skip = day.status === "skipped";
      doc
        .roundedRect(dx, dy, 20, 13, 2)
        .fill(
          done ? "#d1fae5" : skip ? "#fef3c7" : faded ? "#fafaf9" : "#e7e5e4",
        );
      text(
        `${Number(day.date.slice(-2))}${done ? "+" : skip ? "S" : faded ? "" : "-"}`,
        dx + 1,
        dy + 1,
        6,
        20,
        faded ? "#a8a29e" : ink,
      );
    });
  });
  doc.addPage();
  text("How to read this report", 42, 38, 20);
  doc
    .fontSize(10)
    .fillColor(ink)
    .text(report.notes.join("\n\n"), 42, 86, { width: 510, lineGap: 4 });
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page);
    text(
      `RyanOS  |  Generated through ${report.through}  |  ${page + 1} / ${pages.count}`,
      42,
      786,
      8,
      510,
      muted,
    );
  }
  doc.end();
  return finished;
}
