import CalendarView from '../components/email/CalendarView';

export function CalendarEmailPage() {
  return (
    <div className="bg-gray-950 text-gray-100 overflow-auto -m-6 min-h-[calc(100%+3rem)]">
      <CalendarView />
    </div>
  );
}
