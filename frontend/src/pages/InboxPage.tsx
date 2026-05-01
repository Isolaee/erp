import { useState } from 'react';
import EmailList from '../components/email/EmailList';
import EmailDetail from '../components/email/EmailDetail';
import ComposeModal from '../components/email/ComposeModal';
import ChatPanel from '../components/email/ChatPanel';
import { useEmailNotifications } from '../hooks/useEmailNotifications';
import { MessageSquare, PenSquare } from 'lucide-react';

export function InboxPage() {
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEmailNotifications(() => setRefreshKey((k) => k + 1));

  return (
    <div className="flex bg-gray-950 text-gray-100 overflow-hidden relative -m-6 h-[calc(100%+3rem)]">
      <EmailList
        selectedId={selectedEmailId}
        onSelect={setSelectedEmailId}
        refreshKey={refreshKey}
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
        onCompose={() => setComposeOpen(true)}
      />

      <div className="flex-1 overflow-hidden">
        {selectedEmailId ? (
          <EmailDetail
            emailId={selectedEmailId}
            onClose={() => setSelectedEmailId(null)}
            onLabelsChanged={() => setRefreshKey((k) => k + 1)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Select an email to read
          </div>
        )}
      </div>

      {/* Floating buttons */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          onClick={() => setChatOpen((o) => !o)}
          className="p-3 bg-blue-600 hover:bg-blue-700 rounded-full shadow-lg transition-colors"
          title="AI Assistant"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
        <button
          onClick={() => setComposeOpen(true)}
          className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full shadow-lg transition-colors"
          title="Compose"
        >
          <PenSquare className="h-5 w-5" />
        </button>
      </div>

      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      {composeOpen && <ComposeModal onClose={() => setComposeOpen(false)} />}
    </div>
  );
}
