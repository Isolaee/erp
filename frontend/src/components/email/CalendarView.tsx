import { useEffect, useState } from "react";
import {
  listEvents, deleteEvent, syncCalendar, createEvent,
  type CalendarEvent,
} from "../../lib/emailApi";
import {
  format, startOfMonth, endOfMonth, addMonths, subMonths,
  eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, parseISO,
} from "date-fns";

interface CreateForm {
  title: string;
  description: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  attendees: string;
  reminderMinutes: string;
}

const blankForm = (day?: Date | null): CreateForm => ({
  title: "",
  description: "",
  location: "",
  date: format(day ?? new Date(), "yyyy-MM-dd"),
  startTime: "09:00",
  endTime: "10:00",
  isAllDay: false,
  attendees: "",
  reminderMinutes: "30",
});

const REMINDER_OPTIONS = [
  { label: "No reminder", value: "" },
  { label: "5 minutes before", value: "5" },
  { label: "15 minutes before", value: "15" },
  { label: "30 minutes before", value: "30" },
  { label: "1 hour before", value: "60" },
  { label: "2 hours before", value: "120" },
  { label: "1 day before", value: "1440" },
];

export default function CalendarView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [month, setMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<CreateForm>(blankForm());
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async (m: Date) => {
    const start = startOfMonth(m).toISOString();
    const end = endOfMonth(m).toISOString();
    setEvents(await listEvents(start, end));
  };

  useEffect(() => { load(month); }, [month]);

  useEffect(() => {
    if (!showModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowModal(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showModal]);

  const openCreate = (day?: Date | null) => {
    setForm(blankForm(day));
    setFormError(null);
    setShowModal(true);
  };

  const handleSync = async () => {
    setSyncing(true);
    await syncCalendar();
    await load(month);
    setSyncing(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this event?")) return;
    await deleteEvent(id);
    await load(month);
  };

  const handleCreate = async () => {
    if (!form.title.trim()) { setFormError("Title is required"); return; }
    setCreating(true);
    setFormError(null);
    try {
      const startDt = form.isAllDay
        ? new Date(`${form.date}T00:00:00`)
        : new Date(`${form.date}T${form.startTime}:00`);
      const endDt = form.isAllDay
        ? new Date(`${form.date}T23:59:00`)
        : new Date(`${form.date}T${form.endTime}:00`);

      await createEvent({
        title: form.title,
        description: form.description,
        location: form.location,
        start_time: startDt.toISOString(),
        end_time: endDt.toISOString(),
        is_all_day: form.isAllDay,
        attendees: form.attendees
          ? form.attendees.split(",").map((a) => a.trim()).filter(Boolean)
          : [],
        calendar_id: "primary",
        reminder_minutes: form.reminderMinutes ? parseInt(form.reminderMinutes) : null,
      });
      setShowModal(false);
      await load(month);
    } catch (e) {
      setFormError(String(e));
    }
    setCreating(false);
  };

  const calStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const calEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const eventsForDay = (day: Date) =>
    events.filter((e) => e.start_time && isSameDay(parseISO(e.start_time), day));

  const selectedEvents = selectedDay ? eventsForDay(selectedDay) : [];

  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Calendar grid */}
      <div className="flex-1 flex flex-col p-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setMonth(subMonths(month, 1))}
            className="text-gray-400 hover:text-gray-100 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800"
          >
            ‹
          </button>
          <button
            onClick={() => setMonth(addMonths(month, 1))}
            className="text-gray-400 hover:text-gray-100 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800"
          >
            ›
          </button>
          <button
            onClick={() => setMonth(new Date())}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500"
          >
            Today
          </button>

          <div className="flex-1 flex items-baseline gap-2 ml-1">
            <span className="text-sm font-semibold text-gray-100">
              {format(month, "MMMM")}
            </span>
            <span className="text-sm text-gray-400">{format(month, "yyyy")}</span>
            <span className="text-xs text-gray-600">· {format(month, "MM")}</span>
          </div>

          <button
            onClick={() => openCreate(selectedDay)}
            className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-white"
          >
            + New Event
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-gray-200"
          >
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="text-center text-[10px] text-gray-600 py-1 font-medium tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 flex-1 overflow-hidden">
          {days.map((day) => {
            const dayEvents = eventsForDay(day);
            const isCurrentMonth = day.getMonth() === month.getMonth();
            const isSelected = selectedDay && isSameDay(day, selectedDay);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                onDoubleClick={() => openCreate(day)}
                className={`border border-gray-800/50 p-1 text-left overflow-hidden transition-colors ${
                  isSelected ? "bg-gray-800" : "hover:bg-gray-900"
                }`}
              >
                <span className={`text-xs block mb-1 w-5 h-5 flex items-center justify-center rounded-full leading-none ${
                  isToday
                    ? "bg-blue-500 text-white font-semibold"
                    : isCurrentMonth
                    ? "text-gray-300"
                    : "text-gray-700"
                }`}>
                  {format(day, "d")}
                </span>
                {dayEvents.slice(0, 2).map((e) => (
                  <div
                    key={e.id}
                    className="text-[9px] bg-blue-900/60 text-blue-300 rounded px-0.5 truncate mb-0.5"
                  >
                    {e.title}
                  </div>
                ))}
                {dayEvents.length > 2 && (
                  <div className="text-[9px] text-gray-600">+{dayEvents.length - 2}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day detail panel */}
      <div className="w-72 border-l border-gray-800 p-4 overflow-y-auto flex flex-col">
        {selectedDay ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">
                {format(selectedDay, "EEE, MMM d")}
              </h3>
              <button
                onClick={() => openCreate(selectedDay)}
                className="text-xs px-2 py-0.5 bg-blue-700/40 hover:bg-blue-600/60 text-blue-300 rounded"
              >
                + Add
              </button>
            </div>

            {selectedEvents.length === 0 ? (
              <p className="text-xs text-gray-600">No events — double-click the day or press + Add.</p>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map((e) => (
                  <div key={e.id} className="bg-gray-900 rounded-lg p-3 border border-gray-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-100 mb-1">{e.title}</div>
                        {e.start_time && (
                          <div className="text-xs text-gray-500">
                            {e.is_all_day
                              ? "All day"
                              : `${format(parseISO(e.start_time), "HH:mm")}${
                                  e.end_time ? ` – ${format(parseISO(e.end_time), "HH:mm")}` : ""
                                }`}
                          </div>
                        )}
                        {e.location && (
                          <div className="text-xs text-gray-500 mt-0.5 truncate">📍 {e.location}</div>
                        )}
                        {e.description && (
                          <div className="text-xs text-gray-600 mt-1 line-clamp-3">{e.description}</div>
                        )}
                        {e.attendees.length > 0 && (
                          <div className="text-xs text-gray-600 mt-1">
                            👥 {e.attendees.slice(0, 3).join(", ")}
                            {e.attendees.length > 3 && ` +${e.attendees.length - 3}`}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="text-gray-700 hover:text-red-400 text-xs shrink-0 mt-0.5"
                        title="Delete event"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-600">Click a day to see events.<br />Double-click to create.</p>
        )}
      </div>

      {/* Create Event Modal */}
      {showModal && (
        <div
          className="absolute inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-sm font-semibold text-gray-100 mb-4">New Event</h2>

            {formError && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg p-2 mb-3">
                {formError}
              </div>
            )}

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Event title *"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                autoFocus
              />

              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isAllDay}
                  onChange={(e) => setForm((f) => ({ ...f, isAllDay: e.target.checked }))}
                  className="accent-blue-500"
                />
                All-day event
              </label>

              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              {!form.isAllDay && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-600 mb-1 block">Start time</label>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-600 mb-1 block">End time</label>
                    <input
                      type="time"
                      value={form.endTime}
                      onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

              <input
                type="text"
                placeholder="Location"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />

              <textarea
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
              />

              <input
                type="text"
                placeholder="Attendees — comma-separated emails"
                value={form.attendees}
                onChange={(e) => setForm((f) => ({ ...f, attendees: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />

              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Reminder</label>
                <select
                  value={form.reminderMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, reminderMinutes: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  {REMINDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="text-xs px-4 py-2 text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="text-xs px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg"
              >
                {creating ? "Creating…" : "Create Event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
